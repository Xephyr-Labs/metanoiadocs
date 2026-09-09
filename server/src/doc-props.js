// Page properties: workspace-wide definitions, per-page values.
//
// Deliberately a sibling of props-routes.js rather than a generalisation of it.
// The two differ where it matters — a database property is scoped to a project
// and can be a relation into its rows; a page property is scoped to the
// workspace and cannot — and the shared parts (key derivation, type changes,
// option and value coercion) already live in props.js, which both import.

import crypto from 'node:crypto';
import { pool } from './db.js';
import { PROP_TYPES, propKey, canChangeType, normalizeOptions, propsPatch } from './props.js';

const MAX_PROPS = 40;

/** Relations point at rows in a database, which a page has none of. */
export const DOC_PROP_TYPES = PROP_TYPES.filter((t) => t !== 'relation');

export async function docPropsAll() {
  const { rows } = await pool.query(
    'SELECT * FROM doc_props ORDER BY position ASC, created_at ASC'
  );
  return rows;
}

export function registerDocPropRoutes(app, { requireUser, wrap, grantOn }) {
  app.get('/api/doc-props', requireUser, wrap(async (_req, res) => {
    res.json(await docPropsAll());
  }));

  app.post('/api/doc-props', requireUser, wrap(async (req, res) => {
    const label = String(req.body?.label ?? '').trim().slice(0, 60);
    if (!label) return res.status(400).json({ error: 'Give the property a name.' });
    const type = String(req.body?.type || 'text');
    if (!DOC_PROP_TYPES.includes(type)) return res.status(400).json({ error: 'unknown property type' });

    const existing = await docPropsAll();
    if (existing.length >= MAX_PROPS) {
      return res.status(400).json({ error: `A workspace can have at most ${MAX_PROPS} page properties.` });
    }
    const { rows } = await pool.query(
      `INSERT INTO doc_props (id, key, label, type, options, position)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [
        crypto.randomUUID(),
        propKey(label, existing.map((p) => p.key)),
        label,
        type,
        JSON.stringify(normalizeOptions(req.body?.options)),
        existing.length,
      ]
    );
    res.json(rows[0]);
  }));

  app.patch('/api/doc-props/:id', requireUser, wrap(async (req, res) => {
    const b = req.body || {};
    const { rows: cur } = await pool.query('SELECT * FROM doc_props WHERE id = $1', [req.params.id]);
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
      if (!DOC_PROP_TYPES.includes(b.type)) return res.status(400).json({ error: 'unknown property type' });
      // Same rule as a database property: only pairs that leave the stored
      // value readable, so a rename never silently empties a page.
      if (!canChangeType(cur[0].type, b.type)) {
        return res.status(400).json({ error: `Cannot change a ${cur[0].type} property to ${b.type}.` });
      }
      set('type', b.type);
    }
    if (b.options !== undefined) set('options', JSON.stringify(normalizeOptions(b.options)));
    if (b.position !== undefined) set('position', Number(b.position) || 0);
    if (!sets.length) return res.json(cur[0]);

    vals.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE doc_props SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING *`, vals
    );
    res.json(rows[0]);
  }));

  app.delete('/api/doc-props/:id', requireUser, wrap(async (req, res) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: [prop] } = await client.query(
        'SELECT * FROM doc_props WHERE id = $1 FOR UPDATE', [req.params.id]
      );
      if (!prop) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'not found' });
      }
      // Strip the values too, or every page keeps a key nothing can read.
      await client.query('UPDATE docs SET props = props - $1 WHERE props ? $1', [prop.id]);
      await client.query('DELETE FROM doc_props WHERE id = $1', [prop.id]);
      await client.query('COMMIT');
      res.json({ ok: true });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }));

  /** Set values on one page. Merges, so an untouched property survives. */
  app.patch('/api/docs/:id/props', requireUser, wrap(async (req, res) => {
    if (!(await grantOn(req.params.id, req.user.id))) return res.status(403).json({ error: 'forbidden' });
    const checked = propsPatch(await docPropsAll(), req.body?.props ?? {});
    if (!checked.ok) return res.status(400).json({ error: checked.error });
    const { rows } = await pool.query(
      `UPDATE docs SET props = props || $1::jsonb, updated_at = now()
        WHERE id = $2 AND deleted_at IS NULL RETURNING props`,
      [JSON.stringify(checked.value), req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'not found' });
    res.json(rows[0]);
  }));

  /** Remove one property's value from one page, without deleting the property. */
  app.delete('/api/docs/:id/props/:propId', requireUser, wrap(async (req, res) => {
    if (!(await grantOn(req.params.id, req.user.id))) return res.status(403).json({ error: 'forbidden' });
    const { rows } = await pool.query(
      'UPDATE docs SET props = props - $1, updated_at = now() WHERE id = $2 RETURNING props',
      [req.params.propId, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'not found' });
    res.json(rows[0]);
  }));
}
