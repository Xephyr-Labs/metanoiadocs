// Starting points: pages you copy, and rows that begin already filled in.
//
// Every wiki has this and this one did not, so a weekly sync note was made by
// finding last week's, opening the ⋯ menu, and retyping the headings. The two
// halves are deliberately different mechanisms:
//
//   A page template IS a page. It is marked, not hidden — it stays in search,
//   in the sidebar and in All documents, because a template that lives
//   somewhere only an admin screen can reach is a template nobody maintains.
//   Using one copies its Yjs state byte for byte, which is the same trick the
//   AFFiNE import used and needs no knowledge of the block schema at all.
//
//   A row template is NOT a row. It is a small record of what a new row should
//   start with, in its own table, because a template task would otherwise have
//   to be filtered out of the board, the table, the calendar, the gantt, the
//   sweeper and every count — and each of those is a place to forget.
import crypto from 'node:crypto';
import * as Y from 'yjs';
import { pool } from './db.js';

const MAX_NAME = 120;
const MAX_BODY = 20000;

/**
 * A copy of `state` whose page title reads `title`.
 *
 * The chrome renders `docs.title` — the React input, not the document — so a
 * copy looks right in the header without this. The Yjs title still has to be
 * rewritten, because it is what the editor puts *back* into the title the first
 * time the page is edited, and what an export reads.
 */
export function retitleState(state, title) {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, new Uint8Array(state));
  const blocks = doc.getMap('blocks');
  for (const [, block] of blocks) {
    if (!(block instanceof Y.Map)) continue;
    if (block.get('sys:flavour') !== 'affine:page') continue;
    const text = new Y.Text();
    text.insert(0, String(title || ''));
    block.set('prop:title', text);
    break;
  }
  return Y.encodeStateAsUpdate(doc);
}

/** The one predicate that decides whether a signed-in person may see a doc. */
const VISIBLE = `(d.visibility = 'team'
                  OR EXISTS (SELECT 1 FROM doc_access a WHERE a.doc_id = d.id AND a.user_id = $1))`;

export function registerTemplateRoutes(app, { requireUser, wrap, grantOn }) {
  // ── page templates ────────────────────────────────────────────────────

  /** Every page template this person can open. */
  app.get('/api/templates', requireUser, wrap(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT d.id, d.title, d.icon, d.kind, d.updated_at,
              u.name AS created_by_name
         FROM docs d
         LEFT JOIN users u ON u.id = d.created_by
        WHERE d.deleted_at IS NULL AND d.is_template AND ${VISIBLE}
        ORDER BY d.title ASC`,
      [req.user.id]
    );
    res.json(rows);
  }));

  /** Mark a page as a template, or stop. Anyone who may edit the page may
   *  decide this — it is a label on their own page, not a permission. */
  app.post('/api/docs/:id/template', requireUser, wrap(async (req, res) => {
    if (!(await grantOn(req.params.id, req.user.id))) return res.status(403).json({ error: 'forbidden' });
    const on = req.body?.isTemplate !== false;
    const { rows } = await pool.query(
      `UPDATE docs SET is_template = $2 WHERE id = $1 AND deleted_at IS NULL
       RETURNING id, is_template`,
      [req.params.id, on]
    );
    if (!rows[0]) return res.status(404).json({ error: 'not found' });
    res.json({ id: rows[0].id, isTemplate: rows[0].is_template });
  }));

  /**
   * A new page from a template.
   *
   * The body is copied as bytes: no markdown round trip, so a table, an image,
   * a column layout and a database block all survive exactly as drawn. What is
   * deliberately *not* copied is everything that belongs to the original rather
   * than to its shape — comments, version history, tags, who made it, and
   * whether it was itself a template.
   */
  app.post('/api/templates/:id/use', requireUser, wrap(async (req, res) => {
    if (!(await grantOn(req.params.id, req.user.id))) return res.status(403).json({ error: 'forbidden' });
    const { rows: src } = await pool.query(
      `SELECT d.id, d.title, d.icon, d.kind, d.is_template, d.search_text, s.state
         FROM docs d LEFT JOIN doc_states s ON s.doc_id = d.id
        WHERE d.id = $1 AND d.deleted_at IS NULL`,
      [req.params.id]
    );
    if (!src[0]) return res.status(404).json({ error: 'not found' });
    if (!src[0].is_template) return res.status(400).json({ error: 'not a template' });

    const folderId = typeof req.body?.folderId === 'string' ? req.body.folderId : null;
    const title = String(req.body?.title || src[0].title || 'Untitled').slice(0, 200);
    const id = crypto.randomUUID();

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO docs (id, title, icon, created_by, folder_id, visibility, kind, search_text)
         VALUES ($1,$2,$3,$4,$5,'team',$6,$7)`,
        [id, title, src[0].icon, req.user.id, folderId, src[0].kind === 'design' ? 'design' : 'doc',
         String(src[0].search_text || '').slice(0, 100000)]
      );
      await client.query(
        `INSERT INTO doc_access (doc_id, user_id, role) VALUES ($1, $2, 'owner')`,
        [id, req.user.id]
      );
      if (src[0].state) {
        await client.query('INSERT INTO doc_states (doc_id, state) VALUES ($1, $2)',
          [id, Buffer.from(retitleState(src[0].state, title))]);
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    res.json({ id, title, icon: src[0].icon, folder_id: folderId, kind: src[0].kind, role: 'owner' });
  }));

  // ── row templates ─────────────────────────────────────────────────────

  const readRow = (body) => ({
    name: String(body?.name || 'Untitled').slice(0, MAX_NAME),
    icon: String(body?.icon || '📋').slice(0, 8),
    props: body?.props && typeof body.props === 'object' && !Array.isArray(body.props) ? body.props : {},
    fields: body?.fields && typeof body.fields === 'object' && !Array.isArray(body.fields) ? body.fields : {},
    body: typeof body?.body === 'string' ? body.body.slice(0, MAX_BODY) : null,
  });

  app.get('/api/projects/:id/row-templates', requireUser, wrap(async (req, res) => {
    const { rows } = await pool.query(
      'SELECT * FROM row_templates WHERE project_id = $1 ORDER BY position ASC, created_at ASC',
      [req.params.id]
    );
    res.json(rows);
  }));

  app.post('/api/projects/:id/row-templates', requireUser, wrap(async (req, res) => {
    const t = readRow(req.body);
    const { rows: project } = await pool.query(
      'SELECT id FROM projects WHERE id = $1 AND archived_at IS NULL', [req.params.id]);
    if (!project[0]) return res.status(404).json({ error: 'not found' });
    const { rows: pos } = await pool.query(
      'SELECT coalesce(max(position), 0) + 1 AS n FROM row_templates WHERE project_id = $1',
      [req.params.id]
    );
    const { rows } = await pool.query(
      `INSERT INTO row_templates (id, project_id, name, icon, props, fields, body, position)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [crypto.randomUUID(), req.params.id, t.name, t.icon,
       JSON.stringify(t.props), JSON.stringify(t.fields), t.body, pos[0].n]
    );
    res.json(rows[0]);
  }));

  app.patch('/api/row-templates/:id', requireUser, wrap(async (req, res) => {
    const sets = [];
    const vals = [req.params.id];
    const set = (col, value) => { vals.push(value); sets.push(`${col} = $${vals.length}`); };
    if (req.body?.name !== undefined) set('name', String(req.body.name || 'Untitled').slice(0, MAX_NAME));
    if (req.body?.icon !== undefined) set('icon', String(req.body.icon || '📋').slice(0, 8));
    if (req.body?.props !== undefined) set('props', JSON.stringify(readRow(req.body).props));
    if (req.body?.fields !== undefined) set('fields', JSON.stringify(readRow(req.body).fields));
    if (req.body?.body !== undefined) set('body', readRow(req.body).body);
    if (!sets.length) return res.status(400).json({ error: 'nothing to change' });
    const { rows } = await pool.query(
      `UPDATE row_templates SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, vals);
    if (!rows[0]) return res.status(404).json({ error: 'not found' });
    res.json(rows[0]);
  }));

  app.delete('/api/row-templates/:id', requireUser, wrap(async (req, res) => {
    await pool.query('DELETE FROM row_templates WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  }));
}

/** The template a create is asking for, or null when it is not this database's. */
export async function rowTemplateFor(templateId, projectId) {
  const { rows } = await pool.query(
    'SELECT * FROM row_templates WHERE id = $1 AND project_id = $2', [templateId, projectId]);
  return rows[0] ?? null;
}

/**
 * The built-in fields a row template is allowed to preset.
 *
 * A closed list, so a template cannot set `createdBy`, `docId` or a parent —
 * and dates are not on it on purpose: a template that always starts a task on
 * 4 March is wrong the day after it is written.
 */
export const TEMPLATE_FIELDS = [
  'title', 'status', 'priority', 'kind', 'points', 'estimateH', 'repeatRule',
  'assigneeIds', 'milestone',
];

/**
 * The create-request body a template implies, given what was actually asked
 * for. Pure, so the precedence rule is testable: **the request always wins**.
 * A template is a starting point, not an override — if it could overrule what
 * was typed, the field it overruled would look like a bug in the form.
 */
export function applyRowTemplate(body, template) {
  const out = { ...body };
  const fields = template?.fields && typeof template.fields === 'object' ? template.fields : {};
  for (const key of TEMPLATE_FIELDS) {
    if (out[key] === undefined && fields[key] !== undefined) out[key] = fields[key];
  }
  const tprops = template?.props && typeof template.props === 'object' ? template.props : {};
  out.props = { ...tprops, ...(body?.props ?? {}) };
  return out;
}
