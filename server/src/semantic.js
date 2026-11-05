// Search by meaning: "what did we decide about pricing" finds the page titled
// "Lattu+ tiers" even though it shares no word with the question.
//
// Each page's search_text is cut into chunks, the chunks are embedded with the
// same OpenAI-compatible provider Ask AI uses, and the vectors sit in pgvector
// next to the page. /api/search embeds the query and merges the nearest pages
// with the keyword hits. Everything here is best-effort: no pgvector, no AI
// provider, or a provider that is down means keyword search alone, never an
// error.
//
// Indexing is a sweep, not a hook on save: a page is re-embedded when the hash
// of its title + search_text no longer matches the one it was embedded from.
// That keeps every writer of search_text (editor, MCP, import, templates)
// covered without each having to remember to call in here.
import crypto from 'node:crypto';
import { pool, getSetting } from './db.js';

/** The embedding model. A multilingual one: pages and questions are in English and Bangla. */
export const EMBED_MODEL = 'nvidia/nemotron-3-embed-1b';

// Chunk size in characters. ~400 tokens of English; small enough that one
// chunk is about one thing, large enough to carry its context.
const CHUNK_CHARS = 1600;
const OVERLAP_CHARS = 200;

// Separators tried in order, coarsest first.
const SEPARATORS = ['\n# ', '\n## ', '\n### ', '\n\n', '\n', '. ', '! ', '? ', '; ', ', ', ' '];

/** Cut text into chunks of at most CHUNK_CHARS, splitting at the coarsest boundary that fits. */
export function chunkText(text, size = CHUNK_CHARS, overlap = OVERLAP_CHARS) {
  const clean = String(text || '').replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n')
    .replace(/[\t ]{2,}/g, ' ').trim();
  if (!clean) return [];
  const out = [];
  const split = (s, i) => {
    if (s.length <= size) { if (s.trim()) out.push(s.trim()); return; }
    if (i >= SEPARATORS.length) { // one unbroken run: hard cut
      for (let p = 0; p < s.length; p += size) out.push(s.slice(p, p + size));
      return;
    }
    const sep = SEPARATORS[i];
    const parts = s.split(sep).filter((p) => p.trim());
    if (parts.length < 2) return split(s, i + 1);
    let cur = '';
    for (const part of parts) {
      const next = cur ? cur + sep + part : part;
      if (next.length <= size) { cur = next; continue; }
      if (cur.trim()) out.push(cur.trim());
      if (part.length > size) { split(part, i + 1); cur = ''; } else cur = part;
    }
    if (cur.trim()) out.push(cur.trim());
  };
  split(clean, 0);
  if (overlap <= 0) return out;
  // Carry the tail of the previous chunk forward, from a word boundary, so a
  // sentence cut in two is still whole in one of them.
  return out.map((c, i) => {
    if (!i) return c;
    const tail = out[i - 1].slice(-overlap);
    const sp = tail.indexOf(' ');
    return `${(sp >= 0 ? tail.slice(sp + 1) : tail).trim()} ${c}`.trim();
  });
}

/**
 * Reciprocal-rank fusion: merge ranked id lists into one order. An id ranked
 * high in either list ranks high; one found by both ranks highest.
 */
export function rrf(lists, k = 60) {
  const score = new Map();
  for (const list of lists) {
    list.forEach((id, rank) => score.set(id, (score.get(id) || 0) + 1 / (k + rank + 1)));
  }
  return [...score.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
}

/**
 * rrf over result rows of more than one kind (pages, Drive files): a page and
 * a Drive file can share an id string, so each row is keyed by kind + id. The
 * first list holding a row supplies it — pass the keyword lists first, their
 * rows carry the highlighted snippet.
 */
export function fuseRows(lists, k = 60) {
  const key = (r) => `${r.kind}:${r.id}`;
  const byKey = new Map();
  for (const list of lists) for (const r of list) if (!byKey.has(key(r))) byKey.set(key(r), r);
  return rrf(lists.map((l) => l.map(key)), k).map((x) => byKey.get(x));
}

let enabled = false;

/** Whether pgvector is there: what decides if anything may be embedded at all. */
export const semanticOn = () => enabled;

/** Turn on pgvector and create the tables. Without the extension the feature stays off. */
export async function initSemantic() {
  try {
    await pool.query('CREATE EXTENSION IF NOT EXISTS vector');
    await pool.query(`
      -- Untyped vector: the dimension is the model's, and a model change
      -- re-embeds every page (doc_embed_state.model) rather than migrating.
      CREATE TABLE IF NOT EXISTS doc_chunks (
        doc_id    TEXT NOT NULL REFERENCES docs(id) ON DELETE CASCADE,
        idx       INT  NOT NULL,
        text      TEXT NOT NULL,
        embedding vector NOT NULL,
        PRIMARY KEY (doc_id, idx)
      );
      CREATE TABLE IF NOT EXISTS doc_embed_state (
        doc_id     TEXT PRIMARY KEY REFERENCES docs(id) ON DELETE CASCADE,
        hash       TEXT NOT NULL,
        model      TEXT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );`);
    enabled = true;
  } catch (e) {
    console.warn('[semantic] off — pgvector unavailable:', e.message);
  }
}

/** The provider config, or null when Ask AI is not set up. */
export async function provider() {
  const cfg = (await getSetting('ai')) || {};
  return cfg.enabled && cfg.baseUrl && cfg.apiKey ? cfg : null;
}

/** Embed texts. `inputType` is 'passage' for pages, 'query' for searches. */
export async function embed(cfg, texts, inputType, timeoutMs = 60_000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(`${cfg.baseUrl.replace(/\/+$/, '')}/embeddings`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { authorization: `Bearer ${cfg.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: EMBED_MODEL, input: texts, input_type: inputType, encoding_format: 'float' }),
    });
    if (!r.ok) throw new Error(`embeddings ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const { data } = await r.json();
    return data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
  } finally {
    clearTimeout(timer);
  }
}

export const vec = (v) => `[${v.join(',')}]`;
const hashOf = (title, text) => crypto.createHash('sha256').update(`${title}\n${text}`).digest('hex');

// Pages per sweep and inputs per request. Small: the free NIM tier is rate
// limited, and a backfill of the whole workspace has all day.
const DOCS_PER_SWEEP = 8;
export const BATCH = 16;

/** Embed the pages whose text changed since they were last embedded. Returns how many. */
export async function sweepEmbeddings() {
  if (!enabled) return 0;
  const cfg = await provider();
  if (!cfg) return 0;
  // ponytail: hashes every page's text each sweep; fine at thousands of pages,
  // store the hash on docs at save time if it ever is not.
  const { rows } = await pool.query(
    `SELECT d.id, d.title, d.search_text
       FROM docs d LEFT JOIN doc_embed_state s ON s.doc_id = d.id
      WHERE d.deleted_at IS NULL
        AND (s.doc_id IS NULL OR s.model <> $1
             OR s.hash <> encode(sha256(convert_to(coalesce(d.title,'') || E'\\n' || coalesce(d.search_text,''), 'UTF8')), 'hex'))
      ORDER BY d.updated_at DESC NULLS LAST
      LIMIT $2`,
    [EMBED_MODEL, DOCS_PER_SWEEP],
  );
  for (const d of rows) {
    const title = d.title || '';
    const chunks = chunkText(`${title}\n${d.search_text || ''}`);
    const vectors = await embedPassages(cfg, chunks);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM doc_chunks WHERE doc_id = $1', [d.id]);
      if (chunks.length) {
        await client.query(
          `INSERT INTO doc_chunks (doc_id, idx, text, embedding)
           SELECT $1, i - 1, t, e::vector FROM unnest($2::text[], $3::text[]) WITH ORDINALITY AS x(t, e, i)`,
          [d.id, chunks, vectors.map(vec)],
        );
      }
      await client.query(
        `INSERT INTO doc_embed_state (doc_id, hash, model, updated_at) VALUES ($1, $2, $3, now())
         ON CONFLICT (doc_id) DO UPDATE SET hash = EXCLUDED.hash, model = EXCLUDED.model, updated_at = now()`,
        [d.id, hashOf(title, d.search_text || ''), EMBED_MODEL],
      );
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }
  return rows.length;
}

/** Embed chunks for storage, BATCH inputs per request. */
export async function embedPassages(cfg, chunks) {
  const vectors = [];
  for (let i = 0; i < chunks.length; i += BATCH) {
    vectors.push(...(await embed(cfg, chunks.slice(i, i + BATCH), 'passage')));
  }
  return vectors;
}

const SWEEP_INTERVAL_MS = 30_000;

/** Sweep shortly after boot, then every 30s. A failed sweep is logged and retried next time. */
export function startEmbeddingSweeper() {
  let running = false;
  const sweep = () => {
    if (running) return;
    running = true;
    sweepEmbeddings()
      .then((n) => { if (n) console.log(`[semantic] embedded ${n} page(s)`); })
      .catch((e) => console.error('[semantic] sweep failed', e.message))
      .finally(() => { running = false; });
  };
  setTimeout(sweep, 5_000).unref();
  setInterval(sweep, SWEEP_INTERVAL_MS).unref();
}

// Below this cosine similarity a page is not a meaning match, just the least
// unrelated one. Measured on this model: a related Bangla/English pair scores
// ~0.18-0.26, an unrelated one ~0.02-0.04.
const MIN_SIMILARITY = 0.1;
// A search should not wait on the provider: past this, keyword results alone.
const QUERY_TIMEOUT_MS = 2_000;

// The palette searches as you type; the same query embedded twice is waste.
// The cache holds the promise, so the page search and the Drive search that
// one /api/search starts together share a single embedding call.
const queryCache = new Map();
const QUERY_CACHE_MAX = 200;

/** `q` as a pgvector literal, or null when meaning search is off, the query is
 *  too short to mean anything, or the provider is slow or down. */
export async function queryVector(q) {
  if (!enabled || q.length < 4) return null;
  try {
    const cfg = await provider();
    if (!cfg) return null;
    let p = queryCache.get(q);
    if (!p) {
      p = embed(cfg, [q], 'query', QUERY_TIMEOUT_MS).then(([v]) => vec(v));
      p.catch(() => queryCache.delete(q));
      if (queryCache.size >= QUERY_CACHE_MAX) queryCache.delete(queryCache.keys().next().value);
      queryCache.set(q, p);
    }
    return await p;
  } catch (e) {
    console.warn('[semantic] query not embedded:', e.message);
    return null;
  }
}

/**
 * The pages nearest in meaning to `q` that `userId` may open, best first:
 * [{ id, title, space_id, snippet }]. Empty when the feature is off or slow.
 */
export async function semanticSearch({ userId, q, spaceId = null, limit = 20 }) {
  const qv = await queryVector(q);
  if (!qv) return [];
  try {
    // ponytail: exact scan over every chunk, no ANN index — milliseconds at a
    // few thousand chunks; add HNSW on halfvec when it is tens of thousands.
    const { rows } = await pool.query(
      `WITH best AS (
         SELECT DISTINCT ON (c.doc_id) c.doc_id, c.text, c.embedding <=> $2::vector AS dist
           FROM doc_chunks c
           JOIN docs d ON d.id = c.doc_id
           LEFT JOIN doc_access a ON a.doc_id = d.id AND a.user_id = $1
          WHERE d.deleted_at IS NULL AND (a.user_id IS NOT NULL OR d.visibility = 'team')
            AND ($3::text IS NULL OR d.space_id::text = $3::text)
          ORDER BY c.doc_id, dist
       )
       SELECT b.doc_id AS id, d.title, d.space_id, b.text
         FROM best b JOIN docs d ON d.id = b.doc_id
        WHERE 1 - b.dist >= $4
        ORDER BY b.dist
        LIMIT $5`,
      [userId, qv, spaceId, MIN_SIMILARITY, limit],
    );
    return rows.map((r) => ({ id: r.id, title: r.title, space_id: r.space_id, snippet: r.text.slice(0, 200) }));
  } catch (e) {
    console.warn('[semantic] search skipped:', e.message);
    return [];
  }
}
