// One-off repair: a client that timed out waiting for sync seeded a second
// empty page root, and the editor renders that one instead of the content.
// Keep the root whose subtree actually holds text; delete the empty ones.
// Every doc is snapshotted into doc_versions first, so this is reversible.
const { Pool } = require('pg');
const Y = require('yjs');
const crypto = require('crypto');

const DRY = process.argv.includes('--dry-run');

function subtree(blocks, id, seen = new Set()) {
  if (seen.has(id)) return seen;
  seen.add(id);
  const b = blocks.get(id);
  const kids = b instanceof Y.Map ? b.get('sys:children') : null;
  if (kids instanceof Y.Array) for (const k of kids.toArray()) subtree(blocks, k, seen);
  return seen;
}

function textOf(blocks, ids) {
  let n = 0;
  for (const id of ids) {
    const b = blocks.get(id);
    if (!(b instanceof Y.Map)) continue;
    const t = b.get('prop:text');
    if (t && typeof t.toString === 'function') n += t.toString().trim().length;
  }
  return n;
}

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const { rows } = await pool.query(
    'SELECT s.doc_id, s.state, d.title FROM doc_states s JOIN docs d ON d.id = s.doc_id WHERE d.deleted_at IS NULL',
  );
  let repaired = 0;
  for (const r of rows) {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, new Uint8Array(r.state));
    const blocks = doc.getMap('blocks');
    const roots = [];
    for (const [k, v] of blocks) if (v instanceof Y.Map && v.get('sys:flavour') === 'affine:page') roots.push(k);
    if (roots.length < 2) continue;

    const scored = roots.map((id) => {
      const ids = subtree(blocks, id);
      return { id, ids, blocks: ids.size, text: textOf(blocks, ids) };
    }).sort((a, b) => b.text - a.text || b.blocks - a.blocks);

    const keep = scored[0];
    const drop = scored.slice(1);
    // Refuse to delete a root that carries text — that would be data loss, and
    // this script exists to prevent exactly that.
    const unsafe = drop.filter((d) => d.text > 0);
    console.log(`${r.doc_id} | ${(r.title || '').slice(0, 34)}`);
    console.log(`  keep ${keep.id} (${keep.blocks} blocks, ${keep.text} chars)`);
    for (const d of drop) console.log(`  drop ${d.id} (${d.blocks} blocks, ${d.text} chars)${d.text > 0 ? '  ← SKIPPED: has text' : ''}`);
    if (unsafe.length === drop.length) { console.log('  nothing safe to remove'); continue; }
    if (DRY) { repaired++; continue; }

    await pool.query(
      'INSERT INTO doc_versions (id, doc_id, state, label) VALUES ($1, $2, $3, $4)',
      [crypto.randomUUID(), r.doc_id, r.state, 'before duplicate-root repair'],
    );
    doc.transact(() => {
      for (const d of drop) {
        if (d.text > 0) continue;
        for (const id of d.ids) blocks.delete(id);
      }
    });
    const next = Buffer.from(Y.encodeStateAsUpdate(doc));
    await pool.query('UPDATE doc_states SET state = $2, updated_at = now() WHERE doc_id = $1', [r.doc_id, next]);
    repaired++;
  }
  console.log(DRY ? `would repair ${repaired} docs` : `repaired ${repaired} docs`);
  await pool.end();
})();
