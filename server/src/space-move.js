import { pool, defaultSpaceId } from './db.js';
import { collectMove, carriesProjectPage, resolveSpace } from './spaces.js';

const TABLE = { doc: 'docs', folder: 'folders', project: 'projects' };

/** ponytail: loads the whole graph per move; a recursive CTE if workspaces get large. */
export async function loadSpaceGraph(client) {
  const q = async (sql) => (await client.query(sql)).rows;
  return {
    docs: await q('SELECT id, parent_id, folder_id, kind FROM docs'),
    folders: await q('SELECT id, parent_id FROM folders'),
    projects: await q('SELECT id, parent_id, doc_id FROM projects'),
    tasks: await q('SELECT project_id, doc_id FROM tasks WHERE doc_id IS NOT NULL'),
  };
}

/** Moves `root` ({type,id}) and everything with it into `spaceId`. Runs in the caller's transaction. */
export async function moveToSpace(client, root, spaceId) {
  const m = collectMove(await loadSpaceGraph(client), root);
  const set = (table, ids) =>
    ids.length ? client.query(`UPDATE ${table} SET space_id = $1 WHERE id = ANY($2)`, [spaceId, ids]) : null;
  await set('docs', m.docIds);
  await set('folders', m.folderIds);
  await set('projects', m.projectIds);
  if (m.clearFolderDocIds.length) {
    await client.query('UPDATE docs SET folder_id = NULL WHERE id = ANY($1)', [m.clearFolderDocIds]);
  }
  // An item left under a parent that stays behind would drag that parent's
  // space with it: the root, and e.g. a database's task pages under some page.
  for (const [table, ids] of [['docs', m.detach.docs], ['folders', m.detach.folders], ['projects', m.detach.projects]]) {
    if (ids.length) await client.query(`UPDATE ${table} SET parent_id = NULL WHERE id = ANY($1)`, [ids]);
  }
  return { docs: m.docIds.length, folders: m.folderIds.length, projects: m.projectIds.length };
}

/** Runs `fn(client)` in one transaction on its own pool client. */
export async function inTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/** The space_id of a doc, folder or project row; null for no id or no row. */
export async function spaceOf(client, type, id) {
  if (!id) return null;
  const { rows } = await client.query(`SELECT space_id FROM ${TABLE[type]} WHERE id = $1`, [id]);
  return rows[0]?.space_id ?? null;
}

/**
 * The space a new item lands in. `requested` (the client's spaceId) counts only
 * when it names a real space; with none, `fallback`, then the default space —
 * so an old client that sends no spaceId still creates in General.
 */
export async function spaceForNew(client, { parentSpace, folderSpace, requested, fallback }) {
  const real = typeof requested === 'string' && requested !== ''
    && (await client.query('SELECT 1 FROM spaces WHERE id = $1', [requested])).rowCount > 0;
  return resolveSpace({ parentSpace, folderSpace, requested: real ? requested : null, fallback })
    ?? defaultSpaceId(client);
}

/**
 * Readies `root` for a reparent into `targetSpace`: 'same' when nothing has to
 * move (or there is no target: a move to the top level keeps its space),
 * 'owned' when the move would carry a database's own page (the root or one
 * below it), which only moves with its database,
 * else it moves the tree and answers 'move'. Call it BEFORE the reparent UPDATE:
 * the move detaches the root and may clear its folder, and the UPDATE then sets
 * the new parent or folder over that.
 */
export async function reparentInto(client, root, targetSpace, { dryRun = false } = {}) {
  if (!targetSpace || (await spaceOf(client, root.type, root.id)) === targetSpace) return 'same';
  if (carriesProjectPage(await loadSpaceGraph(client), root)) return 'owned';
  if (!dryRun) await moveToSpace(client, root, targetSpace);
  return 'move';
}

export const OWNED_PAGE = 'Move the database instead';

export function registerSpaceMoveRoutes(app, { requireUser, wrap, editGrant }) {
  async function move(req, res, type) {
    const { id } = req.params;
    const spaceId = req.body?.spaceId;
    const client = await pool.connect();
    try {
      if (typeof spaceId !== 'string' || !(await client.query('SELECT 1 FROM spaces WHERE id = $1', [spaceId])).rowCount) {
        return res.status(404).json({ error: 'space not found' });
      }
      // Early checks only; the move itself reloads the graph inside the transaction.
      const graph = await loadSpaceGraph(client);
      if (!graph[TABLE[type]].some((r) => r.id === id)) return res.status(404).json({ error: 'not found' });
      if (type === 'doc' && !(await editGrant(id, req.user.id))) return res.status(403).json({ error: 'forbidden' });
      // Already there: nothing moves. Running the move anyway would still clear
      // folder links and detach the root.
      if ((await spaceOf(client, type, id)) === spaceId) return res.json({ docs: 0, folders: 0, projects: 0 });
      if (carriesProjectPage(graph, { type, id })) return res.status(409).json({ error: OWNED_PAGE });
      await client.query('BEGIN');
      try {
        const moved = await moveToSpace(client, { type, id }, spaceId);
        await client.query('COMMIT');
        res.json(moved);
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      }
    } finally {
      client.release();
    }
  }

  app.post('/api/docs/:id/space', requireUser, wrap((req, res) => move(req, res, 'doc')));
  app.post('/api/folders/:id/space', requireUser, wrap((req, res) => move(req, res, 'folder')));
  app.post('/api/projects/:id/space', requireUser, wrap((req, res) => move(req, res, 'project')));

  app.get('/api/move-preview', requireUser, wrap(async (req, res) => {
    const { type, id, spaceId } = req.query;
    if (!TABLE[type]) return res.status(400).json({ error: 'bad type' });
    if (!(await pool.query('SELECT 1 FROM spaces WHERE id = $1', [spaceId])).rowCount) {
      return res.status(404).json({ error: 'space not found' });
    }
    const graph = await loadSpaceGraph(pool);
    if (!graph[TABLE[type]].some((r) => r.id === id)) return res.status(404).json({ error: 'not found' });
    const m = collectMove(graph, { type, id });
    // Count real rows (a project's doc_id may dangle); "visible" mirrors GET /api/docs.
    const { rows } = await pool.query(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE a.user_id IS NOT NULL OR d.visibility = 'team')::int AS visible
         FROM docs d LEFT JOIN doc_access a ON a.doc_id = d.id AND a.user_id = $2
        WHERE d.id = ANY($1)`,
      [m.docIds, req.user.id]
    );
    res.json({
      docs: rows[0].visible,
      folders: m.folderIds.length,
      projects: m.projectIds.length,
      hidden: rows[0].total > rows[0].visible,
      // The move would be refused ("Move the database instead"), so the client can say so up front.
      owned: carriesProjectPage(graph, { type, id }),
    });
  }));
}
