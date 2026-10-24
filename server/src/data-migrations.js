// One-time repairs of stored data, run at boot before the server takes any
// connection — so no page is open in Hocuspocus and a direct write to
// doc_states cannot be overwritten by an in-memory copy. Each runs once,
// recorded in data_migrations; a failure leaves it unrecorded (it runs again
// on the next boot) and is logged, never fatal: the app works without it.
import * as Y from 'yjs';
import { defaultSpaceId } from './db.js';
import { fixTableOrderKeys, stateWithValidTableKeys } from './blocks.js';

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
  {
    // The same for open Suggesting-mode drafts, base and draft alike: mended
    // on one side only, every table would read as changed in the review.
    name: '2026-10-table-order-keys-drafts',
    async run(pool) {
      const { rows } = await pool.query(`SELECT id FROM doc_suggestions WHERE status = 'draft'`);
      let fixed = 0, failed = 0;
      for (const { id } of rows) {
        try {
          const r = (await pool.query('SELECT base_state, state FROM doc_suggestions WHERE id = $1', [id])).rows[0];
          if (!r) continue;
          const base = stateWithValidTableKeys(r.base_state);
          const state = stateWithValidTableKeys(r.state);
          if (base === r.base_state && state === r.state) continue;
          await pool.query('UPDATE doc_suggestions SET base_state = $2, state = $3 WHERE id = $1', [id, base, state]);
          fixed++;
        } catch (err) {
          failed++;
          console.error(`[migrate] table keys: draft ${id} skipped:`, err.message);
        }
      }
      return `${fixed} draft(s)${failed ? `, ${failed} skipped` : ''}`;
    },
  },
  {
    // Spaces arrive: everything that exists moves into General, and everyone
    // joins it, so nothing disappears from anybody's sidebar.
    name: '2026-10-spaces-general',
    async run(pool) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const space = await defaultSpaceId(client);
        const counts = [];
        for (const table of ['docs', 'folders', 'projects']) {
          counts.push((await client.query(`UPDATE ${table} SET space_id = $1 WHERE space_id IS NULL`, [space])).rowCount);
        }
        const members = await client.query(
          'INSERT INTO space_members (space_id, user_id) SELECT $1, id FROM users ON CONFLICT DO NOTHING', [space]);
        await client.query('COMMIT');
        return `${counts[0]} docs, ${counts[1]} folders, ${counts[2]} projects, ${members.rowCount} members`;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
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
