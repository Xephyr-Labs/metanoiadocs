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
import { isRepeatRule } from './repeat.js';
import { knownUsers } from './task-writes.js';

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

/**
 * A template's built-in fields, checked against the database it belongs to.
 *
 * Checked here rather than when a row is made from it, because a template is
 * written once and used every day: a rule saved as "fortnightly" made every
 * single "New from template" answer `bad repeat rule` — a complaint about
 * something the person clicking had never typed — and a person named here who
 * later left the workspace made it answer `internal error`.
 *
 * Returns `{ ok, fields }` or `{ ok: false, error }`. Unknown keys are dropped
 * rather than refused: TEMPLATE_FIELDS is the list of what a template may set,
 * and something not on it is not an error, it is simply not a field.
 *
 * `kinds` and `isStatus` are handed in rather than imported: tasks.js imports
 * this file for `applyRowTemplate`, so importing it back would be a cycle. Same
 * reason `grantOn` and `createDocRow` arrive as arguments.
 */
export async function checkTemplateFields(raw, { kinds, isStatus }) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const out = {};

  if (src.title !== undefined) out.title = String(src.title ?? '').slice(0, 500);
  if (src.status !== undefined && src.status !== null) {
    if (!isStatus(src.status)) return { ok: false, error: 'bad status' };
    out.status = src.status;
  }
  if (src.kind !== undefined && src.kind !== null) {
    if (!kinds.some((k) => k.key === src.kind)) return { ok: false, error: 'no such type in this database' };
    out.kind = src.kind;
  }
  if (src.repeatRule !== undefined && src.repeatRule !== null) {
    if (!isRepeatRule(src.repeatRule)) return { ok: false, error: 'bad repeat rule' };
    out.repeatRule = src.repeatRule;
  }
  for (const [key, min, max] of [['priority', 0, 4], ['points', 0, 1000], ['estimateH', 0, 10000]]) {
    if (src[key] === undefined || src[key] === null) continue;
    const n = Number(src[key]);
    if (!Number.isFinite(n)) return { ok: false, error: `${key} has to be a number` };
    out[key] = Math.min(max, Math.max(min, key === 'estimateH' ? Math.round(n * 10) / 10 : Math.round(n)));
  }
  if (src.milestone !== undefined) out.milestone = src.milestone === true;
  if (src.assigneeIds !== undefined) {
    const ids = Array.isArray(src.assigneeIds) ? src.assigneeIds.filter((v) => typeof v === 'string') : [];
    // Dropped rather than refused: somebody leaving the workspace should not
    // make every template that named them unsaveable.
    out.assigneeIds = await knownUsers(ids.slice(0, 20));
  }
  return { ok: true, fields: out };
}

/** The one predicate that decides whether a signed-in person may see a doc. */
const VISIBLE = `(d.visibility = 'team'
                  OR EXISTS (SELECT 1 FROM doc_access a WHERE a.doc_id = d.id AND a.user_id = $1))`;

export function registerTemplateRoutes(app, { requireUser, wrap, grantOn, kindsFor, isStatus }) {
  // ── page templates ────────────────────────────────────────────────────

  /** Every page template this person can open. */
  app.get('/api/templates', requireUser, wrap(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT d.id, d.title, d.icon, d.kind, d.updated_at,
              u.name AS created_by_name
         FROM docs d
         LEFT JOIN users u ON u.id = d.created_by
        WHERE d.deleted_at IS NULL AND d.is_template AND d.kind <> 'task' AND ${VISIBLE}
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
    // A row's own page belongs to that row: it is reachable only through it,
    // and a copy of one would be a page belonging to nothing. The listing
    // excludes them too, so this is the same rule said twice on purpose —
    // marking one was possible, and the sidebar then quietly hid it, which is
    // two answers to one question.
    const { rows } = await pool.query(
      `UPDATE docs SET is_template = $2
        WHERE id = $1 AND deleted_at IS NULL AND (kind <> 'task' OR $2 = false)
       RETURNING id, is_template, kind`,
      [req.params.id, on]
    );
    if (!rows[0] && on) {
      const { rows: row } = await pool.query('SELECT kind FROM docs WHERE id = $1', [req.params.id]);
      if (row[0]?.kind === 'task') {
        return res.status(400).json({ error: 'A row’s own page cannot be a template.' });
      }
    }
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
      `SELECT d.id, d.title, d.icon, d.kind, d.is_template, d.search_text, d.props, s.state
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
        // The page's own property values come along: "Doc type: spec", "Owner:
        // unassigned" and the rest are part of what the template looks like,
        // the same way its headings are. Tags are not copied — a tag is how a
        // page is filed, and the copy has not been filed anywhere yet.
        `INSERT INTO docs (id, title, icon, created_by, folder_id, visibility, kind, search_text, props)
         VALUES ($1,$2,$3,$4,$5,'team',$6,$7,$8)`,
        [id, title, src[0].icon, req.user.id, folderId, src[0].kind === 'design' ? 'design' : 'doc',
         String(src[0].search_text || '').slice(0, 100000), JSON.stringify(src[0].props ?? {})]
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
    const checked = await checkTemplateFields(t.fields, { kinds: await kindsFor(req.params.id), isStatus });
    if (!checked.ok) return res.status(400).json({ error: checked.error });
    t.fields = checked.fields;
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
    if (req.body?.fields !== undefined) {
      // The database is the template's own, so it is read from the row rather
      // than taken on the caller's word.
      const { rows: owner } = await pool.query('SELECT project_id FROM row_templates WHERE id = $1', [req.params.id]);
      if (!owner[0]) return res.status(404).json({ error: 'not found' });
      const checked = await checkTemplateFields(readRow(req.body).fields, { kinds: await kindsFor(owner[0].project_id), isStatus });
      if (!checked.ok) return res.status(400).json({ error: checked.error });
      set('fields', JSON.stringify(checked.fields));
    }
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
    if (out[key] !== undefined || fields[key] === undefined) continue;
    // A rule that is not a rule is dropped rather than carried into the create
    // route, which refuses it — and would then be refusing something the person
    // clicking New never typed. Saving checks this too; this is for rows
    // written before it did.
    if (key === 'repeatRule' && !isRepeatRule(fields[key])) continue;
    out[key] = fields[key];
  }
  const tprops = template?.props && typeof template.props === 'object' ? template.props : {};
  out.props = { ...tprops, ...(body?.props ?? {}) };
  return out;
}
