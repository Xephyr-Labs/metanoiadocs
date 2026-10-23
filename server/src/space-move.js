import { pool } from './db.js';
import { collectMove, isProjectOwnedPage } from './spaces.js';

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
export async function moveToSpace(client, root, spaceId, graph) {
  const m = collectMove(graph || (await loadSpaceGraph(client)), root);
  const set = (table, ids) =>
    ids.length ? client.query(`UPDATE ${table} SET space_id = $1 WHERE id = ANY($2)`, [spaceId, ids]) : null;
  await set('docs', m.docIds);
  await set('folders', m.folderIds);
  await set('projects', m.projectIds);
  if (m.clearFolderDocIds.length) {
    await client.query('UPDATE docs SET folder_id = NULL WHERE id = ANY($1)', [m.clearFolderDocIds]);
  }
  // A root left under a parent in another space would drag that parent's space with it.
  if (root.type === 'doc' || root.type === 'folder') {
    const t = TABLE[root.type];
    await client.query(
      `UPDATE ${t} c SET parent_id = NULL
        WHERE c.id = $1 AND EXISTS (SELECT 1 FROM ${t} p WHERE p.id = c.parent_id AND p.space_id IS DISTINCT FROM $2)`,
      [root.id, spaceId]
    );
  }
  return { docs: m.docIds.length, folders: m.folderIds.length, projects: m.projectIds.length };
}

export function registerSpaceMoveRoutes(app, { requireUser, wrap, editGrant }) {
  async function move(req, res, type) {
    const { id } = req.params;
    const spaceId = req.body?.spaceId;
    const client = await pool.connect();
    try {
      if (typeof spaceId !== 'string' || !(await client.query('SELECT 1 FROM spaces WHERE id = $1', [spaceId])).rowCount) {
        return res.status(404).json({ error: 'space not found' });
      }
      const graph = await loadSpaceGraph(client);
      if (!graph[TABLE[type]].some((r) => r.id === id)) return res.status(404).json({ error: 'not found' });
      if (type === 'doc') {
        if (!(await editGrant(id, req.user.id))) return res.status(403).json({ error: 'forbidden' });
        if (isProjectOwnedPage(graph, id)) return res.status(409).json({ error: 'Move the database instead' });
      }
      await client.query('BEGIN');
      try {
        const moved = await moveToSpace(client, { type, id }, spaceId, graph);
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
    });
  }));
}
