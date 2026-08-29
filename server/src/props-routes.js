import crypto from 'node:crypto';
import { pool } from './db.js';
import { PROP_TYPES, propKey, canChangeType, normalizeOptions } from './props.js';

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
}
