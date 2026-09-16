// What happens when a task lands on somebody.
//
// Its own module because there are three ways to become an assignee now — a
// task created with one, a task patched to have one, and an automation that
// assigns — and the first version of this lived inside the route file, so the
// third quietly did none of it: an agent was made the owner of work that never
// reached its queue, and a person was auto-assigned with no inbox row, no push
// and no email. One place, every caller.
import crypto from 'node:crypto';
import { pool } from './db.js';
import { sendNotificationEmail } from './auth.js';
import { sendPush } from './push.js';
import { linkFor } from './push-rules.js';
import { enqueueForAssignees } from './agent-runs.js';

/**
 * Tell whoever a task just landed on.
 *
 * A person is told — an inbox row, a push to their devices and an email each,
 * the same three a comment mention sends. An agent account is not told, it is
 * given the work: a run goes on its queue for the runner on someone's machine
 * to claim. Mailing a machine and leaving the work unclaimed is the failure
 * this split exists to prevent.
 *
 * Best-effort: a task must still save when the mail server or a push service is
 * down, so every caller fires this without awaiting it.
 *
 * The notification points at the task rather than its page, because a task's
 * page does not exist until someone opens the task.
 */
export async function notifyAssignees(task, actor, userIds) {
  // Nobody is told they assigned themselves something.
  const targets = [...new Set(userIds ?? [])].filter((id) => id && id !== actor.id);
  if (!task || !targets.length) return;
  await enqueueForAssignees({ task, userIds: targets, requestedBy: actor.id });
  const { rows } = await pool.query(
    `SELECT id, email FROM users WHERE id = ANY($1) AND kind <> 'agent'`, [targets]);
  if (!rows.length) return;
  const actorName = actor.name || actor.email;
  const title = task.title || 'Untitled task';
  const base = process.env.BASE_URL || '';
  for (const user of rows) {
    const rowId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO notifications (id, user_id, actor_id, actor_name, doc_id, task_id, kind, body)
       VALUES ($1, $2, $3, $4, $5, $6, 'assigned', $7)`,
      [rowId, user.id, actor.id, actorName, task.doc_id, task.id, title.slice(0, 280)]
    );
    sendPush(user.id, {
      title: `${actorName} assigned you a task`,
      body: title,
      tag: rowId,
      // Null until someone opens the task, which is when its page is made —
      // linkFor sends those to the dashboard rather than to /d/null.
      docId: task.doc_id,
    }).catch((e) => console.error('[push] assign:', e.message));
    if (!user.email) continue;
    await sendNotificationEmail(
      user.email,
      `${actorName} assigned you "${title}"`,
      '',
      // linkFor lands on the dashboard when the task has no page yet, rather
      // than on /d/null — the same rule the push notification above follows.
      `${base}${linkFor({ docId: task.doc_id })}`
    );
  }
}

/**
 * The same thing, for a caller holding only ids.
 *
 * An automation knows which task it is acting on and who moved the card, but
 * not their name or the task's title — so it reads them here rather than every
 * rule carrying a row it did not need for anything else. Two extra queries, on
 * the rare path where a rule actually changed who owns something.
 */
export async function notifyAssigneesById(taskId, actorId, userIds) {
  if (!userIds?.length) return;
  const [{ rows: task }, { rows: actor }] = await Promise.all([
    pool.query('SELECT id, title, doc_id FROM tasks WHERE id = $1', [taskId]),
    pool.query('SELECT id, name, email FROM users WHERE id = $1', [actorId ?? '']),
  ]);
  if (!task[0]) return;
  // A rule can fire on a change made by nobody in particular (an import, a
  // sweeper). The notification still has to name someone, and "the workspace"
  // is more honest than a blank.
  await notifyAssignees(task[0], actor[0] ?? { id: actorId ?? null, name: 'MetanoiaDocs' }, userIds);
}
