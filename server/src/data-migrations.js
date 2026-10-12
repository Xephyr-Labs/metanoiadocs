// One-time repairs of stored data, run at boot before the server takes any
// connection — so no page is open in Hocuspocus and a direct write to
// doc_states cannot be overwritten by an in-memory copy. Each runs once,
// recorded in data_migrations; a failure leaves it unrecorded (it runs again
// on the next boot) and is logged, never fatal: the app works without it.
import * as Y from 'yjs';
import { fixTableOrderKeys } from './blocks.js';

const MIGRATIONS = [
  {
    // Tables written by the server before the order-key fix could not take a
    // new row or column next to some rows (see validOrderKey in blocks.js).
    name: '2026-10-table-order-keys',
    async run(pool) {
      const { rows } = await pool.query(
        `SELECT s.doc_id FROM doc_states s JOIN docs d ON d.id = s.doc_id`,
      );
      let docs = 0, tables = 0, failed = 0;
      for (const { doc_id: docId } of rows) {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const cur = await client.query('SELECT state FROM doc_states WHERE doc_id = $1 FOR UPDATE', [docId]);
          if (!cur.rows[0]) { await client.query('ROLLBACK'); continue; }
          const doc = new Y.Doc();
          Y.applyUpdate(doc, new Uint8Array(cur.rows[0].state));
          const n = fixTableOrderKeys(doc);
          if (!n) { await client.query('ROLLBACK'); continue; }
          // The page's updated_at is left alone: a repair is not an edit, and
          // bumping it would float every page with a table to "just edited".
          await client.query('UPDATE doc_states SET state = $2 WHERE doc_id = $1',
            [docId, Buffer.from(Y.encodeStateAsUpdate(doc))]);
          await client.query('COMMIT');
          docs++; tables += n;
        } catch (err) {
          // One page that cannot be read or written must not stop the rest
          // (nor hold every later boot up re-reading them all): it is logged
          // and left as it was, and the integrity scan reports what remains.
          await client.query('ROLLBACK').catch(() => {});
          failed++;
          console.error(`[migrate] table keys: page ${docId} skipped:`, err.message);
        } finally {
          client.release();
        }
      }
      return `${tables} table(s) in ${docs} page(s)${failed ? `, ${failed} page(s) skipped` : ''}`;
    },
  },
];

export async function runDataMigrations(pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS data_migrations (
    name TEXT PRIMARY KEY, done_at TIMESTAMPTZ NOT NULL DEFAULT now(), detail TEXT)`);
  for (const m of MIGRATIONS) {
    const done = await pool.query('SELECT 1 FROM data_migrations WHERE name = $1', [m.name]);
    if (done.rows[0]) continue;
    try {
      const detail = await m.run(pool);
      await pool.query('INSERT INTO data_migrations (name, detail) VALUES ($1, $2) ON CONFLICT DO NOTHING', [m.name, detail]);
      console.log(`[migrate] ${m.name}: ${detail}`);
    } catch (err) {
      console.error(`[migrate] ${m.name} failed, will retry next boot:`, err.message);
    }
  }
}
