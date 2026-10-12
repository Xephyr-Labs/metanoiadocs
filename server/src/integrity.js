// A nightly read of every page for the kinds of damage that have happened, or
// nearly happened, here — so they are found by us the next morning rather
// than by whoever opens the page:
//   · two page roots in one doc (a timed-out seed beside the real content);
//   · a link card to a page that never existed (BlockSuite's "Create linked
//     doc" moved text into a doc that was never saved — the 11 Oct loss);
//   · a block listed under two parents, or a child id with no block;
//   · blocks no longer reachable from the page;
//   · table order keys the editor rejects (see validOrderKey).
// Read only. Results go to integrity_reports; a page with a problem not seen
// in the previous report notifies the admins, who can open it from the inbox.
import crypto from 'node:crypto';
import * as Y from 'yjs';
import { validOrderKey } from './blocks.js';

const LINK_CARDS = new Set(['affine:embed-linked-doc', 'affine:embed-synced-doc']);

/** Problems in one page's Yjs state. `pageExists(id)` says whether a docs row
 *  (live or in the trash) exists for a linked page. */
export function scanDocState(state, pageExists) {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, new Uint8Array(state));
  const blocks = doc.getMap('blocks');
  const issues = [];
  const roots = [];
  const parents = new Map();
  for (const [id, b] of blocks) {
    if (!(b instanceof Y.Map)) continue;
    const flavour = b.get('sys:flavour');
    if (flavour === 'affine:page') roots.push(id);
    if (LINK_CARDS.has(flavour)) {
      const pid = b.get('prop:pageId');
      if (pid && !pageExists(pid)) issues.push({ kind: 'dead-link-card', blockId: id, detail: `link card to a page that does not exist (${pid})` });
    }
    const kids = b.get('sys:children');
    for (const c of kids instanceof Y.Array ? kids.toArray() : []) {
      if (!blocks.has(c)) issues.push({ kind: 'missing-child', blockId: id, detail: `lists a child block that does not exist (${c})` });
      parents.set(c, [...(parents.get(c) ?? []), id]);
    }
    if (flavour === 'affine:table') {
      const bad = [...b.keys()].filter((k) => /^prop:(rows|columns)\..+\.order$/.test(k) && !validOrderKey(b.get(k))).length;
      if (bad) issues.push({ kind: 'table-keys', blockId: id, detail: `${bad} table order key(s) the editor rejects` });
    }
  }
  if (roots.length > 1) issues.push({ kind: 'page-roots', detail: `${roots.length} page roots; the editor shows only one` });
  for (const [c, ps] of parents) {
    if (ps.length > 1) issues.push({ kind: 'two-parents', blockId: c, detail: `block is listed under ${ps.length} parents` });
  }
  if (roots.length === 1) {
    const seen = new Set();
    const walk = (id) => {
      if (seen.has(id)) return;
      seen.add(id);
      const kids = blocks.get(id)?.get('sys:children');
      for (const c of kids instanceof Y.Array ? kids.toArray() : []) walk(c);
    };
    walk(roots[0]);
    const lost = [...blocks.keys()].filter((id) => !seen.has(id)).length;
    if (lost) issues.push({ kind: 'unreachable', detail: `${lost} block(s) not reachable from the page` });
  }
  return issues;
}

/** Scan every page once; store the report; tell admins about pages newly
 *  found damaged. Returns the report. */
export async function runIntegrityScan(pool, { canSee = async () => true } = {}) {
  const ids = new Set((await pool.query('SELECT id FROM docs')).rows.map((r) => r.id));
  const { rows } = await pool.query(
    `SELECT s.doc_id, s.state, d.title FROM doc_states s JOIN docs d ON d.id = s.doc_id WHERE d.deleted_at IS NULL`,
  );
  const found = [];
  for (const { doc_id: docId, state, title } of rows) {
    let issues;
    try { issues = scanDocState(state, (id) => ids.has(id)); } catch (err) {
      issues = [{ kind: 'unreadable', detail: `state could not be decoded: ${err.message}` }];
    }
    for (const i of issues) found.push({ docId, title, ...i });
  }
  const prev = (await pool.query('SELECT issues FROM integrity_reports ORDER BY run_at DESC LIMIT 1')).rows[0]?.issues ?? [];
  const key = (i) => `${i.docId}|${i.kind}|${i.blockId ?? ''}`;
  const known = new Set(prev.map(key));
  await pool.query('INSERT INTO integrity_reports (id, scanned, issues) VALUES ($1, $2, $3)',
    [crypto.randomUUID(), rows.length, JSON.stringify(found)]);
  await pool.query(`DELETE FROM integrity_reports WHERE id NOT IN (
    SELECT id FROM integrity_reports ORDER BY run_at DESC LIMIT 60)`);

  const fresh = found.filter((i) => !known.has(key(i)));
  const byDoc = new Map();
  for (const i of fresh) byDoc.set(i.docId, [...(byDoc.get(i.docId) ?? []), i]);
  if (byDoc.size) {
    const admins = (await pool.query(`SELECT id FROM users WHERE role = 'admin'`)).rows;
    for (const [docId, list] of byDoc) {
      const body = list.map((i) => i.detail).join('; ').slice(0, 500);
      for (const a of admins) {
        // Being an admin opens no private page; the inbox would show its title.
        if (!(await canSee(docId, a.id))) continue;
        await pool.query(
          `INSERT INTO notifications (id, user_id, actor_id, actor_name, doc_id, kind, body)
           VALUES ($1, $2, NULL, 'Integrity check', $3, 'integrity', $4)`,
          [crypto.randomUUID(), a.id, docId, body],
        );
      }
    }
  }
  return { scanned: rows.length, issues: found, fresh: fresh.length };
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Ten minutes after boot (out of the way of start-up), then daily. Logged,
 *  never fatal. `canSee(docId, userId)` decides which admins hear of a page. */
export function startIntegrityScan(pool, opts) {
  const run = () => runIntegrityScan(pool, opts)
    .then((r) => console.log(`[integrity] ${r.scanned} page(s), ${r.issues.length} problem(s), ${r.fresh} new`))
    .catch((e) => console.error('[integrity] scan failed', e));
  // ponytail: a timer, not a scheduler — a restart just runs it again sooner.
  setTimeout(() => { run(); setInterval(run, DAY_MS).unref(); }, 10 * 60 * 1000).unref();
}
