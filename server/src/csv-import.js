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
//
// What an import deliberately does NOT do is set off automations or webhooks.
// A rule that sends every new task to triage means one person picking up one
// task, not two hundred at once, and a hook that posts to a channel would post
// two hundred times. The dialog says so before the file is chosen; an import is
// a bulk write, and bulk writes are not the event those rules were written for.
import crypto from 'node:crypto';
import { pool } from './db.js';
import { parseCsv, mapColumns, normalizeHeader } from './csv.js';
import { coercePropValue, propKey } from './props.js';
import { propsFor, MAX_PROPS } from './props-routes.js';
import { withKey, usableTitle, parseKeyQuery } from './task-key.js';
import { isRepeatRule } from './repeat.js';
import { ensureTaskPage, setAssignees, MAX_ASSIGNEES } from './task-writes.js';
// The list of statuses lives with the route that writes them; a second copy
// here is a second answer to what a status is.
import { STATUSES, kindsFor } from './tasks.js';
import { notifyAssigneesById } from './assignees.js';
import { parentProblem } from './task-parent.js';

/** Enough to seed a database from a real export, few enough that one request
 *  cannot hold a transaction open for a minute. */
const MAX_ROWS = 2000;


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


/**
 * The type a Type cell names: its key or its label, any case. '' for an empty
 * cell (the caller's default applies), null for a type this project lacks.
 */
export function readKind(cell, kinds) {
  const s = normalizeHeader(cell);
  if (!s) return '';
  const hit = kinds.find((k) => k.key.toLowerCase() === s || normalizeHeader(k.label) === s);
  return hit ? hit.key : null;
}

/** "2024-03-01" or "2024-03-01 10:22[:33]" — what spreadsheets and ZenTao write. */
const STAMP = /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?$/;
export const readStamp = (raw) => {
  const s = String(raw ?? '').trim();
  return STAMP.test(s) && !Number.isNaN(Date.parse(s.replace(' ', 'T'))) ? s : null;
};

/**
 * Which row of the file goes under which task, judged before anything is
 * written so a dry run reports exactly what the real run would do.
 *
 * A Parent cell names another row's ID in the same file, or failing that a
 * task already in the project — by the ID it was imported with or by its key
 * ("DE-4"). New rows are nodes called `new:<line>` until they have ids. The
 * links are resolved in file order and each one joins the graph before the
 * next is judged, so a loop written into the file is caught on the row that
 * closes it rather than slipping through because no single row looks wrong.
 *
 * Returns `links` (line → `new:<line>` or a task id) and per-row errors. A row
 * whose parent is refused is still imported, at the top level, and says so.
 */
export function linkParents(plans, existing, { projectId, projectKey, kinds, dropped = new Map() }) {
  const node = new Map();
  const up = new Map();
  const byExt = new Map();
  const byNum = new Map();
  for (const t of existing) {
    node.set(t.id, { id: t.id, project_id: projectId, kind: t.kind });
    up.set(t.id, t.parent_id ?? null);
    if (t.ext) byExt.set(String(t.ext), t.id);
    byNum.set(Number(t.num), t.id);
  }
  for (const p of plans) {
    const key = `new:${p.line}`;
    node.set(key, { id: key, project_id: projectId, kind: p.kind });
    if (p.extId) byExt.set(p.extId, key);
  }
  const chainOf = (start) => {
    const out = [];
    const seen = new Set();
    for (let k = start; k && !seen.has(k); k = up.get(k) ?? null) { seen.add(k); out.push(k); }
    return out;
  };

  const links = new Map();
  const errors = [];
  for (const p of plans) {
    const ref = p.parentRef;
    if (!ref) continue;
    let target = byExt.get(ref);
    if (!target) {
      const key = parseKeyQuery(ref);
      if (key && projectKey && key.key === String(projectKey).toUpperCase()) target = byNum.get(key.num);
    }
    let problem;
    if (!target) {
      problem = dropped.has(ref)
        ? `the row with ID "${ref}" (line ${dropped.get(ref)}) was not imported.`
        : `no row in this file has ID "${ref}", and there is no task "${ref}" in this project.`;
    } else {
      const me = `new:${p.line}`;
      problem = parentProblem({ childId: me, projectId, parent: node.get(target), ref, kinds, chain: chainOf(target) });
      if (!problem) { up.set(me, target); links.set(p.line, target); continue; }
    }
    errors.push({ line: p.line, error: `imported without a parent: ${problem[0].toLowerCase()}${problem.slice(1)}` });
  }
  return { links, errors };
}

export function registerCsvRoutes(app, { requireUser, wrap, createDocRow, raw }) {
  /**
   * Import a CSV into one database.
   *
   * Raw text rather than multipart, exactly like `/api/docs/import` — one file
   * per request, and the options ride on the query string. `dry=1` reports what
   * would happen and writes nothing, which is what the UI shows before anyone
   * commits to a thousand rows.
   *
   * `notify=0` is a migration, not a hand-over: bringing a whole backlog
   * across from another tracker would otherwise send every assignee an inbox
   * row, a push and an email per task, and queue a run for every agent named.
   * Only an admin may ask for it, because "assign work to someone without
   * telling them" is otherwise exactly the failure assignees.js exists to stop.
   */
  app.post('/api/projects/:id/import.csv', requireUser, raw, wrap(async (req, res) => {
    const projectId = req.params.id;
    const dry = req.query.dry === '1' || req.query.dry === 'true';
    const createMissing = req.query.create === '1' || req.query.create === 'true';
    const silent = req.query.notify === '0' || req.query.notify === 'false';
    const isAdmin = req.user.role === 'admin';
    if (silent && !isAdmin) {
      return res.status(403).json({ error: 'Only an admin can import without notifying anyone.' });
    }

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

    // The ID column is remembered in a property of its own name whether or not
    // new columns were asked for: without it a second run of the same file
    // duplicates every row, and that is not a choice anyone means to make.
    const idCol = columns.find((c) => c.kind === 'builtin' && c.field === 'externalId');
    let extProp = null;
    if (idCol) {
      extProp = idCol.shadows ? props.find((p) => p.id === idCol.shadows) : null;
      if (extProp && !['text', 'number'].includes(extProp.type)) {
        return res.status(400).json({ error: `The "${extProp.label}" property is a ${extProp.type}; an ID column needs a text property to remember imported rows by. Rename one of them.` });
      }
      if (!extProp && !dry) {
        if (props.length >= MAX_PROPS) {
          return res.status(400).json({ error: `This database already has ${MAX_PROPS} properties, so there is no room to remember the ID column in.` });
        }
        const label = String(idCol.header).trim().slice(0, 60);
        const { rows } = await pool.query(
          `INSERT INTO db_props (id, project_id, key, label, type, position)
           VALUES ($1,$2,$3,$4,'text',$5) RETURNING *`,
          [crypto.randomUUID(), projectId, propKey(label, props.map((p) => p.key)), label, props.length]
        );
        extProp = rows[0];
        props = [...props, extProp];
      }
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
    }
    columns = mapColumns(headers, props);

    const kinds = await kindsFor(projectId);
    const defaultKind = (kinds.find((k) => k.key === 'task') ?? kinds[0])?.key ?? 'task';
    // What is already in the project: the IDs a previous run brought in (so
    // this one skips them), the keys a Parent cell may name, and the existing
    // parent links a loop check has to walk.
    const { rows: existing } = await pool.query(
      `SELECT id, num, kind, parent_id, props ->> $2 AS ext FROM tasks
        WHERE project_id = $1 AND deleted_at IS NULL`,
      [projectId, extProp?.id ?? '']
    );
    const imported = new Map(existing.filter((t) => t.ext).map((t) => [String(t.ext), t]));

    const { rows: users } = await pool.query('SELECT id, name, email FROM users');
    const errors = [];
    const plans = [];
    const seenExt = new Map();
    const dropped = new Map();
    let already = 0;
    const hasCreated = columns.some((c) => c.kind === 'builtin' && c.field === 'createdAt');
    // Rewriting history is for someone moving a whole tracker across, not for
    // anyone with a spreadsheet: a backdated row sorts itself out of every
    // "new this week" list.
    if (hasCreated && !isAdmin) {
      errors.push({ line: 1, error: 'the Created column is kept only when an admin imports; these rows are dated today.' });
    }

    for (const [i, row] of body.entries()) {
      // +2: the header is line 1, and a person counting lines in a spreadsheet
      // counts from 1. An error that names the wrong line is worse than none.
      const line = i + 2;
      const cellOf = (field) => {
        const at = columns.findIndex((c) => c.kind === 'builtin' && c.field === field);
        return at === -1 ? '' : String(row[at] ?? '');
      };
      const extCell = cellOf('externalId').trim();
      const ext = extCell && extProp ? coercePropValue(extProp.type, extCell) : extCell || null;
      const extId = ext === undefined || ext === null ? null : String(ext);
      const drop = (error) => {
        errors.push({ line, error });
        if (extId && !dropped.has(extId)) dropped.set(extId, line);
      };

      const title = cellOf('title').replace(/\s+/g, ' ').trim().slice(0, 500);
      if (!usableTitle(title)) { drop('no title'); continue; }
      if (extCell && ext === undefined) { drop(`${idCol.header} is not a valid ${extProp.type}`); continue; }
      if (extId && imported.has(extId)) { already += 1; continue; }
      if (extId && seenExt.has(extId)) { drop(`${idCol.header} "${extId}" is also on line ${seenExt.get(extId)}`); continue; }

      const kindCell = cellOf('kind');
      const kind = readKind(kindCell, kinds);
      if (kind === null) {
        drop(`no type "${kindCell.trim()}" in this project; its types are ${kinds.map((k) => k.label).join(', ')}`);
        continue;
      }

      const statusRaw = cellOf('status');
      const statusCell = normalizeHeader(statusRaw);
      const status = STATUSES.includes(statusCell) ? statusCell : 'todo';
      if (statusCell && status !== statusCell) {
        errors.push({ line, error: `status "${statusRaw.trim()}" is not one of ${STATUSES.join(', ')}; imported as todo` });
      }
      const repeatCell = String(cellOf('repeatRule')).trim().toLowerCase();

      const values = {};
      let rowError = null;
      for (const [at, col] of columns.entries()) {
        if (col.kind !== 'prop') continue;
        const cell = String(row[at] ?? '').trim();
        if (!cell) continue;
        // A multi_select cell is a list written as one string, because that is
        // how every spreadsheet writes one. So is a person cell — "Amy, Cal" in
        // a Reviewer column is two reviewers, named the way the Assignees column
        // names them, and stored as their ids. Storing the cell as given saved
        // one unknown "person" called "Amy, Cal".
        let value = cell;
        if (col.type === 'multi_select') value = cell.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
        if (col.type === 'person') {
          const named = matchPeople(cell, users);
          if (named.missing.length) errors.push({ line, error: `no such person in ${col.header}: ${named.missing.join(', ')}` });
          if (!named.found.length) continue;
          value = named.found;
        }
        const coerced = coercePropValue(col.type, value);
        if (coerced === undefined) { rowError = `${col.header} is not a valid ${col.type}`; break; }
        if (coerced !== null) values[col.propId] = coerced;
      }
      if (rowError) { drop(rowError); continue; }
      if (extId && extProp) values[extProp.id] = ext;

      const people = matchPeople(cellOf('assignees'), users);
      if (people.missing.length) errors.push({ line, error: `no such person: ${people.missing.join(', ')}` });

      let createdAt = null;
      const createdCell = cellOf('createdAt').trim();
      if (createdCell && isAdmin) {
        createdAt = readStamp(createdCell);
        if (!createdAt) errors.push({ line, error: `Created "${createdCell}" is not a date like 2024-03-01 or 2024-03-01 10:22; dated today` });
      }

      if (extId) seenExt.set(extId, line);
      plans.push({
        line, extId, title, status, values, people: people.found, createdAt,
        kind: kind || defaultKind,
        parentRef: cellOf('parent').trim() || null,
        priority: readPriority(cellOf('priority')),
        startAt: readDate(cellOf('startAt')),
        dueAt: readDate(cellOf('dueAt')),
        points: Number(cellOf('points')) || null,
        estimateH: readHours(cellOf('estimateH')),
        repeatRule: isRepeatRule(repeatCell) ? repeatCell : null,
        notes: cellOf('notes').trim(),
      });
    }

    const { links, errors: parentErrors } = linkParents(plans, existing, {
      projectId, projectKey: project[0].key, kinds, dropped,
    });
    errors.push(...parentErrors);
    errors.sort((a, b) => a.line - b.line);

    if (!dry && plans.length) {
      // One transaction for the rows and their links, so a file that fails
      // half way leaves nothing behind but the properties made for it — and a
      // Parent cell can name a row further down the file. The project row
      // stays locked by the first number claimed until this commits, so other
      // creates in this project wait for the import.
      // ponytail: one lock for the whole file; fine at MAX_ROWS, batch it if imports grow.
      const client = await pool.connect();
      const ids = new Map();
      const added = new Map();
      try {
        await client.query('BEGIN');
        const nextPos = {};
        for (const p of plans) {
          const { rows: claim } = await client.query(
            'UPDATE projects SET task_seq = task_seq + 1 WHERE id = $1 RETURNING key, task_seq',
            [projectId]
          );
          if (nextPos[p.status] === undefined) {
            const { rows: pos } = await client.query(
              `SELECT coalesce(max(position), 0) + 1 AS n FROM tasks
                WHERE project_id = $1 AND status = $2 AND deleted_at IS NULL`,
              [projectId, p.status]
            );
            nextPos[p.status] = pos[0].n;
          }
          const id = crypto.randomUUID();
          await client.query(
            `INSERT INTO tasks (id, project_id, num, title, status, priority, start_at, due_at,
                                points, estimate_h, repeat_rule, position, props, created_by, updated_by,
                                kind, created_at, updated_via, done_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14,$15,
                     coalesce($16::timestamptz, now()), $17,
                     CASE WHEN $5 = 'done' THEN coalesce($16::timestamptz, now()) END)`,
            [
              id, projectId, claim[0].task_seq,
              withKey(claim[0].key, claim[0].task_seq, p.title),
              p.status, p.priority, p.startAt, p.dueAt, p.points, p.estimateH, p.repeatRule,
              nextPos[p.status]++, JSON.stringify(p.values), req.user.id,
              p.kind, p.createdAt, req.via,
            ]
          );
          ids.set(p.line, id);
          if (p.people.length) added.set(id, await setAssignees(id, p.people, client));
        }
        for (const [line, target] of links) {
          const parentId = target.startsWith('new:') ? ids.get(Number(target.slice(4))) : target;
          await client.query('UPDATE tasks SET parent_id = $1 WHERE id = $2', [parentId, ids.get(line)]);
        }
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }

      for (const p of plans) {
        const id = ids.get(p.line);
        // An import assigns work, and work assigned in silence is work nobody
        // knows they have — unless an admin is moving a backlog that everyone
        // already knows about, which is what `notify=0` says. Not awaited row
        // by row: a file of two hundred rows would otherwise spend its time in
        // the mail server.
        if (!silent && added.get(id)?.length) {
          notifyAssigneesById(id, req.user.id, added.get(id))
            .catch((err) => console.error('[csv] notify:', err.message));
        }
        // A notes column becomes the row's page, which is where a paragraph
        // belongs — a property holding three sentences is a property nobody can
        // read in a table. Made after the commit because createDocRow opens its
        // own transaction, and the page has to point at a task that exists.
        // The page credits the importer: createDocRow makes them its owner and
        // creator, which the doc_editors trigger records as its first editor.
        if (p.notes) {
          const docId = await ensureTaskPage(id, req.user.id, createDocRow, p.notes)
            .catch((err) => { console.error('[csv] page:', err.message); return null; });
          // createDocRow has no notion of who typed; an import run by the
          // copilot is the copilot's page, and says so like its other writes.
          if (docId && req.via !== 'human') {
            await pool.query('UPDATE docs SET updated_via = $2 WHERE id = $1', [docId, req.via]);
          }
        }
      }
    }

    res.json({
      dry,
      created: plans.length,
      // Rows a previous import already brought in, matched by their ID.
      already,
      skipped: body.length - plans.length,
      parents: links.size,
      silent,
      columns: columns.map((c) => ({
        header: c.header, kind: c.kind, field: c.field ?? null, propId: c.propId ?? null,
        // The name of the property this column stepped in front of, if any.
        // Not for the ID column, whose property is its own store rather than a
        // lookalike it stepped in front of.
        shadows: c.shadows && c.field !== 'externalId' ? (props.find((p) => p.id === c.shadows)?.label ?? null) : null,
      })),
      // Capped: a file where every row is wrong should not answer with a
      // thousand lines of the same complaint.
      errors: errors.slice(0, 50),
      errorCount: errors.length,
    });
  }));
}
