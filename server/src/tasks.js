// Projects + tasks. Plain Postgres rows, not Yjs cells — every view (board,
// table, gantt, calendar) writes back through the same PATCH.
import crypto from 'node:crypto';
import { pool } from './db.js';

export const STATUSES = ['todo', 'doing', 'review', 'done'];

const isStatus = (s) => STATUSES.includes(s);

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

// Every task row the client sees, with its dependency ids folded in.
const TASK_SELECT = `
  SELECT t.*, u.name AS assignee_name,
         coalesce(dp.deps, '[]'::json) AS deps
    FROM tasks t
    LEFT JOIN users u ON u.id = t.assignee_id
    LEFT JOIN LATERAL (
      SELECT coalesce(json_agg(d.depends_on_id), '[]') AS deps
        FROM task_deps d WHERE d.task_id = t.id
    ) dp ON true`;

export function registerTaskRoutes(app, { requireUser, wrap }) {
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
        ORDER BY p.position ASC, p.created_at ASC`
    );
    res.json(rows);
  }));

  app.post('/api/projects', requireUser, wrap(async (req, res) => {
    const id = crypto.randomUUID();
    const { rows } = await pool.query(
      `INSERT INTO projects (id, name, icon, color, doc_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [
        id,
        String(req.body?.name || 'Untitled project').slice(0, 200),
        String(req.body?.icon || '📋').slice(0, 8),
        String(req.body?.color || 'blue').slice(0, 20),
        req.body?.docId || null,
        req.user.id,
      ]
    );
    res.json({ ...rows[0], total: '0', done: '0', overdue: '0' });
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

  // ── tasks ───────────────────────────────────────────────────────────────
  // Cross-project query. Powers My Tasks and the home dashboard.
  app.get('/api/tasks', requireUser, wrap(async (req, res) => {
    const where = ['t.deleted_at IS NULL', 'p.archived_at IS NULL'];
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
    const id = crypto.randomUUID();
    // Append to the bottom of its column.
    const { rows: pos } = await pool.query(
      `SELECT coalesce(max(position), 0) + 1 AS n FROM tasks
        WHERE project_id = $1 AND status = $2 AND deleted_at IS NULL`,
      [projectId, status]
    );
    const { rows } = await pool.query(
      `INSERT INTO tasks (id, project_id, title, status, assignee_id, start_at, due_at,
                          priority, progress, points, milestone, doc_id, parent_id,
                          position, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$15) RETURNING *`,
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
        pos[0].n, req.user.id,
      ]
    );
    res.json({ ...rows[0], deps: [], assignee_name: null });
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
    res.json(rows[0]);
  }));

  app.delete('/api/tasks/:id', requireUser, wrap(async (req, res) => {
    await pool.query('UPDATE tasks SET deleted_at = now() WHERE id = $1', [req.params.id]);
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
