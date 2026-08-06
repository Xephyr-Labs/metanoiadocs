import { pool } from './db.js';

// How long a soft-deleted page survives in the trash before it is destroyed for
// good. The one number a deployment is most likely to want to change, so it
// reads from the environment; anything below a day is a foot-gun, hence the max.
export const TRASH_RETENTION_DAYS = Math.max(1, Number(process.env.TRASH_RETENTION_DAYS) || 30);

const SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;

/**
 * Destroy every page trashed longer ago than the retention window, regardless
 * of who owns it — this is workspace policy, not a user action, so it does not
 * consult the owner-or-admin rule the manual delete uses.
 * Returns how many were destroyed.
 */
export async function purgeExpiredTrash(days = TRASH_RETENTION_DAYS) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT id FROM docs
        WHERE deleted_at IS NOT NULL
          AND deleted_at < now() - ($1 || ' days')::interval
        FOR UPDATE`,
      [String(days)]
    );
    const ids = rows.map((r) => r.id);
    if (ids.length) {
      // docs.parent_id is NO ACTION and one expiring page can be another's
      // parent, so detach the children of the whole set before deleting any of
      // it — same order the manual purge uses.
      await client.query('UPDATE docs SET parent_id = NULL WHERE parent_id = ANY($1)', [ids]);
      await client.query('DELETE FROM docs WHERE id = ANY($1)', [ids]);
    }
    await client.query('COMMIT');
    return ids.length;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/** Sweep once at boot, then every six hours. A failed sweep is logged, never fatal. */
export function startTrashSweeper() {
  const sweep = () =>
    purgeExpiredTrash()
      .then((n) => {
        if (n) console.log(`[trash] purged ${n} page(s) older than ${TRASH_RETENTION_DAYS} days`);
      })
      .catch((e) => console.error('[trash] sweep failed', e));
  sweep();
  // ponytail: setInterval over pg_cron — the query is idempotent and re-runs at
  // boot, so a restart mid-window costs nothing. unref so it never holds the
  // process open on its own.
  setInterval(sweep, SWEEP_INTERVAL_MS).unref();
}
