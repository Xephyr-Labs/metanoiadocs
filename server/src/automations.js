// "When a task enters this status, do these things."
//
// The smallest automation that pays for itself: the board move someone makes
// twenty times a day, done once. A quick action is the same list of actions
// with nobody firing it automatically — same table, different trigger_kind —
// because a rule you sometimes want to run by hand and a button you sometimes
// want to run by itself are the same thing twice.
import crypto from 'node:crypto';
import { pool } from './db.js';
import { setAssignees, MAX_ASSIGNEES } from './task-writes.js';
import { notifyAssigneesById } from './assignees.js';

export const AUTOMATION_TRIGGERS = ['status', 'manual'];
export const ACTION_TYPES = ['assign', 'status', 'priority', 'kind', 'sprint', 'points', 'progress'];
/** Enough rules for a real workflow, few enough that a status change stays one
 *  round trip rather than a batch job. */
const MAX_ACTIONS = 10;

/**
 * The actions a rule may carry, with anything unrecognised dropped.
 *
 * A trust boundary: the body is written whole by the settings dialog and read
 * straight back into SQL later. Shapes are checked here; whether a status,
 * type or sprint still exists is checked when the rule runs, because a rule
 * outlives the things it names.
 */
export function cleanActions(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const a of value) {
    if (!a || typeof a !== 'object' || !ACTION_TYPES.includes(a.type)) continue;
    if (a.type === 'assign') {
      const userIds = Array.isArray(a.userIds)
        ? [...new Set(a.userIds.filter((id) => typeof id === 'string' && id))].slice(0, MAX_ASSIGNEES)
        : [];
      out.push({ type: 'assign', userIds });
    } else if (a.type === 'priority' || a.type === 'points' || a.type === 'progress') {
      out.push({ type: a.type, value: a.value == null ? null : Number(a.value) || 0 });
    } else {
      out.push({ type: a.type, value: a.value == null ? null : String(a.value).slice(0, 200) });
    }
    if (out.length >= MAX_ACTIONS) break;
  }
  return out;
}

/** The sprint an action means. 'active' is the useful one — "move it into
 *  whatever we are working on now" survives the sprint it was written in. */
async function sprintTarget(projectId, value) {
  if (!value) return null;
  if (value === 'active') {
    const { rows } = await pool.query(
      `SELECT id FROM sprints WHERE project_id = $1 AND state = 'active'
        ORDER BY start_at ASC NULLS LAST LIMIT 1`,
      [projectId]
    );
    return rows[0]?.id ?? null;
  }
  const { rows } = await pool.query(
    'SELECT id FROM sprints WHERE id = $1 AND project_id = $2', [value, projectId]);
  return rows[0]?.id ?? null;
}

/**
 * Which tasks a rule is allowed to touch.
 *
 * The same {id, field, op, value} shape a saved view stores, so a condition and
 * a view filter are the same vocabulary and the UI can eventually share one
 * editor. Clauses are ANDed: every one must hold. An empty condition means
 * every task, which is what every rule written before this column meant.
 *
 * Evaluated here rather than in SQL because a rule runs against a row already
 * in hand — going back to the database to ask whether the row we are holding
 * matches would be a second query to answer a question we can answer locally.
 */
const FILTER_OPS = [
  'is', 'is_not', 'is_any_of', 'is_none_of', 'contains',
  'is_empty', 'is_not_empty', 'on', 'before', 'after', 'gt', 'lt',
];

/** A condition, with anything unrecognised dropped. Same trust boundary as
 *  cleanActions: written whole by the dialog, read back into a matcher. */
export function cleanCondition(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((f) => f && typeof f === 'object' && typeof f.field === 'string' && FILTER_OPS.includes(f.op))
    .slice(0, 10)
    .map((f) => ({
      id: typeof f.id === 'string' && f.id ? f.id.slice(0, 60) : crypto.randomUUID(),
      field: f.field.slice(0, 60),
      op: f.op,
      // Always a string, so a condition survives a JSON round trip unchanged —
      // the same rule the view filters follow.
      value: f.value == null ? '' : String(f.value).slice(0, 200),
    }));
}

/** The value a clause is asking about. Only columns a rule could sensibly gate
 *  on; a field it does not know about never matches, so a typo disables the
 *  rule rather than silently widening it. */
function fieldValue(task, field) {
  switch (field) {
    case 'status':    return task.status;
    case 'kind':      return task.kind;
    case 'title':     return task.title;
    case 'priority':  return task.priority;
    case 'points':    return task.points;
    case 'progress':  return task.progress;
    case 'milestone': return task.milestone;
    case 'sprint':
    case 'sprint_id': return task.sprint_id;
    case 'assignee':
    case 'assignee_id': return task.assignee_id;
    case 'due':
    case 'due_at':    return task.due_at;
    case 'start':
    case 'start_at':  return task.start_at;
    default:          return undefined;
  }
}

const asList = (v) => String(v ?? '').split(',').map((x) => x.trim()).filter(Boolean);
const empty = (v) => v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length);
const asDay = (v) => (v ? String(v).slice(0, 10) : '');

/** True when every clause holds. An unknown field fails closed. */
export function matchesCondition(task, condition) {
  const clauses = cleanCondition(condition);
  if (!clauses.length) return true;
  if (!task) return false;

  return clauses.every((f) => {
    const actual = fieldValue(task, f.field);
    if (actual === undefined && !['is_empty', 'is_not_empty'].includes(f.op)) return false;

    switch (f.op) {
      case 'is_empty':     return empty(actual);
      case 'is_not_empty': return !empty(actual);
      case 'is':           return String(actual ?? '') === f.value;
      case 'is_not':       return String(actual ?? '') !== f.value;
      case 'is_any_of':    return asList(f.value).includes(String(actual ?? ''));
      case 'is_none_of':   return !asList(f.value).includes(String(actual ?? ''));
      case 'contains':     return String(actual ?? '').toLowerCase().includes(f.value.toLowerCase());
      case 'gt':           return Number(actual) > Number(f.value);
      case 'lt':           return Number(actual) < Number(f.value);
      case 'on':           return asDay(actual) === asDay(f.value);
      case 'before':       return !!asDay(actual) && asDay(actual) < asDay(f.value);
      case 'after':        return !!asDay(actual) && asDay(actual) > asDay(f.value);
      default:             return false;
    }
  });
}

/**
 * Apply one rule's actions to one task.
 *
 * Writes columns directly rather than going back through PATCH /api/tasks/:id,
 * which is what stops a rule that sets a status from firing the rule for that
 * status: automations run on a change a person made, never on one another.
 * Two rules that fight each other settle by position, not by looping.
 *
 * Returns the action types that actually changed something, so the caller can
 * say what happened without re-reading the row twice.
 */
export async function runActions(task, actions, actorId) {
  const applied = [];
  const sets = [];
  const vals = [];
  const set = (sql, v) => { vals.push(v); sets.push(`${sql} = $${vals.length}`); };

  for (const a of cleanActions(actions)) {
    if (a.type === 'assign') {
      const added = await setAssignees(task.id, a.userIds);
      applied.push({ type: 'assign', added });
      // A rule that assigns is still an assignment. Whoever it landed on hears
      // about it, and an agent gets the work queued — exactly as if a person
      // had typed the name in. Without this the agent owns work it never sees.
      await notifyAssigneesById(task.id, actorId, added)
        .catch((e) => console.error('[automation] notify assignees:', e.message));
      continue;
    }
    if (a.type === 'status') {
      // Guarded against a rule naming a status that no longer exists; the four
      // are fixed today, so this is cheap insurance rather than live logic.
      if (!['todo', 'doing', 'review', 'done'].includes(a.value)) continue;
      set('status', a.value);
      sets.push(a.value === 'done' ? 'done_at = coalesce(done_at, now())' : 'done_at = NULL');
      applied.push({ type: 'status', value: a.value });
      continue;
    }
    if (a.type === 'kind') {
      const { rows } = await pool.query(
        'SELECT 1 FROM task_kinds WHERE project_id = $1 AND key = $2', [task.project_id, a.value]);
      if (!rows[0]) continue;
      set('kind', a.value);
      applied.push({ type: 'kind', value: a.value });
      continue;
    }
    if (a.type === 'sprint') {
      const sprintId = await sprintTarget(task.project_id, a.value);
      // A rule pointing at "the active sprint" when there is none is a no-op,
      // not a move to the backlog — the backlog is what an empty value means,
      // and the two must not be confused.
      if (a.value === 'active' && !sprintId) continue;
      set('sprint_id', sprintId);
      applied.push({ type: 'sprint', value: sprintId });
      continue;
    }
    if (a.type === 'priority') { set('priority', a.value ?? 0); applied.push(a); continue; }
    if (a.type === 'points') { set('points', a.value); applied.push(a); continue; }
    if (a.type === 'progress') {
      set('progress', Math.max(0, Math.min(100, Math.round(a.value ?? 0))));
      applied.push(a);
      continue;
    }
  }

  if (sets.length) {
    sets.push('updated_at = now()');
    set('updated_by', actorId ?? null);
    vals.push(task.id);
    await pool.query(
      `UPDATE tasks SET ${sets.join(', ')} WHERE id = $${vals.length} AND deleted_at IS NULL`, vals);
  }
  return applied;
}

/**
 * Run every active rule for the status a task has just entered.
 *
 * Called after the person's own write has landed, so a rule always sees — and
 * can override — what they actually did. Best-effort: a broken rule must not
 * fail the board move that triggered it, so this never throws at its caller.
 */
export async function applyAutomations({ task, entered, actorId }) {
  if (!task || !entered) return [];
  try {
    const { rows } = await pool.query(
      `SELECT * FROM automations
        WHERE project_id = $1 AND active = true
          AND trigger_kind = 'status' AND trigger_value = $2
        ORDER BY position, created_at`,
      [task.project_id, entered]
    );
    const applied = [];
    for (const rule of rows) {
      // The status got it this far; the condition decides whether this
      // particular task is one the rule was written for.
      if (!matchesCondition(task, rule.condition)) continue;
      applied.push(...await runActions(task, rule.actions, actorId));
    }
    return applied;
  } catch (e) {
    console.error('[automation] apply failed:', e.message);
    return [];
  }
}

export function registerAutomationRoutes(app, { requireUser, wrap }) {
  app.get('/api/projects/:id/automations', requireUser, wrap(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT * FROM automations WHERE project_id = $1 ORDER BY position, created_at`,
      [req.params.id]
    );
    res.json(rows);
  }));

  app.post('/api/projects/:id/automations', requireUser, wrap(async (req, res) => {
    const trigger = AUTOMATION_TRIGGERS.includes(req.body?.trigger) ? req.body.trigger : 'status';
    const value = trigger === 'status' ? String(req.body?.value || 'done') : null;
    const { rows: pos } = await pool.query(
      'SELECT coalesce(max(position), 0) + 1 AS n FROM automations WHERE project_id = $1',
      [req.params.id]
    );
    const { rows } = await pool.query(
      `INSERT INTO automations (id, project_id, name, trigger_kind, trigger_value, actions, condition, position, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [crypto.randomUUID(), req.params.id, String(req.body?.name || '').slice(0, 120),
       trigger, value, JSON.stringify(cleanActions(req.body?.actions)),
       JSON.stringify(cleanCondition(req.body?.condition)), pos[0].n, req.user.id]
    );
    res.json(rows[0]);
  }));

  app.patch('/api/automations/:id', requireUser, wrap(async (req, res) => {
    const b = req.body || {};
    const sets = [];
    const vals = [];
    const set = (sql, v) => { vals.push(v); sets.push(`${sql} = $${vals.length}`); };
    if (b.name !== undefined) set('name', String(b.name).slice(0, 120));
    if (b.trigger !== undefined) {
      if (!AUTOMATION_TRIGGERS.includes(b.trigger)) return res.status(400).json({ error: 'bad trigger' });
      set('trigger_kind', b.trigger);
    }
    if (b.value !== undefined) set('trigger_value', b.value == null ? null : String(b.value).slice(0, 200));
    if (b.actions !== undefined) set('actions', JSON.stringify(cleanActions(b.actions)));
    if (b.condition !== undefined) set('condition', JSON.stringify(cleanCondition(b.condition)));
    if (b.active !== undefined) set('active', !!b.active);
    if (b.position !== undefined) set('position', Number(b.position) || 0);
    if (!sets.length) return res.json({ ok: true });
    vals.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE automations SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING *`, vals);
    if (!rows[0]) return res.status(404).json({ error: 'not found' });
    res.json(rows[0]);
  }));

  app.delete('/api/automations/:id', requireUser, wrap(async (req, res) => {
    await pool.query('DELETE FROM automations WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  }));

  // Run a rule on one task, now. The same actions a status change would have
  // fired — this is what makes a rule a quick action.
  app.post('/api/tasks/:id/automations/:aid/run', requireUser, wrap(async (req, res) => {
    const { rows: task } = await pool.query(
      'SELECT id, project_id FROM tasks WHERE id = $1 AND deleted_at IS NULL', [req.params.id]);
    if (!task[0]) return res.status(404).json({ error: 'not found' });
    const { rows: rule } = await pool.query(
      'SELECT * FROM automations WHERE id = $1 AND project_id = $2',
      [req.params.aid, task[0].project_id]);
    if (!rule[0]) return res.status(404).json({ error: 'no such action on this database' });
    // Pressed by hand, but the condition still holds: "Send to review" should
    // decline a task already in review rather than pretend it did something.
    // Read the whole row — the matcher gates on fields the two-column lookup
    // above does not carry.
    const { rows: full } = await pool.query('SELECT * FROM tasks WHERE id = $1', [req.params.id]);
    if (!matchesCondition(full[0], rule[0].condition)) {
      return res.status(409).json({ error: 'This action does not apply to that task.' });
    }
    const applied = await runActions(task[0], rule[0].actions, req.user.id);
    res.json({ ok: true, applied });
  }));
}
