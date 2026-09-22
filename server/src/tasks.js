// Projects + tasks. Plain Postgres rows, not Yjs cells — every view (board,
// table, gantt, calendar) writes back through the same PATCH.
import crypto from 'node:crypto';
import { pool } from './db.js';
import { coerceFiles, propsPatch } from './props.js';
import { rowTemplateFor, applyRowTemplate } from './templates.js';
import { propsFor } from './props-routes.js';
import { wouldProjectCycle } from './project-tree.js';
import { MAX_ASSIGNEES, ensureTaskPage, knownUsers, setAssignees } from './task-writes.js';
import { notifyAssignees } from './assignees.js';
import { dayIn, isoDate, zoneOf } from './timezone.js';
import { applyAutomations, fireTrigger } from './automations.js';
import { emit } from './webhooks.js';
import { KEY_PREFIX, KEY_RE, deriveKey, uniqueKey, withKey } from './task-key.js';
import { isRepeatRule, nextOccurrence } from './repeat.js';

export const STATUSES = ['todo', 'doing', 'review', 'done'];

/**
 * The assignee list a request is asking for, or undefined when it asks for no
 * change at all. `assigneeIds` is the list; `assigneeId` is the older
 * single-value field, still sent by the table's cell editor and by the MCP
 * tools, and read here as a list of one (or none).
 */
export function wantedAssignees(body) {
  if (Array.isArray(body?.assigneeIds)) {
    return [...new Set(body.assigneeIds.filter((id) => typeof id === 'string' && id))].slice(0, MAX_ASSIGNEES);
  }
  if (body?.assigneeId !== undefined) return body.assigneeId ? [String(body.assigneeId)] : [];
  return undefined;
}

/** A database is either a board of work or a plain table of rows. */
export const PROJECT_MODES = ['tasks', 'data'];
const isMode = (m) => PROJECT_MODES.includes(m);

export const isStatus = (s) => STATUSES.includes(s);

/**
 * The palette a chip may be painted in — the same nine names the tag palette
 * offers (web-react/src/lib/tagColors.ts). Kept as a list rather than a length
 * check so a typo lands as a 400 here instead of as an unstyled grey chip
 * three screens away.
 */
const CHIP_COLORS = ['gray', 'red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink'];

/**
 * `{ status: colour }`, keeping only the pairs that name a real status and a
 * real colour. Anything else is dropped rather than rejected: the body is a
 * whole map, and one unknown key should not lose the three good ones with it.
 */
export function cleanStatusColors(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const out = {};
  for (const [status, color] of Object.entries(value)) {
    if (isStatus(status) && CHIP_COLORS.includes(color)) out[status] = color;
  }
  return out;
}

/**
 * `{ 'sys:<id>': { label?, hidden? } }`, keeping only what the shape allows.
 *
 * Same stance as cleanStatusColors: the body is the whole map, so a bad entry
 * is dropped rather than failing the good ones. A label is trimmed and capped;
 * an empty one means "no override", and is dropped so the default comes back.
 */
export function cleanBuiltinProps(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const out = {};
  for (const [id, raw] of Object.entries(value)) {
    if (!id.startsWith('sys:') || !raw || typeof raw !== 'object') continue;
    const entry = {};
    if (typeof raw.label === 'string' && raw.label.trim()) entry.label = raw.label.trim().slice(0, 60);
    if (raw.hidden === true) entry.hidden = true;
    if (Object.keys(entry).length) out[id] = entry;
  }
  return out;
}

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
export async function kindsFor(projectId) {
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
 * An estimate in hours, or null.
 *
 * Rounded to the tenth and capped at 999.9 on the way in rather than validated
 * and refused: the estimate is the least important thing in the patch it
 * arrived with, and a typo in it must not be what makes the rest of that patch
 * fail. A thousand hours is half a working year on one task, which is a number
 * somebody has mistyped.
 */
const readHours = (n) => {
  if (n == null || n === '') return null;
  const v = Number(n);
  if (!Number.isFinite(v) || v < 0) return null;
  return Math.min(999.9, Math.round(v * 10) / 10);
};

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

/**
 * The next occurrence of a repeating task, created because this one was
 * finished.
 *
 * A copy, not a move: the finished task keeps its number, its comments and its
 * page, so "what did we do last week" still has a row to point at. The new one
 * claims its own number from the project counter, exactly as an ordinary create
 * does — two occurrences of a standup are two tasks, and quoting MD-14 has to
 * mean one of them.
 *
 * What travels: the name, the type, the people, the estimate, the points, the
 * priority, the property values and the rule itself. What does not: the sprint
 * (the next occurrence is not in this one), the progress, the page, the
 * dependencies and the parent — each of those is about the instance that was
 * just completed rather than about the work that repeats.
 */
async function repeatTask(done, actor) {
  const dates = nextOccurrence(done.repeat_rule, {
    // isoDate, not a slice: node-postgres hands a DATE back as a Date object.
    startAt: isoDate(done.start_at),
    dueAt: isoDate(done.due_at),
  }, dayIn(zoneOf(actor)));
  if (!dates) return null;

  const { rows: claim } = await pool.query(
    'UPDATE projects SET task_seq = task_seq + 1 WHERE id = $1 RETURNING key, task_seq',
    [done.project_id]
  );
  if (!claim[0]) return null;

  const id = crypto.randomUUID();
  const { rows: pos } = await pool.query(
    `SELECT coalesce(max(position), 0) + 1 AS n FROM tasks
      WHERE project_id = $1 AND status = 'todo' AND deleted_at IS NULL`,
    [done.project_id]
  );
  // `repeat_of` is the interlock, not a decoration. The PATCH handler decides
  // to call this by reading the previous status and then writing the new one in
  // a separate statement, so two people ticking the same task at the same
  // moment can both read "doing" and both arrive here. The unique index on
  // repeat_of is what makes the second one lose: it is a claim on the right to
  // be this occurrence's successor, and there can only be one.
  //
  // ON CONFLICT DO NOTHING rather than a caught error, so a lost race is a
  // no-op and not a log line about a constraint.
  const { rows } = await pool.query(
    `INSERT INTO tasks (id, project_id, num, title, status, start_at, due_at,
                        priority, points, estimate_h, kind, position, props,
                        repeat_rule, repeat_of, created_by, updated_by)
     VALUES ($1,$2,$3,$4,'todo',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$15)
     ON CONFLICT DO NOTHING
     RETURNING *`,
    [
      id, done.project_id, claim[0].task_seq,
      // stripKey runs inside withKey, so the new row is named after the work
      // rather than after the occurrence that finished.
      withKey(claim[0].key, claim[0].task_seq, done.title),
      dates.startAt, dates.dueAt,
      done.priority, done.points, done.estimate_h, done.kind,
      pos[0].n, JSON.stringify(done.props ?? {}), done.repeat_rule,
      done.id,
      done.created_by ?? actor.id,
    ]
  );
  // Somebody else already made this occurrence's successor. The number claimed
  // above is spent either way, which is the same gap an ordinary failed create
  // leaves and is invisible next to two identical standups on the board.
  if (!rows[0]) return null;

  // The same people, carried over by the same writer the normal path uses —
  // nobody is notified, because nobody has been handed anything new.
  const { rows: people } = await pool.query(
    'SELECT user_id FROM task_assignees WHERE task_id = $1 ORDER BY position', [done.id]
  );
  if (people.length) await setAssignees(id, people.map((r) => r.user_id));

  emit('task.created', rows[0]);
  return rows[0];
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
         cu.name AS created_by_name,
         eu.name AS updated_by_name,
         coalesce(dp.deps, '[]'::json) AS deps,
         coalesce(asg.assignees, '[]'::json) AS assignees,
         coalesce(tg.tags, '[]'::json) AS tags,
         coalesce(rel.relations, '{}'::json) AS "relationIds",
         left(pg.search_text, 240) AS preview
    FROM tasks t
    LEFT JOIN users u ON u.id = t.assignee_id
    -- Who made the row and who touched it last. Both columns already existed;
    -- only the names were missing, so "created by" could not be a property.
    LEFT JOIN users cu ON cu.id = t.created_by
    LEFT JOIN users eu ON eu.id = t.updated_by
    LEFT JOIN docs pg ON pg.id = t.doc_id
    LEFT JOIN LATERAL (
      SELECT coalesce(json_agg(d.depends_on_id), '[]') AS deps
        FROM task_deps d WHERE d.task_id = t.id
    ) dp ON true
    LEFT JOIN LATERAL (
      -- Ordered by position, so the first name a narrow cell shows is the same
      -- one tasks.assignee_id holds.
      SELECT json_agg(json_build_object('id', au.id, 'name', coalesce(au.name, au.username))
                      ORDER BY ta.position, au.name) AS assignees
        FROM task_assignees ta JOIN users au ON au.id = ta.user_id
       WHERE ta.task_id = t.id
    ) asg ON true
    LEFT JOIN LATERAL (
      -- A task's focus areas are the tags on its own page. Tasks carry no tags
      -- of their own, and giving them a second, parallel vocabulary would mean
      -- the same work filed under "Marketing" twice in two places.
      SELECT json_agg(tag.name ORDER BY tag.name) AS tags
        FROM doc_tags dt JOIN tags tag ON tag.id = dt.tag_id
       WHERE dt.doc_id = t.doc_id
    ) tg ON true
    LEFT JOIN LATERAL (
      -- Which rows this one links to, per relation property. Carried on the
      -- list rather than fetched per row because a rollup has to reduce the
      -- linked rows' values for every row on screen, and asking once per row
      -- is a request per card.
      --
      -- Both directions. An edge is stored once and the inverse property reads
      -- it backwards (see db_props.is_inverse), so a row on the far side of a
      -- two-way relation carried nothing here at all: its chip drew nothing
      -- and a rollup written on that property reduced an empty list, while the
      -- owning side of the very same edge worked.
      SELECT json_object_agg(r.prop_id, r.ids) AS relations
        FROM (
          SELECT prop_id, json_agg(to_id) AS ids
            FROM task_relations WHERE from_id = t.id GROUP BY prop_id
          UNION ALL
          SELECT p.id, json_agg(r2.from_id)
            FROM task_relations r2
            JOIN db_props p ON p.paired_prop_id = r2.prop_id AND p.is_inverse
           WHERE r2.to_id = t.id
           GROUP BY p.id
        ) r
    ) rel ON true`;

// Every live task in the workspace, for the cross-project Tasks view. Narrowing
// happens in the client against the same filter engine a board uses, so this
// hands back the rows plus the names they are filtered by.
const ALL_TASKS_SQL = `
  SELECT x.*, p.name AS project_name, p.icon AS project_icon
    FROM (${TASK_SELECT} WHERE t.deleted_at IS NULL) x
    JOIN projects p ON p.id = x.project_id
   WHERE p.archived_at IS NULL AND p.mode <> 'data'
   ORDER BY x.due_at ASC NULLS LAST, x.priority DESC, x.created_at DESC
   LIMIT 1000`;

export function registerTaskRoutes(app, { requireUser, wrap, createDocRow }) {
  // ── projects ────────────────────────────────────────────────────────────
  app.get('/api/projects', requireUser, wrap(async (req, res) => {
    const { rows } = await pool.query(
      // $1, not current_date: how many are overdue depends on what day it is
      // where the caller is, and Postgres only knows what day it is where the
      // server is. The same count is a different number either side of
      // midnight, and the sidebar badge has to agree with the board.
      `SELECT p.*,
              count(t.id) FILTER (WHERE t.deleted_at IS NULL) AS total,
              count(t.id) FILTER (WHERE t.deleted_at IS NULL AND t.status = 'done') AS done,
              count(t.id) FILTER (WHERE t.deleted_at IS NULL AND t.status <> 'done'
                                    AND t.due_at < $1::date) AS overdue
         FROM projects p
         LEFT JOIN tasks t ON t.project_id = p.id
        WHERE p.archived_at IS NULL
        GROUP BY p.id
        ORDER BY p.parent_id NULLS FIRST, p.position ASC, p.created_at ASC`,
      [dayIn(zoneOf(req.user))]
    );
    res.json(rows);
  }));

  app.post('/api/projects', requireUser, wrap(async (req, res) => {
    const id = crypto.randomUUID();
    const name = String(req.body?.name || 'Untitled project').slice(0, 200);
    const insert = (key) => pool.query(
      `INSERT INTO projects (id, name, icon, color, doc_id, parent_id, mode, key, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [
        id,
        name,
        String(req.body?.icon || '📋').slice(0, 8),
        String(req.body?.color || 'blue').slice(0, 20),
        req.body?.docId || null,
        req.body?.parentId || null,
        isMode(req.body?.mode) ? req.body.mode : 'tasks',
        key,
        req.user.id,
      ]
    );
    // Two projects created in the same breath can reduce to the same key, and
    // the guess is made outside the write. The unique index is the referee:
    // look again at what is held and try once more, which is cheaper and
    // shorter than locking the table on every create. The key is a guess
    // either way — PATCH takes a better one.
    let rows;
    for (let attempt = 0; ; attempt++) {
      const { rows: held } = await pool.query('SELECT key FROM projects WHERE key IS NOT NULL');
      try {
        ({ rows } = await insert(uniqueKey(deriveKey(name), held.map((r) => r.key))));
        break;
      } catch (e) {
        if (e.code !== '23505' || attempt >= 2) throw e;
      }
    }
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
    if (req.body?.statusColors !== undefined) {
      const colors = cleanStatusColors(req.body.statusColors);
      if (!colors) return res.status(400).json({ error: 'bad statusColors' });
      vals.push(JSON.stringify(colors));
      sets.push(`status_colors = $${vals.length}::jsonb`);
    }
    if (req.body?.builtinProps !== undefined) {
      const overrides = cleanBuiltinProps(req.body.builtinProps);
      if (!overrides) return res.status(400).json({ error: 'bad builtinProps' });
      vals.push(JSON.stringify(overrides));
      sets.push(`builtin_props = $${vals.length}::jsonb`);
    }
    // Archiving is a toggle, not a one-way door: the sidebar's Archive action
    // offers an undo, and that undo comes back through here.
    if (req.body?.archived !== undefined) {
      sets.push(req.body.archived ? 'archived_at = now()' : 'archived_at = NULL');
    }
    // The key is set apart from the loop above: it is normalised, checked and
    // — unlike a name — written into every one of the project's task titles.
    // Renaming a project deliberately does *not* move its key: MD-14 is quoted
    // in chat and in commit messages, and a name is a label while a key is an
    // address.
    if (req.body?.key !== undefined) {
      const key = String(req.body.key).trim().toUpperCase();
      if (!KEY_RE.test(key)) {
        return res.status(400).json({ error: 'A key is one to eight letters or digits, starting with a letter.' });
      }
      vals.push(key);
      sets.push(`key = $${vals.length}`);
    }
    if (!sets.length) return res.json({ ok: true });
    vals.push(req.params.id);
    let rows;
    try {
      ({ rows } = await pool.query(
        `UPDATE projects SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING *`, vals
      ));
    } catch (e) {
      if (e.code === '23505') return res.status(409).json({ error: 'That key belongs to another database.' });
      throw e;
    }
    if (!rows[0]) return res.status(404).json({ error: 'not found' });
    if (req.body?.key !== undefined) {
      // One statement, not one per task: a project can hold thousands, and the
      // rewrite is the same substitution on every one of them. Numbers do not
      // move, so nothing anyone wrote down stops resolving — only the prefix
      // changes.
      await pool.query(
        `UPDATE tasks
            SET title = CASE WHEN btrim(regexp_replace(title, $2, '')) = '' THEN ''
                             ELSE $1 || '-' || num || ': ' || regexp_replace(title, $2, '')
                        END
          WHERE project_id = $3 AND num IS NOT NULL`,
        [rows[0].key, KEY_PREFIX, req.params.id]
      );
      await pool.query(
        `UPDATE docs d SET title = left(t.title, 200)
           FROM tasks t
          WHERE t.doc_id = d.id AND t.project_id = $1 AND d.title <> left(t.title, 200)`,
        [req.params.id]
      );
    }
    res.json(rows[0]);
  }));

  // Archive, not drop: the tasks stay recoverable.
  app.delete('/api/projects/:id', requireUser, wrap(async (req, res) => {
    await pool.query('UPDATE projects SET archived_at = now() WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  }));

  // The whole workspace's work in one list. The task types come along because
  // they are per project and a cross-project filter needs the union: every
  // board here calls its own the same four things, and a Type filter that only
  // knew one project's would silently drop the rest.
  app.get('/api/tasks', requireUser, wrap(async (_req, res) => {
    const [tasks, kinds] = await Promise.all([
      pool.query(ALL_TASKS_SQL),
      pool.query(
        `SELECT key, min(label) AS label, min(position) AS position
           FROM task_kinds GROUP BY key ORDER BY position, key`
      ),
    ]);
    res.json({ tasks: tasks.rows, kinds: kinds.rows });
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
      // Anyone on the task, not just whoever happens to be first.
      where.push(`EXISTS (SELECT 1 FROM task_assignees ta
                           WHERE ta.task_id = t.id AND ta.user_id = $${vals.length})`);
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
    // "This week" and "overdue" are asked from a calendar, and the caller's is
    // the only one that matters — see the projects count above.
    if (req.query.due === 'week' || req.query.due === 'overdue') {
      vals.push(dayIn(zoneOf(req.user)));
      where.push(req.query.due === 'week'
        ? `t.due_at <= $${vals.length}::date + 7`
        : `t.due_at < $${vals.length}::date AND t.status <> 'done'`);
    }
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
    // A row template fills in what the request left out, and nothing it set.
    // Resolved first, so every check below — status, kind, repeat rule, the
    // property coercion — runs against the values that will actually be
    // written rather than against half of them.
    let templateBody = null;
    if (typeof req.body.templateId === 'string' && req.body.templateId) {
      const template = await rowTemplateFor(req.body.templateId, projectId);
      if (!template) return res.status(404).json({ error: 'no such template' });
      req.body = applyRowTemplate(req.body, template);
      templateBody = template.body;
    }
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
    // Refused rather than silently dropped, which is what PATCH does with the
    // same value: an API that ignores half a request is one you debug twice.
    if (req.body?.repeatRule && !isRepeatRule(req.body.repeatRule)) {
      return res.status(400).json({ error: 'bad repeat rule' });
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
    // The task's number, claimed before anything is written.
    //
    // Reading and bumping in one statement is what makes this safe: the UPDATE
    // takes a row lock on the project for the instant it runs, so two people
    // creating a task at the same moment queue behind it and come away with
    // two different numbers. `max(num) + 1` over the tasks table would hand
    // both of them the same one.
    //
    // A create that fails after this point burns a number, leaving a gap. That
    // is the deliberate trade, and the one every issue tracker makes: a gap is
    // invisible, whereas MD-14 meaning two different tasks is not.
    // Resolved before the number is claimed, because `tasks.assignee_id` has a
    // foreign key: an id that is not a user fails the INSERT, which answers
    // "internal error", burns a task number and creates nothing. A template
    // naming somebody who has since left the workspace is exactly how that
    // happens, and setAssignees below has always dropped such an id silently —
    // so the row column trusted what the list did not.
    const people = await knownUsers(wantedAssignees(req.body) ?? []);
    const { rows: claim } = await pool.query(
      'UPDATE projects SET task_seq = task_seq + 1 WHERE id = $1 RETURNING key, task_seq',
      [projectId]
    );
    if (!claim[0]) return res.status(404).json({ error: 'no such project' });
    const { rows } = await pool.query(
      `INSERT INTO tasks (id, project_id, num, title, status, assignee_id, start_at, due_at,
                          priority, progress, points, milestone, doc_id, parent_id,
                          kind, sprint_id, position, props, created_by, updated_by,
                          repeat_rule, estimate_h)
       VALUES ($1,$2,$19,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$18,$20,$21) RETURNING *`,
      [
        id, projectId,
        withKey(claim[0].key, claim[0].task_seq, String(req.body?.title || '').slice(0, 500)),
        status,
        // The row's own column is filled from the list a moment later, by
        // setAssignees; this keeps a single-assignee create working unchanged
        // even if that write fails.
        people[0] ?? null,
        startAt.value, dueAt.value,
        Number(req.body?.priority) || 0,
        clampPct(req.body?.progress),
        req.body?.points == null ? null : Number(req.body.points) || 0,
        !!req.body?.milestone,
        req.body?.docId || null,
        req.body?.parentId || null,
        kind, sprintId,
        pos[0].n, JSON.stringify(checked.value), req.user.id,
        claim[0].task_seq,
        isRepeatRule(req.body?.repeatRule) ? req.body.repeatRule : null,
        readHours(req.body?.estimateH),
      ]
    );
    emit('task.created', rows[0]);
    // The template's body becomes the row's page. After the insert, because the
    // page is a doc that has to point back at a task that exists — and not
    // inside the transaction above, since createDocRow opens its own.
    if (templateBody) {
      await ensureTaskPage(id, req.user.id, createDocRow, templateBody)
        .catch((err) => console.error('[template] page:', err.message));
    }
    const assignees = people;
    // Rules that listen for a new row run before the response, so the client
    // sees the task the rules left behind rather than the one it asked for and
    // then a different one on the next refresh.
    await fireTrigger({ task: rows[0], kind: 'created', actorId: req.user.id });
    if (!assignees.length) {
      // A task is created before it has a page, so there is nothing to preview yet.
      const { rows: made } = await pool.query(`${TASK_SELECT} WHERE t.id = $1`, [id]);
      return res.json(made[0] ?? { ...rows[0], deps: [], assignee_name: null, assignees: [], preview: null });
    }
    const added = await setAssignees(id, assignees);
    if (added.length) await fireTrigger({ task: rows[0], kind: 'assigned', actorId: req.user.id });
    notifyAssignees(rows[0], req.user, added)
      .catch((err) => console.error('[notify] assign:', err.message));
    // Read back rather than guessing the shape: the names come from users.
    const { rows: full } = await pool.query(`${TASK_SELECT} WHERE t.id = $1`, [id]);
    res.json(full[0] ?? { ...rows[0], deps: [], assignee_name: null, assignees: [], preview: null });
  }));

  app.patch('/api/tasks/:id', requireUser, wrap(async (req, res) => {
    const b = req.body || {};
    const sets = [];
    const vals = [];
    const set = (sql, v) => { vals.push(v); sets.push(`${sql} = $${vals.length}`); };

    // Held rather than set, because the page-link branch below can decide the
    // title too, and both of them have to go through withKey — the key lives
    // inside the title, so a plain write of what was typed would drop it.
    let wantTitle = b.title === undefined ? undefined : String(b.title).slice(0, 500);
    if (b.status !== undefined) {
      if (!isStatus(b.status)) return res.status(400).json({ error: 'bad status' });
      set('status', b.status);
      // done_at tracks the transition both ways, so burndown-style reporting and
      // "recently completed" stay honest when a task is reopened.
      sets.push(b.status === 'done' ? 'done_at = coalesce(done_at, now())' : 'done_at = NULL');
    }
    // Assignees are rows in their own table now, so they are written after the
    // UPDATE rather than as one of its columns — setAssignees keeps the older
    // tasks.assignee_id column in step and reports who is new, so a patch that
    // merely repeats the same people tells nobody anything.
    const assignees = wantedAssignees(b);
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
    if (b.repeatRule !== undefined) {
      // Clearing it is a real edit — "stop repeating" — so an empty value is
      // NULL rather than a refusal, and only a value that is neither empty nor
      // one of the five is a mistake worth a 400.
      if (b.repeatRule && !isRepeatRule(b.repeatRule)) return res.status(400).json({ error: 'bad repeat rule' });
      set('repeat_rule', b.repeatRule || null);
    }
    if (b.estimateH !== undefined) set('estimate_h', readHours(b.estimateH));
    if (b.attachments !== undefined) {
      const files = coerceFiles(b.attachments);
      if (!files) return res.status(400).json({ error: 'bad attachments' });
      set('attachments', JSON.stringify(files));
    }
    // The page this task is written on. Read first, because relinking has to
    // know which page is being left behind.
    let leaving = null;
    if (b.docId !== undefined) {
      set('doc_id', b.docId || null);
      const { rows: had } = await pool.query(
        `SELECT d.id, d.kind, coalesce(d.search_text, '') AS text
           FROM tasks t JOIN docs d ON d.id = t.doc_id
          WHERE t.id = $1 AND d.deleted_at IS NULL`,
        [req.params.id]
      );
      if (had[0] && had[0].id !== b.docId) leaving = had[0];
      // A task and its page carry the same name. When an existing page is
      // linked, the page's name is the one that wins: renaming a page someone
      // else wrote, from a field on a task, is the more surprising direction —
      // and the title still travels task → page on every later rename.
      if (b.docId && b.title === undefined) {
        const { rows: page } = await pool.query(
          'SELECT title FROM docs WHERE id = $1 AND deleted_at IS NULL', [b.docId]
        );
        if (!page[0]) return res.status(400).json({ error: 'no such page' });
        wantTitle = String(page[0].title || '').slice(0, 500);
      }
    }
    if (wantTitle !== undefined) {
      const { rows: k } = await pool.query(
        `SELECT t.num, p.key FROM tasks t JOIN projects p ON p.id = t.project_id
          WHERE t.id = $1`,
        [req.params.id]
      );
      if (!k[0]) return res.status(404).json({ error: 'not found' });
      set('title', withKey(k[0].key, k[0].num, wantTitle));
    }
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
    // An assignee-only patch still has to touch the row, so its updated_at and
    // updated_by move with the change like any other edit.
    if (!sets.length && !assignees) return res.json({ ok: true });

    // Read before writing, and only when a status is in play: automations fire
    // on entering a status, which means knowing which one it was leaving.
    const prevStatus = b.status === undefined
      ? null
      : (await pool.query('SELECT status FROM tasks WHERE id = $1', [req.params.id])).rows[0]?.status ?? null;

    sets.push('updated_at = now()');
    set('updated_by', req.user.id);
    vals.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE tasks SET ${sets.join(', ')}
        WHERE id = $${vals.length} AND deleted_at IS NULL RETURNING *`,
      vals
    );
    if (!rows[0]) return res.status(404).json({ error: 'not found' });
    // The page a relink left behind. A row page belongs to its row and is
    // listed nowhere else, so an empty one would survive as something nobody
    // can reach; one that was written in is a real document and stays, now
    // reachable from the sidebar like any other page.
    if (leaving && leaving.kind === 'task') {
      // An untouched page is not "" — BlockSuite's empty paragraph saves a
      // zero-width space, which trim() alone leaves standing.
      const written = leaving.text.replace(/[​-‍﻿]/g, '').trim();
      if (written) {
        // Written in, so it is a real page: make it an ordinary one, or it
        // stays hidden from every list that skips row pages.
        await pool.query(`UPDATE docs SET kind = 'doc', updated_at = now(), updated_by = $2, updated_via = $3 WHERE id = $1`, [leaving.id, req.user.id, req.via]);
      } else {
        await pool.query('UPDATE docs SET deleted_at = now() WHERE id = $1', [leaving.id]);
      }
    }
    if (wantTitle !== undefined && rows[0].doc_id) {
      await pool.query(
        'UPDATE docs SET title = $1, updated_at = now(), updated_by = $3, updated_via = $4 WHERE id = $2 AND title <> $1',
        [String(rows[0].title).slice(0, 200), rows[0].doc_id, req.user.id, req.via]
      );
    }
    // Rules fire on a move a person made, and only on a real one: a board that
    // re-sends the column a task is already in must not run them again.
    const entered = b.status !== undefined && b.status !== prevStatus ? b.status : null;

    // A repeating task makes its successor the moment it is finished. Guarded
    // by `entered` for the same reason the rules are: a board re-sending Done
    // for a task already in Done must not make a second copy, and that guard is
    // also what keeps two simultaneous patches from both spawning — only one of
    // them reads a previous status that was not Done.
    if (entered === 'done' && rows[0].repeat_rule) {
      await repeatTask(rows[0], req.user).catch((e) => console.error('[repeat]', e.message));
    }
    const applied = entered
      ? await applyAutomations({ task: rows[0], entered, actorId: req.user.id })
      : [];

    if (assignees) {
      const added = await setAssignees(req.params.id, assignees);
      // Only when somebody is actually new. A patch that re-sends the same
      // people has handed nothing over, and a rule that fired on it would run
      // every time a cell beside the names was edited.
      if (added.length) await fireTrigger({ task: rows[0], kind: 'assigned', actorId: req.user.id });
      notifyAssignees(rows[0], req.user, added)
        .catch((err) => console.error('[notify] assign:', err.message));
    }
    // Read back only when something wrote after the UPDATE — setAssignees has
    // just rewritten assignee_id, and a rule may have moved half the row. Every
    // other patch is one cell of a table being edited, and paying for a second
    // query on each of those buys nothing.
    if (!assignees && !applied.length) {
      emit('task.updated', rows[0]);
      return res.json(rows[0]);
    }
    const { rows: full } = await pool.query(`${TASK_SELECT} WHERE t.id = $1`, [req.params.id]);
    const task = full[0] ?? rows[0];
    emit('task.updated', task);
    res.json(task);
  }));

  // The other half of the link: a page knows which task it belongs to, so the
  // page can offer a way back to the board it came from. Null for the great
  // majority of pages, which belong to no task at all.
  app.get('/api/docs/:id/task', requireUser, wrap(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT t.id, t.title, t.status, t.project_id,
              p.name AS project_name, p.icon AS project_icon, p.mode AS project_mode
         FROM tasks t JOIN projects p ON p.id = t.project_id
        WHERE t.doc_id = $1 AND t.deleted_at IS NULL
        LIMIT 1`,
      [req.params.id]
    );
    res.json({ task: rows[0] ?? null });
  }));

  app.post('/api/tasks/:id/page', requireUser, wrap(async (req, res) => {
    const docId = await ensureTaskPage(req.params.id, req.user.id, createDocRow);
    if (!docId) return res.status(404).json({ error: 'not found' });
    res.json({ docId });
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
    emit('task.deleted', { id: req.params.id, by: req.user.id });
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
