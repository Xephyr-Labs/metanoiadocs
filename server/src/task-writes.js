// The two task writes that more than one module has to make.
//
// They started inside tasks.js, which was fine while the routes were the only
// caller. An automation now sets assignees, and an agent run makes a task's
// page before commenting on it — and if those modules reached back into
// tasks.js for them, tasks.js reaching forward for the automation and the run
// queue would close an import cycle. The primitives live down here instead, so
// the graph only ever points one way.
import { pool } from './db.js';

/** As many people as a task can carry before the cell stops being readable —
 *  and a bound on what one request can write. */
export const MAX_ASSIGNEES = 20;

/**
 * Make task_assignees match `ids`, and keep `tasks.assignee_id` pointing at the
 * first of them — every older query, filter and importer still reads that
 * column, and a narrow cell still has one name to show.
 *
 * Returns the ids that were not on the task before, which is who gets told.
 */
export async function setAssignees(taskId, ids) {
  const { rows: real } = await pool.query('SELECT id FROM users WHERE id = ANY($1)', [ids]);
  // Order is the caller's, not the database's: the first name is the one a
  // narrow cell shows, so it must be the one they put first.
  const known = new Set(real.map((r) => r.id));
  const wanted = ids.filter((id) => known.has(id));
  const { rows: before } = await pool.query(
    'SELECT user_id FROM task_assignees WHERE task_id = $1', [taskId]
  );
  await pool.query(
    'DELETE FROM task_assignees WHERE task_id = $1 AND NOT (user_id = ANY($2))', [taskId, wanted]
  );
  if (wanted.length) {
    await pool.query(
      `INSERT INTO task_assignees (task_id, user_id, position)
       SELECT $1, u, ord - 1 FROM unnest($2::text[]) WITH ORDINALITY AS x(u, ord)
       ON CONFLICT (task_id, user_id) DO UPDATE SET position = EXCLUDED.position`,
      [taskId, wanted]
    );
  }
  await pool.query('UPDATE tasks SET assignee_id = $2 WHERE id = $1', [taskId, wanted[0] ?? null]);
  const had = new Set(before.map((r) => r.user_id));
  return wanted.filter((id) => !had.has(id));
}

/**
 * The page a task is written on, made if it does not exist yet. Returns its id,
 * or null when there is no such task.
 *
 * SELECT … FOR UPDATE serialises concurrent first-opens of the same row: the
 * second caller blocks until the first commits its doc_id, then reads it back
 * instead of racing to create a second document. Idempotent, so a caller that
 * cannot know whether the page exists — a person clicking into a row, an agent
 * about to write its result somewhere — just asks.
 */
export async function ensureTaskPage(taskId, userId, createDocRow, content = null) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      'SELECT id, title, doc_id FROM tasks WHERE id = $1 AND deleted_at IS NULL FOR UPDATE',
      [taskId]
    );
    if (!rows[0]) {
      await client.query('ROLLBACK');
      return null;
    }
    if (rows[0].doc_id) {
      await client.query('ROLLBACK');
      return rows[0].doc_id;
    }
    // createDocRow opens its own transaction on its own pool client, so it is
    // not part of this one — the row lock above is what stops a second caller
    // from reaching this line for the same task.
    const doc = await createDocRow({
      title: rows[0].title || 'Untitled',
      icon: '📄',
      userId,
      folderId: null,
      visibility: 'team',
      kind: 'task',
      // Markdown when a row template brought a body with it; null for the
      // ordinary "give this row a page" gesture, which opens an empty one.
      content,
    });
    await client.query('UPDATE tasks SET doc_id = $1 WHERE id = $2', [doc.id, taskId]);
    await client.query('COMMIT');
    return doc.id;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
