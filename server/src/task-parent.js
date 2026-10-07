// Which task may hold which, decided in one place.
//
// A parent used to be checked only by PATCH, and only for project and loops;
// create wrote whatever id it was handed, so a typo failed on the foreign key
// as a 500 after a task number was already spent, and a task from another
// project was accepted as a parent. The UI meanwhile only ever offers a type
// marked "can hold tasks" (an Epic, by default). Create, PATCH, the CSV import
// and the MCP tools now all ask the same question here, and the answer is the
// rule the UI already shows.
import { pool } from './db.js';
import { parseKeyQuery } from './task-key.js';

/**
 * Why `parent` cannot hold the child, as a sentence for the person who asked,
 * or null when it can.
 *
 * Pure, so the CSV dry run can judge rows that do not exist yet with exactly
 * the rule a real write applies. `chain` is the parent followed by its own
 * ancestors; the child appearing in it means the link would close a loop.
 */
export function parentProblem({ childId = null, projectId, parent, ref, kinds, chain = [] }) {
  if (!parent || parent.deleted_at) return `There is no task "${ref}" in this project to be the parent.`;
  if (parent.project_id !== projectId) return 'The parent has to be a task in the same project.';
  if (childId && parent.id === childId) return 'A task cannot be its own parent.';
  const kind = kinds.find((k) => k.key === parent.kind);
  if (!kind?.is_group) {
    const groups = kinds.filter((k) => k.is_group).map((k) => k.label);
    const allowed = groups.length
      ? `only ${groups.join(', ')} can`
      : 'no type in this project can (mark one as able to hold tasks first)';
    return `"${ref}" is a ${kind?.label ?? parent.kind}, which cannot hold other tasks; ${allowed}.`;
  }
  if (childId && chain.includes(childId)) return `That would make a loop: "${ref}" is already under this task.`;
  return null;
}

/**
 * A task named by id or by its key ("DE-4"), or null.
 *
 * The id is tried first because an id is what the UI sends; the key is what a
 * person or an agent has in hand from a chat message or a spreadsheet.
 */
export async function findTaskRef(projectId, ref, db = pool) {
  const s = String(ref ?? '').trim();
  if (!s) return null;
  const { rows } = await db.query(
    'SELECT id, project_id, kind, deleted_at FROM tasks WHERE id = $1', [s]);
  if (rows[0]) return rows[0];
  const key = parseKeyQuery(s);
  if (!key) return null;
  const { rows: byKey } = await db.query(
    `SELECT t.id, t.project_id, t.kind, t.deleted_at FROM tasks t JOIN projects p ON p.id = t.project_id
      WHERE t.project_id = $1 AND upper(p.key) = $2 AND t.num = $3 AND t.deleted_at IS NULL`,
    [projectId, key.key, key.num]
  );
  return byKey[0] ?? null;
}

/**
 * Check a proposed parent against the database. Returns `{ id }` — the
 * parent's real id, whatever form `ref` was in — or `{ error }`.
 */
export async function checkParent({ childId = null, projectId, ref }, db = pool) {
  const parent = await findTaskRef(projectId, ref, db);
  const { rows: kinds } = await db.query(
    'SELECT key, label, is_group FROM task_kinds WHERE project_id = $1', [projectId]);
  // Bounded rather than trusting the data: a loop that predates this rule
  // must not hang the request that is trying to stop the next one.
  const { rows: chain } = parent
    ? await db.query(
      `WITH RECURSIVE up(id, parent_id, depth) AS (
         SELECT id, parent_id, 0 FROM tasks WHERE id = $1
         UNION ALL
         SELECT t.id, t.parent_id, up.depth + 1 FROM tasks t JOIN up ON t.id = up.parent_id
          WHERE up.depth < 100
       ) SELECT id FROM up`,
      [parent.id])
    : { rows: [] };
  const error = parentProblem({ childId, projectId, parent, ref, kinds, chain: chain.map((r) => r.id) });
  return error ? { error } : { id: parent.id };
}
