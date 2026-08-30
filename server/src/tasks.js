// Projects + tasks. Plain Postgres rows, not Yjs cells — every view (board,
// table, gantt, calendar) writes back through the same PATCH.
import crypto from 'node:crypto';
import { pool } from './db.js';
import { propsPatch } from './props.js';
import { propsFor } from './props-routes.js';
import { wouldProjectCycle } from './project-tree.js';

export const STATUSES = ['todo', 'doing', 'review', 'done'];

/** A database is either a board of work or a plain table of rows. */
export const PROJECT_MODES = ['tasks', 'data'];
const isMode = (m) => PROJECT_MODES.includes(m);

const isStatus = (s) => STATUSES.includes(s);

/** Seeded into every project on first read. Not built-ins — all four can be
 * renamed, recoloured or deleted like any type someone adds later. */
export const DEFAULT_KINDS = [
  { key: 'epic', label: 'Epic', color: 'purple', is_group: true },
  { key: 'story', label: 'Story', color: 'blue', is_group: false },
  { key: 'task', label: 'Task', color: 'gray', is_group: false },
  { key: 'bug', label: 'Bug', color: 'red', is_group: false },
];

/** Enough to fill the picker without turning it into a scroll trap. */
const MAX_KINDS = 24;

// Serializes /api/projects/:id/move: two near-simultaneous moves each
// validating against their own stale read could interleave into a real
// cycle. Fixed and distinct from db.js's SETUP_LOCK key.
const PROJECT_MOVE_LOCK = 8_140_712;

/**
 * A stable key for a user-typed label, unique within `taken`.
 * The key is what tasks.kind stores, so it must survive a later rename — hence
 * derived once at creation and never recomputed.
 */
export function kindKey(label, taken = []) {
  const base =
    String(label).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) ||
    'type';
  const used = new Set(taken);
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

/** A project's types, seeding the defaults the first time it is asked. */
async function kindsFor(projectId) {
  const sql = `SELECT * FROM task_kinds WHERE project_id = $1
                ORDER BY position ASC, created_at ASC`;
  const { rows } = await pool.query(sql, [projectId]);
  if (rows.length) return rows;
  // Two requests can race to seed the same project. The deterministic id plus
  // ON CONFLICT makes the loser a silent no-op instead of a 500, and both then
  // read back the same four rows.
  await pool.query(
    `INSERT INTO task_kinds (id, project_id, key, label, color, is_group, position)
     SELECT $1 || ':' || d.key, $1, d.key, d.label, d.color, d.is_group, d.pos - 1
       FROM unnest($2::text[], $3::text[], $4::text[], $5::boolean[])
            WITH ORDINALITY AS d(key, label, color, is_group, pos)
     ON CONFLICT (project_id, key) DO NOTHING`,
    [
      projectId,
      DEFAULT_KINDS.map((k) => k.key),
      DEFAULT_KINDS.map((k) => k.label),
      DEFAULT_KINDS.map((k) => k.color),
      DEFAULT_KINDS.map((k) => k.is_group),
    ]
  );
  return (await pool.query(sql, [projectId])).rows;
}

/** Sprint's project, or null. Guards cross-project task→sprint assignment. */
async function sprintProject(sprintId) {
  const { rows } = await pool.query('SELECT project_id FROM sprints WHERE id = $1', [sprintId]);
  return rows[0]?.project_id ?? null;
}

/** YYYY-MM-DD or null. Rejects anything else rather than storing a bad date. */
export function toDate(v) {
  if (v == null || v === '') return null;
  const s = String(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) ? s : null;
}

/**
 * Same as toDate, but tells a clearing (null/'') apart from an unparseable
 * value. Silently nulling a due date because of a typo is data loss, so the
 * caller turns `false` into a 400 instead.
 */
function readDate(v) {
  if (v == null || v === '') return { ok: true, value: null };
  const value = toDate(v);
  return value ? { ok: true, value } : { ok: false, value: null };
}

const clampPct = (n) => Math.max(0, Math.min(100, Math.round(Number(n) || 0)));

/**
 * Would adding task->dep close a cycle? Walks the existing edges forward from
 * dep; if it reaches task, the new edge would make a loop.
 * `edges` is a Map<taskId, string[]> of task -> its dependencies.
 */
export function wouldCycle(edges, taskId, depId) {
  if (taskId === depId) return true;
  const seen = new Set();
  const stack = [depId];
  while (stack.length) {
    const cur = stack.pop();
    if (cur === taskId) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const next of edges.get(cur) || []) stack.push(next);
  }
  return false;
}

async function depEdges(projectId) {
  const { rows } = await pool.query(
    `SELECT d.task_id, d.depends_on_id
       FROM task_deps d JOIN tasks t ON t.id = d.task_id
      WHERE t.project_id = $1`,
    [projectId]
  );
  const m = new Map();
  for (const r of rows) m.set(r.task_id, [...(m.get(r.task_id) || []), r.depends_on_id]);
  return m;
}

// Every task row the client sees, with its dependency ids folded in and the
// opening text of its own page, which the gallery view shows on each card.
// search_text is maintained on save, so this costs a join rather than a Yjs
// decode; the 240 is slack over the ~180 the card renders, so trimming the
// title off the front still leaves a full line.
const TASK_SELECT = `
  SELECT t.*, u.name AS assignee_name,
         coalesce(dp.deps, '[]'::json) AS deps,
         left(pg.search_text, 240) AS preview
    FROM tasks t
    LEFT JOIN users u ON u.id = t.assignee_id
    LEFT JOIN docs pg ON pg.id = t.doc_id
    LEFT JOIN LATERAL (
      SELECT coalesce(json_agg(d.depends_on_id), '[]') AS deps
        FROM task_deps d WHERE d.task_id = t.id
    ) dp ON true`;

export function registerTaskRoutes(app, { requireUser, wrap, createDocRow }) {
  // ── projects ────────────────────────────────────────────────────────────
  app.get('/api/projects', requireUser, wrap(async (_req, res) => {
    const { rows } = await pool.query(
      `SELECT p.*,
              count(t.id) FILTER (WHERE t.deleted_at IS NULL) AS total,
              count(t.id) FILTER (WHERE t.deleted_at IS NULL AND t.status = 'done') AS done,
              count(t.id) FILTER (WHERE t.deleted_at IS NULL AND t.status <> 'done'
                                    AND t.due_at < current_date) AS overdue
         FROM projects p
         LEFT JOIN tasks t ON t.project_id = p.id
        WHERE p.archived_at IS NULL
        GROUP BY p.id
        ORDER BY p.parent_id NULLS FIRST, p.position ASC, p.created_at ASC`
    );
    res.json(rows);
  }));

  app.post('/api/projects', requireUser, wrap(async (req, res) => {
    const id = crypto.randomUUID();
    const { rows } = await pool.query(
      `INSERT INTO projects (id, name, icon, color, doc_id, parent_id, mode, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [
        id,
        String(req.body?.name || 'Untitled project').slice(0, 200),
        String(req.body?.icon || '📋').slice(0, 8),
        String(req.body?.color || 'blue').slice(0, 20),
        req.body?.docId || null,
        req.body?.parentId || null,
        isMode(req.body?.mode) ? req.body.mode : 'tasks',
        req.user.id,
      ]
    );
    res.json({ ...rows[0], total: '0', done: '0', overdue: '0' });
  }));

  app.post('/api/projects/:id/move', requireUser, wrap(async (req, res) => {
    const parentId = typeof req.body?.parentId === 'string' ? req.body.parentId : null;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock($1)', [PROJECT_MOVE_LOCK]);
      // Unfiltered: archiving a project doesn't archive its children, so a
      // live child can still point at an archived parent. The cycle walk has
      // to see archived nodes too, or a walk through one stops early and a
      // real cycle slips through.
      const { rows: all } = await client.query('SELECT id, parent_id FROM projects');
      const parents = new Map(all.map((r) => [r.id, r.parent_id]));
      if (!parents.has(req.params.id)) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'not found' });
      }
      if (parentId) {
        const { rows: target } = await client.query(
          'SELECT 1 FROM projects WHERE id = $1 AND archived_at IS NULL', [parentId]
        );
        if (!target.length) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: 'unknown parent' });
        }
      }
      if (wouldProjectCycle(parents, req.params.id, parentId)) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'that would put a database inside itself' });
      }
      const { rows } = await client.query(
        `UPDATE projects SET parent_id = $1, position = $2 WHERE id = $3 RETURNING *`,
        [parentId, Number(req.body?.position) || 0, req.params.id]
      );
      await client.query('COMMIT');
      res.json(rows[0]);
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }));

  app.patch('/api/projects/:id', requireUser, wrap(async (req, res) => {
    const sets = [];
    const vals = [];
    for (const [key, col] of [['name', 'name'], ['icon', 'icon'], ['color', 'color'], ['position', 'position']]) {
      if (req.body?.[key] !== undefined) {
        vals.push(key === 'position' ? Number(req.body[key]) || 0 : String(req.body[key]).slice(0, 200));
        sets.push(`${col} = $${vals.length}`);
      }
    }
    if (req.body?.mode !== undefined) {
      if (!isMode(req.body.mode)) return res.status(400).json({ error: 'bad mode' });
      vals.push(req.body.mode);
      sets.push(`mode = $${vals.length}`);
    }
    // Archiving is a toggle, not a one-way door: the sidebar's Archive action
    // offers an undo, and that undo comes back through here.
    if (req.body?.archived !== undefined) {
      sets.push(req.body.archived ? 'archived_at = now()' : 'archived_at = NULL');
    }
    if (!sets.length) return res.json({ ok: true });
    vals.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE projects SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING *`, vals
    );
    if (!rows[0]) return res.status(404).json({ error: 'not found' });
    res.json(rows[0]);
  }));

  // Archive, not drop: the tasks stay recoverable.
  app.delete('/api/projects/:id', requireUser, wrap(async (req, res) => {
    await pool.query('UPDATE projects SET archived_at = now() WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  }));

  app.get('/api/projects/:id/tasks', requireUser, wrap(async (req, res) => {
    const { rows } = await pool.query(
      `${TASK_SELECT} WHERE t.project_id = $1 AND t.deleted_at IS NULL
        ORDER BY t.position ASC, t.created_at ASC`,
      [req.params.id]
    );
    res.json(rows);
  }));

  // ── task types ──────────────────────────────────────────────────────────
  // Anyone who can reach the project can edit its types, the same rule the
  // rest of this file uses for tasks and sprints.
  app.get('/api/projects/:id/kinds', requireUser, wrap(async (req, res) => {
    res.json(await kindsFor(req.params.id));
  }));

  app.post('/api/projects/:id/kinds', requireUser, wrap(async (req, res) => {
    const label = String(req.body?.label ?? '').trim().slice(0, 40);
    if (!label) return res.status(400).json({ error: 'Give the type a name.' });
    const existing = await kindsFor(req.params.id);
    if (existing.length >= MAX_KINDS) {
      return res.status(400).json({ error: `A project can have at most ${MAX_KINDS} types.` });
    }
    const { rows } = await pool.query(
      `INSERT INTO task_kinds (id, project_id, key, label, color, is_group, position)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [
        crypto.randomUUID(),
        req.params.id,
        kindKey(label, existing.map((k) => k.key)),
        label,
        String(req.body?.color || 'gray').slice(0, 20),
        !!req.body?.isGroup,
        existing.length,
      ]
    );
    res.json(rows[0]);
  }));

  // The key is deliberately not patchable: it is what every task row stores,
  // so renaming a type has to leave its tasks where they are.
  app.patch('/api/kinds/:id', requireUser, wrap(async (req, res) => {
    const b = req.body || {};
    const sets = [];
    const vals = [];
    const set = (col, v) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };
    if (b.label !== undefined) {
      const label = String(b.label).trim().slice(0, 40);
      if (!label) return res.status(400).json({ error: 'Give the type a name.' });
      set('label', label);
    }
    if (b.color !== undefined) set('color', String(b.color).slice(0, 20));
    if (b.isGroup !== undefined) set('is_group', !!b.isGroup);
    if (b.position !== undefined) set('position', Number(b.position) || 0);
    if (!sets.length) return res.json({ ok: true });
    vals.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE task_kinds SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING *`, vals
    );
    if (!rows[0]) return res.status(404).json({ error: 'not found' });
    res.json(rows[0]);
  }));

  // Tasks holding this type move to the next surviving one rather than being
  // left with a type that is gone; the count comes back so the UI can say so.
  app.delete('/api/kinds/:id', requireUser, wrap(async (req, res) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: [kind] } = await client.query(
        'SELECT * FROM task_kinds WHERE id = $1 FOR UPDATE', [req.params.id]
      );
      if (!kind) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'not found' });
      }
      const { rows: rest } = await client.query(
        `SELECT key, label FROM task_kinds
          WHERE project_id = $1 AND id <> $2 ORDER BY position ASC, created_at ASC`,
        [kind.project_id, kind.id]
      );
      // A project with no types at all would leave its tasks unlabelled and
      // the picker empty, with no way back.
      if (!rest.length) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'A project needs at least one task type.' });
      }
      const moved = await client.query(
        'UPDATE tasks SET kind = $1 WHERE project_id = $2 AND kind = $3',
        [rest[0].key, kind.project_id, kind.key]
      );
      await client.query('DELETE FROM task_kinds WHERE id = $1', [kind.id]);
      await client.query('COMMIT');
      res.json({ ok: true, moved: moved.rowCount, movedTo: rest[0].label });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }));

  // ── tasks ───────────────────────────────────────────────────────────────
  // Cross-project query. Powers My Tasks and the home dashboard.
  app.get('/api/tasks', requireUser, wrap(async (req, res) => {
    // Rows of a data database are records, not work: they never belong in a
    // "what am I meant to be doing" list.
    const where = ['t.deleted_at IS NULL', 'p.archived_at IS NULL', "p.mode <> 'data'"];
    const vals = [];
    if (req.query.assignee) {
      vals.push(req.query.assignee === 'me' ? req.user.id : String(req.query.assignee));
      where.push(`t.assignee_id = $${vals.length}`);
    }
    if (req.query.project) {
      vals.push(String(req.query.project));
      where.push(`t.project_id = $${vals.length}`);
    }
    if (isStatus(req.query.status)) {
      vals.push(req.query.status);
      where.push(`t.status = $${vals.length}`);
    }
    if (req.query.open === '1') where.push(`t.status <> 'done'`);
    if (req.query.due === 'week') where.push(`t.due_at <= current_date + 7`);
    if (req.query.due === 'overdue') where.push(`t.due_at < current_date AND t.status <> 'done'`);
    const { rows } = await pool.query(
      `${TASK_SELECT} JOIN projects p ON p.id = t.project_id
        WHERE ${where.join(' AND ')}
        ORDER BY t.due_at ASC NULLS LAST, t.priority DESC LIMIT 500`,
      vals
    );
    res.json(rows);
  }));

  app.post('/api/tasks', requireUser, wrap(async (req, res) => {
    const projectId = req.body?.projectId;
    if (!projectId) return res.status(400).json({ error: 'projectId required' });
    const status = isStatus(req.body?.status) ? req.body.status : 'todo';
    const startAt = readDate(req.body?.startAt);
    const dueAt = readDate(req.body?.dueAt);
    if (!startAt.ok || !dueAt.ok) {
      return res.status(400).json({ error: 'startAt/dueAt must be YYYY-MM-DD' });
    }
    // Seeds the project's types if this is its first task, so the fallback
    // below always names a type that exists.
    const kinds = await kindsFor(projectId);
    const wanted = String(req.body?.kind || '');
    const kind = kinds.some((k) => k.key === wanted)
      ? wanted
      : (kinds.find((k) => k.key === 'task') ?? kinds[0])?.key ?? 'task';
    const sprintId = typeof req.body?.sprintId === 'string' ? req.body.sprintId : null;
    if (sprintId && (await sprintProject(sprintId)) !== projectId) {
      return res.status(400).json({ error: 'sprint is not in this project' });
    }
    const id = crypto.randomUUID();
    // Append to the bottom of its column.
    const { rows: pos } = await pool.query(
      `SELECT coalesce(max(position), 0) + 1 AS n FROM tasks
        WHERE project_id = $1 AND status = $2 AND deleted_at IS NULL`,
      [projectId, status]
    );
    // Property values at creation: the calendar makes a row already carrying
    // the date of the day it was created on.
    const checked = propsPatch(await propsFor(projectId), req.body?.props ?? {});
    if (!checked.ok) return res.status(400).json({ error: checked.error });
    const { rows } = await pool.query(
      `INSERT INTO tasks (id, project_id, title, status, assignee_id, start_at, due_at,
                          priority, progress, points, milestone, doc_id, parent_id,
                          kind, sprint_id, position, props, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$18) RETURNING *`,
      [
        id, projectId,
        String(req.body?.title || '').slice(0, 500),
        status,
        req.body?.assigneeId || null,
        startAt.value, dueAt.value,
        Number(req.body?.priority) || 0,
        clampPct(req.body?.progress),
        req.body?.points == null ? null : Number(req.body.points) || 0,
        !!req.body?.milestone,
        req.body?.docId || null,
        req.body?.parentId || null,
        kind, sprintId,
        pos[0].n, JSON.stringify(checked.value), req.user.id,
      ]
    );
    // A task is created before it has a page, so there is nothing to preview yet.
    res.json({ ...rows[0], deps: [], assignee_name: null, preview: null });
  }));

  app.patch('/api/tasks/:id', requireUser, wrap(async (req, res) => {
    const b = req.body || {};
    const sets = [];
    const vals = [];
    const set = (sql, v) => { vals.push(v); sets.push(`${sql} = $${vals.length}`); };

    if (b.title !== undefined) set('title', String(b.title).slice(0, 500));
    if (b.status !== undefined) {
      if (!isStatus(b.status)) return res.status(400).json({ error: 'bad status' });
      set('status', b.status);
      // done_at tracks the transition both ways, so burndown-style reporting and
      // "recently completed" stay honest when a task is reopened.
      sets.push(b.status === 'done' ? 'done_at = coalesce(done_at, now())' : 'done_at = NULL');
    }
    if (b.assigneeId !== undefined) set('assignee_id', b.assigneeId || null);
    for (const [key, col] of [['startAt', 'start_at'], ['dueAt', 'due_at']]) {
      if (b[key] === undefined) continue;
      const d = readDate(b[key]);
      if (!d.ok) return res.status(400).json({ error: `${key} must be YYYY-MM-DD` });
      set(col, d.value);
    }
    if (b.priority !== undefined) set('priority', Number(b.priority) || 0);
    if (b.progress !== undefined) set('progress', clampPct(b.progress));
    if (b.points !== undefined) set('points', b.points == null ? null : Number(b.points) || 0);
    if (b.milestone !== undefined) set('milestone', !!b.milestone);
    if (b.docId !== undefined) set('doc_id', b.docId || null);
    if (b.position !== undefined) set('position', Number(b.position) || 0);
    if (b.kind !== undefined) {
      // Types are per project, so the task has to be located before its new
      // type can be judged valid.
      const { rows: owner } = await pool.query('SELECT project_id FROM tasks WHERE id = $1', [req.params.id]);
      if (!owner[0]) return res.status(404).json({ error: 'not found' });
      const kinds = await kindsFor(owner[0].project_id);
      if (!kinds.some((k) => k.key === b.kind)) return res.status(400).json({ error: 'bad kind' });
      set('kind', b.kind);
    }
    if (b.sprintId !== undefined) {
      const sprintId = typeof b.sprintId === 'string' ? b.sprintId : null;
      if (sprintId) {
        const { rows: t } = await pool.query('SELECT project_id FROM tasks WHERE id = $1', [req.params.id]);
        if (!t[0]) return res.status(404).json({ error: 'not found' });
        if ((await sprintProject(sprintId)) !== t[0].project_id) {
          return res.status(400).json({ error: 'sprint is not in this project' });
        }
      }
      set('sprint_id', sprintId);
    }
    if (b.parentId !== undefined) {
      const parentId = typeof b.parentId === 'string' ? b.parentId : null;
      if (parentId) {
        if (parentId === req.params.id) return res.status(400).json({ error: 'a task cannot be its own parent' });
        const { rows: pair } = await pool.query(
          'SELECT id, project_id FROM tasks WHERE id = ANY($1) AND deleted_at IS NULL',
          [[req.params.id, parentId]]
        );
        if (pair.length !== 2 || pair[0].project_id !== pair[1].project_id) {
          return res.status(400).json({ error: 'parent must be a task in the same project' });
        }
        // Walk up from the proposed parent (seen guards pre-broken data);
        // reaching this task means the move would close a loop.
        const seen = new Set();
        let cur = parentId;
        while (cur && !seen.has(cur)) {
          seen.add(cur);
          const { rows: up } = await pool.query('SELECT parent_id FROM tasks WHERE id = $1', [cur]);
          cur = up[0]?.parent_id || null;
          if (cur === req.params.id) return res.status(400).json({ error: 'that would create a cycle' });
        }
      }
      set('parent_id', parentId);
    }
    if (b.props !== undefined) {
      const { rows: owner } = await pool.query('SELECT project_id FROM tasks WHERE id = $1', [req.params.id]);
      if (!owner[0]) return res.status(404).json({ error: 'not found' });
      const checked = propsPatch(await propsFor(owner[0].project_id), b.props);
      if (!checked.ok) return res.status(400).json({ error: checked.error });
      // Merge, not replace: an untouched key elsewhere in props must survive.
      vals.push(JSON.stringify(checked.value));
      sets.push(`props = props || $${vals.length}::jsonb`);
    }
    if (!sets.length) return res.json({ ok: true });

    sets.push('updated_at = now()');
    set('updated_by', req.user.id);
    vals.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE tasks SET ${sets.join(', ')}
        WHERE id = $${vals.length} AND deleted_at IS NULL RETURNING *`,
      vals
    );
    if (!rows[0]) return res.status(404).json({ error: 'not found' });
    if (b.title !== undefined && rows[0].doc_id) {
      await pool.query(
        'UPDATE docs SET title = $1, updated_at = now() WHERE id = $2 AND title <> $1',
        [String(b.title).slice(0, 200), rows[0].doc_id]
      );
    }
    res.json(rows[0]);
  }));

  app.post('/api/tasks/:id/page', requireUser, wrap(async (req, res) => {
    // SELECT ... FOR UPDATE serialises concurrent first-opens of the same row:
    // the second caller blocks until the first commits its doc_id, then reads
    // it back instead of racing to create a second document.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        'SELECT id, title, doc_id FROM tasks WHERE id = $1 AND deleted_at IS NULL FOR UPDATE',
        [req.params.id]
      );
      if (!rows[0]) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'not found' });
      }
      // Idempotent: a second call returns the page the first one made.
      if (rows[0].doc_id) {
        await client.query('ROLLBACK');
        return res.json({ docId: rows[0].doc_id });
      }
      // createDocRow opens its own transaction on its own pool client, so it is
      // not part of this one — the row lock above is what stops a second caller
      // from reaching this line for the same task.
      const doc = await createDocRow({
        title: rows[0].title || 'Untitled',
        icon: '📄',
        userId: req.user.id,
        folderId: null,
        visibility: 'team',
        kind: 'task',
        content: null,
      });
      await client.query('UPDATE tasks SET doc_id = $1 WHERE id = $2', [doc.id, req.params.id]);
      await client.query('COMMIT');
      res.json({ docId: doc.id });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }));

  app.delete('/api/tasks/:id', requireUser, wrap(async (req, res) => {
    // A row's page (kind = 'task') is excluded from every sidebar list — it's
    // reachable only through its row. Trash it in the same statement, or it
    // survives, findable only by search and belonging to nothing.
    await pool.query(
      `WITH row AS (
         UPDATE tasks SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL RETURNING doc_id
       )
       UPDATE docs SET deleted_at = now() WHERE id = (SELECT doc_id FROM row) AND deleted_at IS NULL`,
      [req.params.id]
    );
    res.json({ ok: true });
  }));

  // ── sprints ─────────────────────────────────────────────────────────────
  // Rows plus per-sprint rollups so the backlog view needs no second query.
  app.get('/api/projects/:id/sprints', requireUser, wrap(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT s.*,
              count(t.id) FILTER (WHERE t.deleted_at IS NULL) AS total,
              count(t.id) FILTER (WHERE t.deleted_at IS NULL AND t.status = 'done') AS done,
              coalesce(sum(t.points) FILTER (WHERE t.deleted_at IS NULL), 0) AS points,
              coalesce(sum(t.points) FILTER (WHERE t.deleted_at IS NULL AND t.status = 'done'), 0) AS points_done
         FROM sprints s
         LEFT JOIN tasks t ON t.sprint_id = s.id
        WHERE s.project_id = $1
        GROUP BY s.id
        ORDER BY (s.state = 'active') DESC, s.start_at ASC NULLS LAST, s.created_at ASC`,
      [req.params.id]
    );
    res.json(rows);
  }));

  app.post('/api/projects/:id/sprints', requireUser, wrap(async (req, res) => {
    const startAt = readDate(req.body?.startAt);
    const endAt = readDate(req.body?.endAt);
    if (!startAt.ok || !endAt.ok) return res.status(400).json({ error: 'startAt/endAt must be YYYY-MM-DD' });
    const { rows } = await pool.query(
      `INSERT INTO sprints (id, project_id, name, start_at, end_at)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [crypto.randomUUID(), req.params.id, String(req.body?.name || 'Sprint').slice(0, 200), startAt.value, endAt.value]
    );
    res.json({ ...rows[0], total: '0', done: '0', points: '0', points_done: '0' });
  }));

  app.patch('/api/sprints/:id', requireUser, wrap(async (req, res) => {
    const b = req.body || {};
    const { rows: cur } = await pool.query('SELECT * FROM sprints WHERE id = $1', [req.params.id]);
    if (!cur[0]) return res.status(404).json({ error: 'not found' });
    const sets = [];
    const vals = [];
    const set = (sql, v) => { vals.push(v); sets.push(`${sql} = $${vals.length}`); };
    if (b.name !== undefined) set('name', String(b.name).slice(0, 200));
    for (const [key, col] of [['startAt', 'start_at'], ['endAt', 'end_at']]) {
      if (b[key] === undefined) continue;
      const d = readDate(b[key]);
      if (!d.ok) return res.status(400).json({ error: `${key} must be YYYY-MM-DD` });
      set(col, d.value);
    }
    if (b.state !== undefined) {
      if (!['planned', 'active', 'done'].includes(b.state)) return res.status(400).json({ error: 'bad state' });
      set('state', b.state);
    }
    if (!sets.length) return res.json({ ok: true });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      if (b.state === 'active') {
        // One active sprint per project — starting this one parks any other.
        await client.query(
          `UPDATE sprints SET state = 'planned' WHERE project_id = $1 AND state = 'active' AND id <> $2`,
          [cur[0].project_id, req.params.id]
        );
      }
      if (b.state === 'done') {
        // Completing a sprint returns unfinished work to the backlog.
        await client.query(
          `UPDATE tasks SET sprint_id = NULL WHERE sprint_id = $1 AND status <> 'done' AND deleted_at IS NULL`,
          [req.params.id]
        );
      }
      vals.push(req.params.id);
      const { rows } = await client.query(
        `UPDATE sprints SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING *`, vals
      );
      await client.query('COMMIT');
      res.json(rows[0]);
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }));

  // Hard delete; the FK sets tasks.sprint_id NULL, i.e. back to the backlog.
  app.delete('/api/sprints/:id', requireUser, wrap(async (req, res) => {
    await pool.query('DELETE FROM sprints WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  }));

  // ── dependencies ────────────────────────────────────────────────────────
  app.post('/api/tasks/:id/deps', requireUser, wrap(async (req, res) => {
    const depId = req.body?.dependsOn;
    if (!depId) return res.status(400).json({ error: 'dependsOn required' });
    // Caught early so it reports the real reason instead of "not found" (the
    // two-row lookup below collapses to one row when the ids are equal).
    if (depId === req.params.id) {
      return res.status(400).json({ error: 'a task cannot depend on itself' });
    }
    const { rows } = await pool.query(
      'SELECT id, project_id FROM tasks WHERE id = ANY($1) AND deleted_at IS NULL',
      [[req.params.id, depId]]
    );
    if (rows.length !== 2) return res.status(404).json({ error: 'not found' });
    if (rows[0].project_id !== rows[1].project_id) {
      return res.status(400).json({ error: 'tasks must be in the same project' });
    }
    if (wouldCycle(await depEdges(rows[0].project_id), req.params.id, depId)) {
      return res.status(400).json({ error: 'that would create a dependency loop' });
    }
    await pool.query(
      `INSERT INTO task_deps (task_id, depends_on_id) VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [req.params.id, depId]
    );
    res.json({ ok: true });
  }));

  app.delete('/api/tasks/:id/deps/:depId', requireUser, wrap(async (req, res) => {
    await pool.query('DELETE FROM task_deps WHERE task_id = $1 AND depends_on_id = $2', [
      req.params.id, req.params.depId,
    ]);
    res.json({ ok: true });
  }));
}
