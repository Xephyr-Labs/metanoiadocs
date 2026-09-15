import crypto from 'node:crypto';
import { pool } from './db.js';
import { PROP_TYPES, propKey, canChangeType, normalizeConfig, normalizeOptions, relationError } from './props.js';

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

    const config = normalizeConfig(type, req.body?.config);
    if (config === undefined) return res.status(400).json({ error: 'bad config' });

    const existing = await propsFor(req.params.id);
    if (existing.length >= MAX_PROPS) {
      return res.status(400).json({ error: `A database can have at most ${MAX_PROPS} properties.` });
    }
    const { rows } = await pool.query(
      `INSERT INTO db_props (id, project_id, key, label, type, options, target_project_id, position, config)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [
        crypto.randomUUID(),
        req.params.id,
        propKey(label, existing.map((p) => p.key)),
        label,
        type,
        JSON.stringify(normalizeOptions(req.body?.options)),
        targetProjectId,
        existing.length,
        JSON.stringify(config),
      ]
    );

    // A two-way relation gets its other half on the target database, pointing
    // back. The edges themselves stay under the *defining* property — the
    // inverse reads task_relations backwards rather than duplicating every
    // row, so the two halves can never disagree about what is linked.
    if (type === 'relation' && req.body?.twoWay && targetProjectId !== req.params.id) {
      const target = await propsFor(targetProjectId);
      if (target.length < MAX_PROPS) {
        const { rows: inverse } = await pool.query(
          `INSERT INTO db_props
             (id, project_id, key, label, type, options, target_project_id, position, paired_prop_id, is_inverse)
           VALUES ($1,$2,$3,$4,'relation','[]'::jsonb,$5,$6,$7,true) RETURNING id`,
          [
            crypto.randomUUID(),
            targetProjectId,
            propKey(String(req.body?.inverseLabel || label), target.map((x) => x.key)),
            String(req.body?.inverseLabel || label).trim().slice(0, 60) || label,
            req.params.id,
            target.length,
            rows[0].id,
          ]
        );
        await pool.query('UPDATE db_props SET paired_prop_id = $1 WHERE id = $2', [inverse[0].id, rows[0].id]);
        rows[0].paired_prop_id = inverse[0].id;
      }
    }
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
    if (b.config !== undefined) {
      const config = normalizeConfig(b.type ?? cur[0].type, b.config);
      if (config === undefined) return res.status(400).json({ error: 'bad config' });
      set('config', JSON.stringify(config));
    }
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

  /**
   * The edge a write should touch.
   *
   * A two-way relation stores one row, under the *defining* property. Linking
   * from the inverse side is therefore the same edge written backwards — which
   * is what keeps the two halves from ever disagreeing about what is linked.
   */
  async function edgeFor(propId, fromId, toId) {
    const { rows } = await pool.query('SELECT id, paired_prop_id, is_inverse FROM db_props WHERE id = $1', [propId]);
    const prop = rows[0];
    if (prop?.is_inverse && prop.paired_prop_id) {
      return { propId: prop.paired_prop_id, from: toId, to: fromId, flipped: true };
    }
    return { propId, from: fromId, to: toId, flipped: false };
  }

  app.post('/api/tasks/:id/relations', requireUser, wrap(async (req, res) => {
    const { propId, toId } = req.body || {};
    if (!propId || !toId) return res.status(400).json({ error: 'propId and toId required' });
    const edge = await edgeFor(propId, req.params.id, toId);
    const ctx = await edgeContext(edge.from, edge.propId, edge.to);
    if (ctx.error) return res.status(ctx.status).json({ error: ctx.error });
    await pool.query(
      `INSERT INTO task_relations (prop_id, from_id, to_id) VALUES ($1,$2,$3)
       ON CONFLICT DO NOTHING`,
      [edge.propId, edge.from, edge.to]
    );
    res.json({ ok: true });
  }));

  app.delete('/api/tasks/:id/relations', requireUser, wrap(async (req, res) => {
    const { propId, toId } = req.body || {};
    if (!propId || !toId) return res.status(400).json({ error: 'propId and toId required' });
    const edge = await edgeFor(propId, req.params.id, toId);
    await pool.query(
      'DELETE FROM task_relations WHERE prop_id = $1 AND from_id = $2 AND to_id = $3',
      [edge.propId, edge.from, edge.to]
    );
    res.json({ ok: true });
  }));

  app.get('/api/tasks/:id', requireUser, wrap(async (req, res) => {
    const { rows } = await pool.query(
      'SELECT * FROM tasks WHERE id = $1 AND deleted_at IS NULL', [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'not found' });
    // Edges in both directions. A two-way relation stores one row, under the
    // defining property — so the inverse half's rows are the same edges read
    // backwards, reported under the inverse property's own id. Without this
    // the generated half of every two-way relation would look empty.
    const { rows: edges } = await pool.query(
      `SELECT p.id AS prop_id,
              CASE WHEN p.is_inverse THEN r.from_id ELSE r.to_id END AS other_id
         FROM db_props p
         JOIN task_relations r
           ON r.prop_id = CASE WHEN p.is_inverse THEN p.paired_prop_id ELSE p.id END
          AND (CASE WHEN p.is_inverse THEN r.to_id ELSE r.from_id END) = $1
        WHERE p.type = 'relation'`,
      [req.params.id]
    );
    const { rows: out } = await pool.query(
      `${RELATED} AND t.id = ANY($1)`,
      [edges.map((e) => e.other_id)]
    );
    // "Which rows point at me" — every incoming edge, whatever property drew
    // it. Distinct from the inverse half above, which is one named property.
    const { rows: backlinks } = await pool.query(
      `${RELATED} AND t.id IN (SELECT from_id FROM task_relations WHERE to_id = $1)`,
      [req.params.id]
    );
    const byId = new Map(out.map((r) => [r.id, r]));
    const relations = {};
    for (const e of edges) {
      const row = byId.get(e.other_id);
      if (row) (relations[e.prop_id] ||= []).push(row);
    }
    res.json({ ...rows[0], relations, backlinks });
  }));
}
