import crypto from 'node:crypto';
import { pool } from './db.js';
import { wouldFolderCycle, safeFolderOrder } from './folders.js';

/** Folders are workspace-wide structure: every member sees and edits every
 *  folder (matching the team-editable doc model). Only doc *contents* carry
 *  visibility. So "accessible" just means it exists and isn't deleted —
 *  an empty folder must not vanish for everyone but its creator. */
export async function visibleFolder(id, _userId) {
  const { rowCount } = await pool.query(
    'SELECT 1 FROM folders WHERE id = $1 AND deleted_at IS NULL',
    [id]
  );
  return !!rowCount;
}

async function folderParents() {
  const { rows } = await pool.query('SELECT id, parent_id FROM folders WHERE deleted_at IS NULL');
  return new Map(rows.map((row) => [row.id, row.parent_id]));
}

export function registerFolderRoutes(app, { requireUser, wrap }) {
  app.get('/api/folders', requireUser, wrap(async (_req, res) => {
    const { rows } = await pool.query(
      `SELECT f.id, f.name, f.parent_id, f.position, f.color, f.created_by, f.created_at,
              (SELECT count(*)::int FROM docs d
                WHERE d.folder_id = f.id AND d.deleted_at IS NULL) AS document_count,
              (SELECT count(*)::int FROM folders child
                WHERE child.parent_id = f.id AND child.deleted_at IS NULL) AS folder_count
         FROM folders f
        WHERE f.deleted_at IS NULL
        ORDER BY f.parent_id NULLS FIRST, f.position ASC, lower(f.name), f.id`
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
       RETURNING id, name, parent_id, position, color, created_by, created_at`,
      [id, name, parentId, req.user.id]
    );
    res.json(rows[0]);
  }));

  // Drag-reorder, mirroring /api/docs/reorder: `ids` is the whole sibling list
  // in its new order, so one request settles the move and the ordering together.
  // Registered before /:id so "reorder" is never read as a folder id.
  app.post('/api/folders/reorder', requireUser, wrap(async (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter((v) => typeof v === 'string').slice(0, 2000) : [];
    if (!ids.length) return res.status(400).json({ error: 'ids required' });
    const parentId = typeof req.body?.parentId === 'string' ? req.body.parentId : null;
    if (parentId && !(await visibleFolder(parentId, req.user.id))) {
      return res.status(403).json({ error: 'folder not accessible' });
    }
    const safe = safeFolderOrder(await folderParents(), ids, parentId);
    if (!safe.length) return res.status(400).json({ error: 'move would create a cycle' });
    const { rowCount } = await pool.query(
      `UPDATE folders f
          SET position = o.pos, parent_id = $2
         FROM (SELECT id, ordinality - 1 AS pos
                 FROM unnest($1::text[]) WITH ORDINALITY AS t(id, ordinality)) o
        WHERE f.id = o.id AND f.deleted_at IS NULL`,
      [safe, parentId],
    );
    res.json({ ok: true, moved: rowCount });
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
    if (typeof req.body?.color === 'string') {
      values.push(req.body.color.slice(0, 20));
      sets.push(`color = $${values.length}`);
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
