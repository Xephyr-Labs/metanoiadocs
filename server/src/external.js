// Search across tools outside the workspace, starting with the connected
// Google Drive: "the onboarding checklist" finds the Google Doc of that name,
// and "how much did we pay for hosting" finds the sheet that says it.
//
// drive.js keeps a mirror of the drive's file list (drive_files) but never the
// bytes. Here a sweep reads the text of the files it can (the same exports and
// downloads read_drive_file uses) and keeps it in external_items, which is
// keyword-searchable on its own. When pgvector and an AI provider are there,
// the text is also cut into chunks and embedded into external_chunks, the way
// semantic.js does for pages, so Drive files are found by meaning too.
//
// The tables are keyed (source, item_id) rather than tied to drive_files so the
// next connector (Notion, Slack…) writes into the same two tables and comes
// out of the same search. Pages keep their own doc_chunks; nothing here
// touches them.
//
// What a search may return is decided by the source's own listing, not by
// these tables: every query joins drive_files, so a file that left the drive
// (trashed, removed, the drive disconnected) stops matching at once, before the
// sweep gets round to deleting its rows. drive_files has no per-user rule —
// every member sees the Drive view — so neither does Drive search.
import { pool, getSetting } from './db.js';
import { READ_MAX_BYTES, fileText, textRoute } from './drive.js';
import { BATCH, chunkText, embedPassages, EMBED_MODEL, provider, queryVector, semanticOn, vec } from './semantic.js';

/** Create the tables. external_items is plain Postgres, so keyword search over
 *  Drive works without pgvector; the chunk table needs the extension. */
export async function initExternal() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS external_items (
      source           TEXT NOT NULL,
      item_id          TEXT NOT NULL,
      -- The source's change marker the text was read at (Drive: modifiedTime).
      version          TEXT NOT NULL,
      title            TEXT NOT NULL DEFAULT '',
      text             TEXT NOT NULL DEFAULT '',
      tsv              tsvector GENERATED ALWAYS AS (to_tsvector('english', text)) STORED,
      -- The version and model the chunks were embedded from; NULL until then.
      embedded_version TEXT,
      embed_model      TEXT,
      -- Failed embeds in a row, and when the next try is allowed (backoff).
      embed_attempts   INT NOT NULL DEFAULT 0,
      embed_retry_at   TIMESTAMPTZ,
      indexed_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (source, item_id)
    );
    CREATE INDEX IF NOT EXISTS external_items_tsv_idx ON external_items USING gin (tsv);`);
  if (!semanticOn()) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS external_chunks (
      source    TEXT NOT NULL,
      item_id   TEXT NOT NULL,
      idx       INT  NOT NULL,
      text      TEXT NOT NULL,
      embedding vector NOT NULL,
      PRIMARY KEY (source, item_id, idx),
      FOREIGN KEY (source, item_id) REFERENCES external_items (source, item_id) ON DELETE CASCADE
    );`);
}

/** The change marker a Drive file is indexed at. */
const versionOf = (f) => (f.modified_at ? new Date(f.modified_at).toISOString() : '');

/** Whether the sweep reads a file at all: one read_drive_file can turn into
 *  text, under the size read_drive_file refuses. Google-native files report
 *  no size and are always tried. */
export const indexable = (f) => !!textRoute(f.mime_type) && !(f.size && Number(f.size) > READ_MAX_BYTES);

/**
 * What one Drive sweep has to do, from the mirror's files and what is indexed
 * (Map item_id -> version): the files to read — new, or changed since they
 * were read — newest first, at most `limit`; and the indexed ids to drop,
 * because the file left the drive or can no longer be read.
 */
export function planDrive(files, indexed, limit) {
  const keep = new Set();
  const read = [];
  for (const f of files) {
    if (!indexable(f)) continue;
    keep.add(f.id);
    if (indexed.get(f.id) !== versionOf(f)) read.push(f);
  }
  read.sort((a, b) => versionOf(b).localeCompare(versionOf(a)));
  return { read: read.slice(0, limit), remove: [...indexed.keys()].filter((id) => !keep.has(id)) };
}

// Few files per sweep: each is a Drive export or download, a PDF is parsed,
// and a first sweep over a big drive has all day. ~240 files an hour.
const FILES_PER_SWEEP = 4;
const ITEMS_PER_EMBED = 4;
// Embedding requests per sweep (one a minute). The page sweeper may make 8+
// every 30s on the same rate-limited provider; Drive stays well under half.
const EMBED_REQUESTS_PER_SWEEP = 3;
// ponytail: only the start of a long file is embedded — 40 chunks, ~64k
// characters, 3 requests. The whole text stays keyword-searchable; embed the
// rest when a provider with headroom makes it worth the requests.
export const MAX_CHUNKS_PER_ITEM = 40;

/** The chunks embedded for an item. */
export const itemChunks = (title, text) => chunkText(`${title}\n${text}`).slice(0, MAX_CHUNKS_PER_ITEM);

/** How long a failing item waits before its next embed try: 30 minutes,
 *  doubling with each failure in a row, at most a day. */
export const embedBackoffMs = (attempts) => Math.min(30 * 60_000 * 2 ** (attempts - 1), 24 * 3600_000);

/** A read failure worth trying again next sweep — the key refused, a rate
 *  limit, Google down, no network (fetch's TypeError) — rather than recording
 *  the file as having no text. */
export const transient = (e) => !!e.auth || e.status === 429 || e.status >= 500 || e instanceof TypeError
  || (e.status === 403 && /rate ?limit/i.test(`${e.reason || ''} ${e.message || ''}`));

/**
 * One pass: drop what left the drive, read what changed, embed what was read.
 * `readText(sa, row)` is drive.js's reader; tests hand in a stub. Returns
 * { removed, read, embedded }.
 */
export async function sweepExternal({ readText = fileText } = {}) {
  const { rows: files } = await pool.query('SELECT id, name, mime_type, size, modified_at FROM drive_files');
  const { rows: items } = await pool.query("SELECT item_id, version FROM external_items WHERE source = 'drive'");
  const plan = planDrive(files, new Map(items.map((r) => [r.item_id, r.version])), FILES_PER_SWEEP);
  if (plan.remove.length) {
    await pool.query("DELETE FROM external_items WHERE source = 'drive' AND item_id = ANY($1)", [plan.remove]);
  }
  const cfg = (await getSetting('drive')) || {};
  let read = 0;
  for (const f of cfg.sa ? plan.read : []) {
    let text = '';
    try {
      text = (await readText(cfg.sa, f)).text;
    } catch (e) {
      if (transient(e)) { console.warn('[external] drive read deferred:', e.message); break; }
      // A file Drive will not export (permissions, a broken PDF): recorded with
      // no text so it is not retried until it changes. Its name still matches.
    }
    await pool.query(
      `INSERT INTO external_items (source, item_id, version, title, text, indexed_at)
       VALUES ('drive', $1, $2, $3, $4, now())
       ON CONFLICT (source, item_id) DO UPDATE SET version = EXCLUDED.version, title = EXCLUDED.title,
         text = EXCLUDED.text, indexed_at = now(), embed_attempts = 0, embed_retry_at = NULL`,
      // Postgres text cannot hold NUL, which a stray PDF byte sometimes is.
      [f.id, versionOf(f), f.name, text.replace(/\0/g, '')],
    );
    read++;
  }
  return { removed: plan.remove.length, read, embedded: await embedPending() };
}

/**
 * Embed the items whose text changed since their chunks were made, within
 * EMBED_REQUESTS_PER_SWEEP. An item that fails (a 429 halfway through) backs
 * off on its own, so it cannot hold the queue: the next sweep takes others.
 */
async function embedPending() {
  if (!semanticOn()) return 0;
  const cfg = await provider();
  if (!cfg) return 0;
  const { rows } = await pool.query(
    `SELECT source, item_id, version, title, text, embed_attempts FROM external_items
      WHERE (embedded_version IS DISTINCT FROM version OR embed_model IS DISTINCT FROM $1)
        AND (embed_retry_at IS NULL OR embed_retry_at <= now())
      ORDER BY indexed_at DESC LIMIT $2`,
    [EMBED_MODEL, ITEMS_PER_EMBED],
  );
  let requests = 0;
  let done = 0;
  for (const it of rows) {
    const chunks = itemChunks(it.title, it.text);
    const cost = Math.ceil(chunks.length / BATCH);
    if (done && requests + cost > EMBED_REQUESTS_PER_SWEEP) break;
    requests += cost;
    let vectors;
    try {
      vectors = await embedPassages(cfg, chunks);
    } catch (e) {
      console.warn('[external] embed failed, backing off:', it.item_id, e.message);
      await pool.query(
        `UPDATE external_items SET embed_attempts = embed_attempts + 1,
                embed_retry_at = now() + make_interval(secs => $3 / 1000.0)
          WHERE source = $1 AND item_id = $2`,
        [it.source, it.item_id, embedBackoffMs(it.embed_attempts + 1)],
      );
      continue;
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM external_chunks WHERE source = $1 AND item_id = $2', [it.source, it.item_id]);
      if (chunks.length) {
        await client.query(
          `INSERT INTO external_chunks (source, item_id, idx, text, embedding)
           SELECT $1, $2, i - 1, t, e::vector FROM unnest($3::text[], $4::text[]) WITH ORDINALITY AS x(t, e, i)`,
          [it.source, it.item_id, chunks, vectors.map(vec)],
        );
      }
      // Guarded by version: a re-read that landed while this was embedding
      // keeps its newer text marked as not embedded yet. The row may also have
      // been deleted meanwhile, which takes the chunks with it.
      await client.query(
        `UPDATE external_items SET embedded_version = version, embed_model = $3, embed_attempts = 0, embed_retry_at = NULL
          WHERE source = $1 AND item_id = $2 AND version = $4`,
        [it.source, it.item_id, EMBED_MODEL, it.version],
      );
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
    done++;
  }
  return done;
}

const SWEEP_MS = 60_000;

export function startExternalSweeper() {
  let running = false;
  const sweep = () => {
    if (running) return;
    running = true;
    sweepExternal()
      .then((r) => { if (r.read || r.removed || r.embedded) console.log('[external] drive', r); })
      .catch((e) => console.error('[external] sweep failed', e.message))
      .finally(() => { running = false; });
  };
  setTimeout(sweep, 10_000).unref();
  setInterval(sweep, SWEEP_MS).unref();
}

const MIN_SIMILARITY = 0.1; // the cut-off semantic.js measured for pages

/** A Drive file as a search hit. */
const driveHit = (r, snippet) => ({
  kind: 'drive', id: r.id, title: r.name, snippet, url: r.web_view_link, mimeType: r.mime_type, iconLink: r.icon_link,
});

/**
 * Drive files matching `q`, as two ranked lists for /api/search to fuse with
 * the page results: `keyword` (the file's name, or a word in its text) and
 * `near` (meaning; empty when that is off).
 */
export async function searchDrive(q, limit = 10) {
  // ponytail: the OR across name and text scans every drive_files row — fine
  // at tens of thousands of files; split into UNIONed indexed queries past that.
  const kwP = pool.query(
    `SELECT f.id, f.name, f.mime_type, f.web_view_link, f.icon_link,
            CASE WHEN e.tsv @@ plainto_tsquery('english', $1)
                 THEN ts_headline('english', e.text, plainto_tsquery('english', $1), 'MaxWords=18, MinWords=6, ShortWord=2')
                 ELSE '' END AS snippet
       FROM drive_files f
       LEFT JOIN external_items e ON e.source = 'drive' AND e.item_id = f.id
      WHERE f.name ILIKE $2 OR f.name % $1 OR to_tsvector('english', f.name) @@ plainto_tsquery('english', $1)
         OR e.tsv @@ plainto_tsquery('english', $1)
      ORDER BY (f.name ILIKE $2) DESC,
               ts_rank(setweight(to_tsvector('english', f.name), 'A') || coalesce(e.tsv, ''), plainto_tsquery('english', $1)) DESC,
               similarity(f.name, $1) DESC
      LIMIT $3`,
    [q, `%${q.replace(/([%_\\])/g, '\\$1')}%`, limit],
  );
  const nearP = (async () => {
    const qv = await queryVector(q);
    if (!qv) return [];
    try {
      const { rows } = await pool.query(
        `WITH best AS (
           SELECT DISTINCT ON (c.item_id) c.item_id, c.text, c.embedding <=> $1::vector AS dist
             FROM external_chunks c
            WHERE c.source = 'drive'
            ORDER BY c.item_id, dist
         )
         SELECT f.id, f.name, f.mime_type, f.web_view_link, f.icon_link, b.text
           FROM best b JOIN drive_files f ON f.id = b.item_id
          WHERE 1 - b.dist >= $2
          ORDER BY b.dist
          LIMIT $3`,
        [qv, MIN_SIMILARITY, limit],
      );
      return rows.map((r) => driveHit(r, r.text.slice(0, 200)));
    } catch (e) {
      console.warn('[external] drive meaning search skipped:', e.message);
      return [];
    }
  })();
  const keyword = (await kwP).rows.map((r) => driveHit(r, r.snippet));
  return { keyword, near: await nearP };
}
