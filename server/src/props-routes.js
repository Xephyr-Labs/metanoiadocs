import crypto from 'node:crypto';
import { pool } from './db.js';
import { PROP_TYPES, propKey, canChangeType, normalizeOptions, relationError } from './props.js';

const MAX_PROPS = 40;

export async function propsFor(projectId) {
  const { rows } = await pool.query(
    'SELECT * FROM db_props WHERE project_id = $1 ORDER BY position ASC, created_at ASC',
    [projectId]
  );
  return rows;
}

export function registerPropRoutes(app, { requireUser, wrap }) {
  app.get('/api/projects/:id/props', requireUser, wrap(async (req, res) => {
    res.json(await propsFor(req.params.id));
  }));

  app.post('/api/projects/:id/props', requireUser, wrap(async (req, res) => {
    const label = String(req.body?.label ?? '').trim().slice(0, 60);
    if (!label) return res.status(400).json({ error: 'Give the property a name.' });
    const type = String(req.body?.type || 'text');
    if (!PROP_TYPES.includes(type)) return res.status(400).json({ error: 'unknown property type' });

    let targetProjectId = null;
    if (type === 'relation') {
      targetProjectId = req.body?.targetProjectId || null;
      const { rowCount } = await pool.query(
        'SELECT 1 FROM projects WHERE id = $1 AND archived_at IS NULL',
        [targetProjectId]
      );
      if (!rowCount) return res.status(400).json({ error: 'a relation needs a target database' });
    }

    const existing = await propsFor(req.params.id);
    if (existing.length >= MAX_PROPS) {
      return res.status(400).json({ error: `A database can have at most ${MAX_PROPS} properties.` });
    }
    const { rows } = await pool.query(
      `INSERT INTO db_props (id, project_id, key, label, type, options, target_project_id, position)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [
        crypto.randomUUID(),
        req.params.id,
        propKey(label, existing.map((p) => p.key)),
        label,
        type,
        JSON.stringify(normalizeOptions(req.body?.options)),
        targetProjectId,
        existing.length,
      ]
    );
    res.json(rows[0]);
  }));

  app.patch('/api/props/:id', requireUser, wrap(async (req, res) => {
    const b = req.body || {};
    const { rows: cur } = await pool.query('SELECT * FROM db_props WHERE id = $1', [req.params.id]);
    if (!cur[0]) return res.status(404).json({ error: 'not found' });

    const sets = [];
    const vals = [];
    const set = (col, v) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };

    if (b.label !== undefined) {
      const label = String(b.label).trim().slice(0, 60);
      if (!label) return res.status(400).json({ error: 'Give the property a name.' });
      set('label', label);
    }
    if (b.type !== undefined && b.type !== cur[0].type) {
      if (!PROP_TYPES.includes(b.type)) return res.status(400).json({ error: 'unknown property type' });
      if (!canChangeType(cur[0].type, b.type)) {
        return res.status(400).json({ error: `Cannot change a ${cur[0].type} property to ${b.type}.` });
      }
      set('type', b.type);
    }
    if (b.options !== undefined) set('options', JSON.stringify(normalizeOptions(b.options)));
    if (b.position !== undefined) set('position', Number(b.position) || 0);
    if (b.targetProjectId !== undefined) set('target_project_id', b.targetProjectId || null);
    if (!sets.length) return res.json(cur[0]);

    vals.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE db_props SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING *`, vals
    );
    res.json(rows[0]);
  }));

  app.delete('/api/props/:id', requireUser, wrap(async (req, res) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: [prop] } = await client.query(
        'SELECT * FROM db_props WHERE id = $1 FOR UPDATE', [req.params.id]
      );
      if (!prop) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'not found' });
      }
      await client.query('UPDATE tasks SET props = props - $1 WHERE project_id = $2', [
        prop.id, prop.project_id,
      ]);
      await client.query('DELETE FROM db_props WHERE id = $1', [prop.id]);
      await client.query('COMMIT');
      res.json({ ok: true });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }));

  const RELATED = `
    SELECT t.id, t.title, t.project_id, p.name AS project_name, t.doc_id
      FROM tasks t JOIN projects p ON p.id = t.project_id
     WHERE t.deleted_at IS NULL`;

  async function edgeContext(taskId, propId, toId) {
    const { rows } = await pool.query(
      'SELECT id, project_id FROM tasks WHERE id = ANY($1) AND deleted_at IS NULL',
      [[taskId, toId]]
    );
    const from = rows.find((r) => r.id === taskId);
    const to = rows.find((r) => r.id === toId);
    if (!from || !to) return { error: 'not found', status: 404 };
    const { rows: props } = await pool.query('SELECT * FROM db_props WHERE id = $1', [propId]);
    const bad = relationError(props[0] ?? null, from.project_id, to.project_id);
    return bad ? { error: bad, status: 400 } : { ok: true };
  }

  app.post('/api/tasks/:id/relations', requireUser, wrap(async (req, res) => {
    const { propId, toId } = req.body || {};
    if (!propId || !toId) return res.status(400).json({ error: 'propId and toId required' });
    const ctx = await edgeContext(req.params.id, propId, toId);
    if (ctx.error) return res.status(ctx.status).json({ error: ctx.error });
    await pool.query(
      `INSERT INTO task_relations (prop_id, from_id, to_id) VALUES ($1,$2,$3)
       ON CONFLICT DO NOTHING`,
      [propId, req.params.id, toId]
    );
    res.json({ ok: true });
  }));

  app.delete('/api/tasks/:id/relations', requireUser, wrap(async (req, res) => {
    const { propId, toId } = req.body || {};
    await pool.query(
      'DELETE FROM task_relations WHERE prop_id = $1 AND from_id = $2 AND to_id = $3',
      [propId, req.params.id, toId]
    );
    res.json({ ok: true });
  }));

  app.get('/api/tasks/:id', requireUser, wrap(async (req, res) => {
    const { rows } = await pool.query(
      'SELECT * FROM tasks WHERE id = $1 AND deleted_at IS NULL', [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'not found' });
    const { rows: out } = await pool.query(
      `${RELATED} AND t.id IN (SELECT to_id FROM task_relations WHERE from_id = $1)`,
      [req.params.id]
    );
    const { rows: edges } = await pool.query(
      'SELECT prop_id, to_id FROM task_relations WHERE from_id = $1', [req.params.id]
    );
    const { rows: backlinks } = await pool.query(
      `${RELATED} AND t.id IN (SELECT from_id FROM task_relations WHERE to_id = $1)`,
      [req.params.id]
    );
    const byId = new Map(out.map((r) => [r.id, r]));
    const relations = {};
    for (const e of edges) {
      const row = byId.get(e.to_id);
      if (row) (relations[e.prop_id] ||= []).push(row);
    }
    res.json({ ...rows[0], relations, backlinks });
  }));
}
