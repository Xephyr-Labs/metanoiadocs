// Filling a database from the file the work is already in.
//
// Everything a row can hold has had a way in — the UI, the API, an agent, a
// public form — except the one people actually have, which is a spreadsheet.
// This is that way in, and it is deliberately a *mapping* rather than an
// importer: a header cell names a property, a row is a task, and a column that
// names nothing is reported rather than guessed at.
//
// Nothing here writes a value the ordinary create route would refuse. Every
// cell goes through `coercePropValue`, so a database cannot be filled with
// shapes the UI then cannot render — which is the failure mode of every import
// that validates in its own way.
import crypto from 'node:crypto';
import { pool } from './db.js';
import { parseCsv, mapColumns, normalizeHeader } from './csv.js';
import { coercePropValue, propKey } from './props.js';
import { propsFor } from './props-routes.js';
import { withKey, usableTitle } from './task-key.js';
import { isRepeatRule } from './repeat.js';
import { ensureTaskPage, setAssignees, MAX_ASSIGNEES } from './task-writes.js';
import { notifyAssigneesById } from './assignees.js';

/** Enough to seed a database from a real export, few enough that one request
 *  cannot hold a transaction open for a minute. */
const MAX_ROWS = 2000;
const MAX_PROPS = 40;

const STATUSES = ['todo', 'doing', 'review', 'done'];

/** A number that means a priority, or 0. Accepts the words the UI shows. */
const PRIORITIES = { none: 0, low: 1, medium: 2, normal: 2, high: 3, urgent: 4, critical: 4 };

function readPriority(raw) {
  const s = String(raw ?? '').trim().toLowerCase();
  if (!s) return 0;
  if (s in PRIORITIES) return PRIORITIES[s];
  const n = Number(s);
  return Number.isFinite(n) ? Math.max(0, Math.min(4, Math.round(n))) : 0;
}

/** Hours to one decimal, or null — the same rule `readHours` applies on create. */
function readHours(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 10) / 10;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const readDate = (raw) => {
  const s = String(raw ?? '').trim().slice(0, 10);
  return DATE.test(s) && !Number.isNaN(Date.parse(s)) ? s : null;
};

/**
 * Who a cell names, matched against the workspace.
 *
 * By email first, because an email is unique and a name is not; by name only
 * when it matches exactly one person. Two people called Sam is precisely when
 * guessing is worst, so that cell is reported instead.
 */
export function matchPeople(cell, users) {
  const names = String(cell ?? '').split(/[,;]/).map((s) => s.trim()).filter(Boolean);
  const found = [];
  const missing = [];
  for (const name of names.slice(0, MAX_ASSIGNEES)) {
    const key = name.toLowerCase();
    const byEmail = users.filter((u) => (u.email || '').toLowerCase() === key);
    const byName = users.filter((u) => (u.name || '').trim().toLowerCase() === key);
    const hit = byEmail.length === 1 ? byEmail : byName;
    if (hit.length === 1) found.push(hit[0].id);
    else missing.push(name);
  }
  return { found, missing };
}

export function registerCsvRoutes(app, { requireUser, wrap, createDocRow, raw }) {
  /**
   * Import a CSV into one database.
   *
   * Raw text rather than multipart, exactly like `/api/docs/import` — one file
   * per request, and the options ride on the query string. `dry=1` reports what
   * would happen and writes nothing, which is what the UI shows before anyone
   * commits to a thousand rows.
   */
  app.post('/api/projects/:id/import.csv', requireUser, raw, wrap(async (req, res) => {
    const projectId = req.params.id;
    const dry = req.query.dry === '1' || req.query.dry === 'true';
    const createMissing = req.query.create === '1' || req.query.create === 'true';

    const { rows: project } = await pool.query(
      'SELECT id, key FROM projects WHERE id = $1 AND archived_at IS NULL', [projectId]);
    if (!project[0]) return res.status(404).json({ error: 'not found' });

    const text = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body ?? '');
    const table = parseCsv(text);
    if (!table.length) return res.status(400).json({ error: 'That file has no rows in it.' });

    const headers = table[0];
    const body = table.slice(1).filter((r) => r.some((c) => String(c).trim() !== ''));
    if (body.length > MAX_ROWS) {
      return res.status(400).json({ error: `That file has ${body.length} rows; ${MAX_ROWS} is the most one import can take.` });
    }

    let props = await propsFor(projectId);
    let columns = mapColumns(headers, props);
    if (!columns.some((c) => c.kind === 'builtin' && c.field === 'title')) {
      return res.status(400).json({ error: 'One column has to be the title. Name it "Title".' });
    }

    // New columns become text properties, and only when asked: a header with a
    // typo in it should not quietly widen the database.
    const newColumns = columns.filter((c) => c.kind === 'new');
    if (createMissing && newColumns.length && !dry) {
      const taken = props.map((p) => p.key);
      for (const col of newColumns) {
        if (props.length >= MAX_PROPS) break;
        const label = String(col.header).trim().slice(0, 60);
        const key = propKey(label, taken);
        taken.push(key);
        const { rows } = await pool.query(
          `INSERT INTO db_props (id, project_id, key, label, type, position)
           VALUES ($1,$2,$3,$4,'text',$5) RETURNING *`,
          [crypto.randomUUID(), projectId, key, label, props.length]
        );
        props = [...props, rows[0]];
      }
      columns = mapColumns(headers, props);
    }

    const { rows: users } = await pool.query('SELECT id, name, email FROM users');
    const errors = [];
    let created = 0;

    for (const [i, row] of body.entries()) {
      // +2: the header is line 1, and a person counting lines in a spreadsheet
      // counts from 1. An error that names the wrong line is worse than none.
      const line = i + 2;
      const cellOf = (pred) => {
        const at = columns.findIndex(pred);
        return at === -1 ? '' : String(row[at] ?? '');
      };
      const title = cellOf((c) => c.kind === 'builtin' && c.field === 'title').replace(/\s+/g, ' ').trim().slice(0, 500);
      if (!usableTitle(title)) {
        errors.push({ line, error: 'no title' });
        continue;
      }

      const statusCell = normalizeHeader(cellOf((c) => c.kind === 'builtin' && c.field === 'status'));
      const status = STATUSES.includes(statusCell) ? statusCell : 'todo';
      const repeatCell = String(cellOf((c) => c.kind === 'builtin' && c.field === 'repeatRule')).trim().toLowerCase();

      const values = {};
      let rowError = null;
      for (const [at, col] of columns.entries()) {
        if (col.kind !== 'prop') continue;
        const cell = String(row[at] ?? '').trim();
        if (!cell) continue;
        // A multi_select cell is the one place a single string means a list,
        // because that is how every spreadsheet writes one.
        const value = col.type === 'multi_select'
          ? cell.split(/[,;]/).map((s) => s.trim()).filter(Boolean)
          : cell;
        const coerced = coercePropValue(col.type, value);
        if (coerced === undefined) { rowError = `${col.header} is not a valid ${col.type}`; break; }
        if (coerced !== null) values[col.propId] = coerced;
      }
      if (rowError) { errors.push({ line, error: rowError }); continue; }

      const peopleCell = cellOf((c) => c.kind === 'builtin' && c.field === 'assignees');
      const people = matchPeople(peopleCell, users);
      if (people.missing.length) errors.push({ line, error: `no such person: ${people.missing.join(', ')}` });

      if (dry) { created += 1; continue; }

      const { rows: claim } = await pool.query(
        'UPDATE projects SET task_seq = task_seq + 1 WHERE id = $1 RETURNING key, task_seq',
        [projectId]
      );
      const { rows: pos } = await pool.query(
        `SELECT coalesce(max(position), 0) + 1 AS n FROM tasks
          WHERE project_id = $1 AND status = $2 AND deleted_at IS NULL`,
        [projectId, status]
      );
      const id = crypto.randomUUID();
      await pool.query(
        `INSERT INTO tasks (id, project_id, num, title, status, priority, start_at, due_at,
                            points, estimate_h, repeat_rule, position, props, created_by, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14)`,
        [
          id, projectId, claim[0].task_seq,
          withKey(claim[0].key, claim[0].task_seq, title),
          status,
          readPriority(cellOf((c) => c.kind === 'builtin' && c.field === 'priority')),
          readDate(cellOf((c) => c.kind === 'builtin' && c.field === 'startAt')),
          readDate(cellOf((c) => c.kind === 'builtin' && c.field === 'dueAt')),
          Number(cellOf((c) => c.kind === 'builtin' && c.field === 'points')) || null,
          readHours(cellOf((c) => c.kind === 'builtin' && c.field === 'estimateH')),
          isRepeatRule(repeatCell) ? repeatCell : null,
          pos[0].n, JSON.stringify(values), req.user.id,
        ]
      );
      if (people.found.length) {
        const added = await setAssignees(id, people.found);
        // An import assigns work, and work assigned in silence is work nobody
        // knows they have. Not awaited row by row: a file of two hundred rows
        // would otherwise spend its time in the mail server.
        notifyAssigneesById(id, req.user.id, added)
          .catch((err) => console.error('[csv] notify:', err.message));
      }

      // A notes column becomes the row's page, which is where a paragraph
      // belongs — a property holding three sentences is a property nobody can
      // read in a table.
      const notes = cellOf((c) => c.kind === 'builtin' && c.field === 'notes').trim();
      if (notes) {
        await ensureTaskPage(id, req.user.id, createDocRow, notes)
          .catch((err) => console.error('[csv] page:', err.message));
      }
      created += 1;
    }

    res.json({
      dry,
      created,
      skipped: body.length - created,
      columns: columns.map((c) => ({
        header: c.header, kind: c.kind, field: c.field ?? null, propId: c.propId ?? null,
        // The name of the property this column stepped in front of, if any.
        shadows: c.shadows ? (props.find((p) => p.id === c.shadows)?.label ?? null) : null,
      })),
      // Capped: a file where every row is wrong should not answer with a
      // thousand lines of the same complaint.
      errors: errors.slice(0, 50),
      errorCount: errors.length,
    });
  }));
}
