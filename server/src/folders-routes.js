import crypto from 'node:crypto';
import { pool } from './db.js';
import { wouldFolderCycle } from './folders.js';

const visibleDoc = (userPlaceholder) => `(d.deleted_at IS NULL AND (d.visibility = 'team' OR EXISTS (
  SELECT 1 FROM doc_access da WHERE da.doc_id = d.id AND da.user_id = ${userPlaceholder}
)))`;

/** One authz rule for folders everywhere: creator, or any visible doc in the
 *  subtree. index.js reuses this for create-in / move-to checks. */
export async function visibleFolder(id, userId) {
  const { rowCount } = await pool.query(
    `WITH RECURSIVE descendants AS (
       SELECT id FROM folders WHERE id = $1 AND deleted_at IS NULL
       UNION ALL
       SELECT f.id FROM folders f JOIN descendants d ON f.parent_id = d.id
        WHERE f.deleted_at IS NULL
     )
     SELECT 1
       FROM folders f
      WHERE f.id = $1 AND f.deleted_at IS NULL
        AND (f.created_by = $2 OR EXISTS (
          SELECT 1 FROM docs d WHERE d.folder_id IN (SELECT id FROM descendants)
            AND ${visibleDoc('$2')}
        ))`,
    [id, userId]
  );
  return !!rowCount;
}

async function folderParents() {
  const { rows } = await pool.query('SELECT id, parent_id FROM folders WHERE deleted_at IS NULL');
  return new Map(rows.map((row) => [row.id, row.parent_id]));
}

export function registerFolderRoutes(app, { requireUser, wrap }) {
  app.get('/api/folders', requireUser, wrap(async (req, res) => {
    const { rows } = await pool.query(
      `WITH RECURSIVE visible AS (
         SELECT f.id, f.name, f.parent_id, f.position, f.created_by, f.created_at
           FROM folders f
          WHERE f.deleted_at IS NULL
            AND (f.created_by = $1 OR EXISTS (
              SELECT 1 FROM docs d WHERE d.folder_id = f.id AND ${visibleDoc('$1')}
            ))
         UNION
         SELECT parent.id, parent.name, parent.parent_id, parent.position,
                parent.created_by, parent.created_at
           FROM folders parent JOIN visible child ON child.parent_id = parent.id
          WHERE parent.deleted_at IS NULL
       )
       SELECT v.*,
              (SELECT count(*)::int FROM docs d
                WHERE d.folder_id = v.id AND d.deleted_at IS NULL) AS document_count,
              (SELECT count(*)::int FROM folders child
                WHERE child.parent_id = v.id AND child.deleted_at IS NULL) AS folder_count
         FROM visible v
        ORDER BY v.parent_id NULLS FIRST, v.position ASC, lower(v.name), v.id`,
      [req.user.id]
    );
    res.json(rows);
  }));

  app.post('/api/folders', requireUser, wrap(async (req, res) => {
    const name = String(req.body?.name || '').trim().slice(0, 200);
    if (!name) return res.status(400).json({ error: 'name required' });
    const parentId = req.body?.parentId || null;
    if (parentId && !(await visibleFolder(parentId, req.user.id))) {
      return res.status(403).json({ error: 'folder not accessible' });
    }
    const id = crypto.randomUUID();
    const { rows } = await pool.query(
      `INSERT INTO folders (id, name, parent_id, position, created_by)
       VALUES ($1, $2, $3, COALESCE((SELECT max(position) + 1 FROM folders WHERE parent_id IS NOT DISTINCT FROM $3 AND deleted_at IS NULL), 0), $4)
       RETURNING id, name, parent_id, position, created_by, created_at`,
      [id, name, parentId, req.user.id]
    );
    res.json(rows[0]);
  }));

  app.patch('/api/folders/:id', requireUser, wrap(async (req, res) => {
    if (!(await visibleFolder(req.params.id, req.user.id))) return res.status(403).json({ error: 'folder not accessible' });
    const sets = [];
    const values = [];
    if (typeof req.body?.name === 'string') {
      const name = req.body.name.trim().slice(0, 200);
      if (!name) return res.status(400).json({ error: 'name required' });
      values.push(name);
      sets.push(`name = $${values.length}`);
    }
    if ('parentId' in (req.body || {})) {
      const parentId = req.body.parentId || null;
      if (parentId && !(await visibleFolder(parentId, req.user.id))) return res.status(403).json({ error: 'folder not accessible' });
      if (wouldFolderCycle(await folderParents(), req.params.id, parentId)) {
        return res.status(400).json({ error: 'move would create a cycle' });
      }
      values.push(parentId);
      sets.push(`parent_id = $${values.length}`);
    }
    if (!sets.length) return res.json({ ok: true });
    values.push(req.params.id);
    await pool.query(`UPDATE folders SET ${sets.join(', ')} WHERE id = $${values.length} AND deleted_at IS NULL`, values);
    res.json({ ok: true });
  }));

  app.delete('/api/folders/:id', requireUser, wrap(async (req, res) => {
    if (!(await visibleFolder(req.params.id, req.user.id))) return res.status(403).json({ error: 'folder not accessible' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const current = await client.query('SELECT parent_id FROM folders WHERE id = $1 AND deleted_at IS NULL', [req.params.id]);
      const parentId = current.rows[0]?.parent_id || null;
      await client.query('UPDATE docs SET folder_id = $1 WHERE folder_id = $2 AND deleted_at IS NULL', [parentId, req.params.id]);
      await client.query('UPDATE folders SET parent_id = $1 WHERE parent_id = $2 AND deleted_at IS NULL', [parentId, req.params.id]);
      await client.query('UPDATE folders SET deleted_at = now() WHERE id = $1', [req.params.id]);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    res.json({ ok: true });
  }));

}
