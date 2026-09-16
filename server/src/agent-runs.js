// The run queue an external coding agent polls.
//
// The MCP server is the pull half of letting machines in: an agent asks, the
// workspace answers. This is the push half. Assign a task to an agent account,
// or @-mention one in a comment, and the work becomes a row here; a runner on
// somebody's own machine claims it, gives it to Claude Code (or Codex, or a
// command of their own), and posts back what happened.
//
// Nothing here reaches out to the agent, which is the point: an agent living
// behind a laptop firewall works exactly as well as one on a server, and this
// instance never holds a key to anyone's machine.
import crypto from 'node:crypto';
import { pool } from './db.js';
import { ensureTaskPage } from './task-writes.js';
import { emit } from './webhooks.js';

export const RUN_TRIGGERS = ['assign', 'mention', 'manual'];
/** A claimed run nobody has reported on for this long is handed to the next
 *  poller. The runner's machine gets closed, loses the network, or is simply
 *  killed mid-task; without this the work is stuck forever behind a process
 *  that no longer exists.
 *  ponytail: a fixed timeout, not a heartbeat — add one if long runs get
 *  re-claimed while they are still going. */
const STALE_MIN = Number(process.env.AGENT_RUN_STALE_MIN || 30);

/**
 * Queue a run, unless this agent already has an open one for this task.
 *
 * Returns the row, or null when the ask was a duplicate. The dedupe is the
 * partial unique index, not a SELECT first: two board drags landing together
 * would both pass a check and both insert.
 */
export async function enqueueRun({ agentId, taskId = null, docId = null, triggerKind = 'manual', prompt = '', requestedBy = null }) {
  if (!agentId) return null;
  const { rows } = await pool.query(
    `INSERT INTO agent_runs (id, agent_id, task_id, doc_id, trigger_kind, prompt, requested_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (agent_id, task_id) WHERE status IN ('queued', 'running') DO NOTHING
     RETURNING *`,
    [crypto.randomUUID(), agentId, taskId, docId,
     RUN_TRIGGERS.includes(triggerKind) ? triggerKind : 'manual',
     String(prompt || '').slice(0, 8000), requestedBy]
  );
  return rows[0] ?? null;
}

/**
 * Queue a run for whichever of `userIds` are agent accounts, and ignore the
 * rest — assignees.js tells those ones as people, in the same breath.
 *
 * Every way of becoming an assignee routes through its one caller, so an agent
 * can never be given work down one path and merely emailed about it down
 * another. That is the bug this pair exists to make impossible.
 */
export async function enqueueForAssignees({ task, userIds, requestedBy }) {
  const ids = [...new Set(userIds ?? [])].filter(Boolean);
  if (!task || !ids.length) return;
  const { rows } = await pool.query(
    `SELECT id FROM users WHERE id = ANY($1) AND kind = 'agent'`, [ids]);
  for (const { id: agentId } of rows) {
    await enqueueRun({
      agentId,
      taskId: task.id,
      docId: task.doc_id ?? null,
      triggerKind: 'assign',
      prompt: task.title || '',
      requestedBy,
    }).catch((e) => console.error('[agent] enqueue assign:', e.message));
  }
}

/** Everything the runner needs to do the work, read fresh at claim time — the
 *  task may have been renamed, moved or written on since it was queued. */
async function runContext(run) {
  const out = {
    id: run.id,
    trigger: run.trigger_kind,
    prompt: run.prompt,
    createdAt: run.created_at,
    task: null,
    page: null,
    requestedBy: null,
  };
  if (run.task_id) {
    const { rows } = await pool.query(
      `SELECT t.id, t.title, t.status, t.kind, t.priority, t.points, t.due_at, t.start_at,
              t.project_id, t.doc_id, p.name AS project_name
         FROM tasks t JOIN projects p ON p.id = t.project_id
        WHERE t.id = $1 AND t.deleted_at IS NULL`,
      [run.task_id]
    );
    out.task = rows[0] ?? null;
  }
  const docId = out.task?.doc_id || run.doc_id;
  if (docId) {
    const { rows } = await pool.query(
      `SELECT id, title, coalesce(search_text, '') AS text
         FROM docs WHERE id = $1 AND deleted_at IS NULL`,
      [docId]
    );
    out.page = rows[0] ?? null;
  }
  if (run.requested_by) {
    const { rows } = await pool.query(
      'SELECT id, name, username FROM users WHERE id = $1', [run.requested_by]);
    out.requestedBy = rows[0] ?? null;
  }
  return out;
}

/**
 * Write the agent's answer where the person who asked will look for it: a
 * comment on the task's page, made if the task had no page yet.
 *
 * The comment notifier lives in the request path for human comments and is not
 * reachable from here, so the one notification that matters — the requester's —
 * is written directly. An agent posting into a thread nobody asked for would be
 * noise; only the person who triggered the run hears about it.
 */
async function postResult(run, text, createDocRow) {
  const docId = run.task_id
    ? await ensureTaskPage(run.task_id, run.agent_id, createDocRow)
    : run.doc_id;
  if (!docId) return null;
  const commentId = crypto.randomUUID();
  const { rows: agent } = await pool.query('SELECT name, email FROM users WHERE id = $1', [run.agent_id]);
  const agentName = agent[0]?.name || agent[0]?.email || 'Agent';
  await pool.query(
    `INSERT INTO comments (id, doc_id, body, author_id, author_name)
     VALUES ($1, $2, $3, $4, $5)`,
    [commentId, docId, String(text).slice(0, 4000), run.agent_id, agentName]
  );
  if (run.requested_by && run.requested_by !== run.agent_id) {
    await pool.query(
      `INSERT INTO notifications (id, user_id, actor_id, actor_name, doc_id, task_id, comment_id, kind, body)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'comment',$8)`,
      [crypto.randomUUID(), run.requested_by, run.agent_id, agentName,
       docId, run.task_id, commentId, String(text).slice(0, 280)]
    );
  }
  return { docId, commentId };
}

const publicRun = (r) => ({
  id: r.id,
  agent_id: r.agent_id,
  agent_name: r.agent_name ?? null,
  task_id: r.task_id,
  doc_id: r.doc_id,
  trigger: r.trigger_kind,
  status: r.status,
  prompt: r.prompt,
  result: r.result,
  error: r.error,
  requested_by: r.requested_by,
  created_at: r.created_at,
  started_at: r.started_at,
  finished_at: r.finished_at,
});

const RUN_SELECT = `
  SELECT r.*, u.name AS agent_name FROM agent_runs r
    LEFT JOIN users u ON u.id = r.agent_id`;

export function registerAgentRoutes(app, { requireUser, wrap, createDocRow }) {
  /** Only an agent account may work the queue. A person's token reaching this
   *  is almost always a runner configured with the wrong token, so it says so
   *  rather than returning an empty queue forever. */
  const requireAgent = (req, res, next) => {
    if (req.user?.kind !== 'agent') {
      return res.status(403).json({ error: 'This token belongs to a person. Runs are claimed by an agent account — an admin marks one in Settings → Members.' });
    }
    next();
  };

  // The accounts a run can be given to. Every member sees them: assigning work
  // to an agent is assigning work, not administration.
  app.get('/api/agents', requireUser, wrap(async (_req, res) => {
    const { rows } = await pool.query(
      `SELECT id, name, username, email FROM users WHERE kind = 'agent' ORDER BY name`);
    res.json(rows);
  }));

  // ── the runner's two routes ─────────────────────────────────────────────

  // Claim the next queued run, or 204 when there is nothing to do. SKIP LOCKED
  // means several runners on the same agent account never hand each other the
  // same task — they each take a different row instead of queueing on a lock.
  app.get('/api/agent/runs/next', requireUser, requireAgent, wrap(async (req, res) => {
    await pool.query(
      `UPDATE agent_runs SET status = 'queued', started_at = NULL
        WHERE agent_id = $1 AND status = 'running'
          AND started_at < now() - ($2 || ' minutes')::interval`,
      [req.user.id, String(STALE_MIN)]
    );
    const { rows } = await pool.query(
      `UPDATE agent_runs SET status = 'running', started_at = now()
        WHERE id = (
          SELECT id FROM agent_runs
           WHERE agent_id = $1 AND status = 'queued'
           ORDER BY created_at
           LIMIT 1 FOR UPDATE SKIP LOCKED
        )
        RETURNING *`,
      [req.user.id]
    );
    if (!rows[0]) return res.status(204).end();
    res.json(await runContext(rows[0]));
  }));

  // Report what happened. Idempotent in the way that matters: a run already
  // finished is not reopened by a late second call from a runner that retried.
  app.post('/api/agent/runs/:id/result', requireUser, requireAgent, wrap(async (req, res) => {
    const ok = req.body?.ok !== false;
    const result = String(req.body?.result || '').slice(0, 20000);
    const error = req.body?.error ? String(req.body.error).slice(0, 2000) : null;
    const { rows } = await pool.query(
      `UPDATE agent_runs
          SET status = $3, result = $4, error = $5, finished_at = now()
        WHERE id = $1 AND agent_id = $2 AND status = 'running'
        RETURNING *`,
      [req.params.id, req.user.id, ok ? 'done' : 'failed', result, error]
    );
    if (!rows[0]) return res.status(404).json({ error: 'no run of yours is running under that id' });

    // Say something even on a failure: a run that fails silently is the same
    // experience as one that was never picked up.
    const text = ok ? (result || '_Done — nothing to report._') : `**Run failed.**\n\n${error || 'No detail given.'}`;
    let posted = null;
    if (req.body?.comment !== false) {
      posted = await postResult(rows[0], text, createDocRow)
        .catch((e) => { console.error('[agent] post result:', e.message); return null; });
    }
    emit('run.finished', { ...publicRun(rows[0]), comment_id: posted?.commentId ?? null });
    res.json({ ok: true, docId: posted?.docId ?? null });
  }));

  // ── the workspace's side ────────────────────────────────────────────────

  app.get('/api/tasks/:id/runs', requireUser, wrap(async (req, res) => {
    const { rows } = await pool.query(
      `${RUN_SELECT} WHERE r.task_id = $1 ORDER BY r.created_at DESC LIMIT 20`,
      [req.params.id]
    );
    res.json(rows.map(publicRun));
  }));

  // Hand a task to an agent by hand, without assigning it — "have a look at
  // this" is a different act from "this is yours".
  app.post('/api/tasks/:id/runs', requireUser, wrap(async (req, res) => {
    const agentId = String(req.body?.agentId || '');
    const { rows: agent } = await pool.query(
      `SELECT id FROM users WHERE id = $1 AND kind = 'agent'`, [agentId]);
    if (!agent[0]) return res.status(400).json({ error: 'Pick an agent account.' });
    const { rows: task } = await pool.query(
      'SELECT id, title, doc_id FROM tasks WHERE id = $1 AND deleted_at IS NULL', [req.params.id]);
    if (!task[0]) return res.status(404).json({ error: 'not found' });
    const run = await enqueueRun({
      agentId,
      taskId: task[0].id,
      docId: task[0].doc_id,
      triggerKind: 'manual',
      prompt: String(req.body?.prompt || task[0].title || ''),
      requestedBy: req.user.id,
    });
    if (!run) return res.status(409).json({ error: 'That agent is already working on this task.' });
    res.json(publicRun(run));
  }));

  // Stopping a queued run is just not handing it out. A running one is on
  // someone else's machine and cannot be reached, so cancelling it marks the
  // row and lets the runner's result 404 when it finally arrives.
  app.post('/api/agent/runs/:id/cancel', requireUser, wrap(async (req, res) => {
    const { rows } = await pool.query(
      `UPDATE agent_runs SET status = 'cancelled', finished_at = now()
        WHERE id = $1 AND status IN ('queued', 'running') RETURNING *`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'not found' });
    res.json(publicRun(rows[0]));
  }));
}
