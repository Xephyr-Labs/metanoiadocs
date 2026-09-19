// A comment thread on a task.
//
// Work is discussed where it is tracked. Until now the only place to say
// anything about a task was its page — which does not exist until somebody
// opens the task, is a document rather than a conversation, and is invisible
// from the board, the table and the calendar where the work is actually looked
// at. So "what's the status of this?" went to chat, and the answer never came
// back to the row it was about.
//
// The rows live in `comments` beside a page's, distinguished by which of
// doc_id / task_id is filled (see the CHECK in db.js). Threading, resolving
// and deleting are the same for both; only who gets told is different, which
// is what this module is.
import crypto from 'node:crypto';
import { pool } from './db.js';
import { sendNotificationEmail } from './auth.js';
import { mentionHandles } from './mentions.js';
import { sendPush } from './push.js';
import { linkFor } from './push-rules.js';
import { emit } from './webhooks.js';

const MAX_BODY = 4000;

/**
 * Everyone who should hear about a comment on this task, and why.
 *
 * Four ways to be involved, in falling order of directness — named in the
 * text, carrying the work, having asked for it, having already spoken in the
 * thread. The reason is kept because it is what the notification says, and
 * because a mention should not be demoted to "commented on" by an assignment
 * that also happens to be true.
 *
 * Exported for its test: this is the whole behaviour of the feature that is
 * worth getting wrong, and it needs no database to check.
 */
export function recipientsFor({ handles, byHandle, assigneeIds, creatorId, participantIds, authorId }) {
  const out = new Map();
  const add = (id, kind) => {
    if (!id || id === authorId || out.has(id)) return;
    out.set(id, kind);
  };
  for (const handle of handles) add(byHandle.get(handle), 'mention');
  for (const id of assigneeIds) add(id, 'comment');
  add(creatorId, 'comment');
  for (const id of participantIds) add(id, 'comment');
  return out;
}

/**
 * Tell them. Best-effort in the same way a page comment's fan-out is: the
 * comment is already saved, and a push service or mail server having a bad
 * minute must not turn into a failed request for the person who wrote it.
 */
async function notify({ commentId, task, body, actor }) {
  const handles = mentionHandles(body);
  const byHandle = new Map();
  if (handles.length) {
    const { rows } = await pool.query(
      `SELECT id, lower(username) AS handle FROM users
        WHERE lower(username) = ANY($1) AND kind <> 'agent'`,
      [handles]
    );
    for (const r of rows) byHandle.set(r.handle, r.id);
  }
  const [{ rows: assignees }, { rows: participants }] = await Promise.all([
    pool.query('SELECT user_id FROM task_assignees WHERE task_id = $1', [task.id]),
    pool.query(
      'SELECT DISTINCT author_id FROM comments WHERE task_id = $1 AND author_id IS NOT NULL',
      [task.id]
    ),
  ]);

  const recipients = recipientsFor({
    handles,
    byHandle,
    assigneeIds: assignees.map((r) => r.user_id),
    creatorId: task.created_by,
    participantIds: participants.map((r) => r.author_id),
    authorId: actor.id,
  });
  if (!recipients.size) return;

  // An agent account is not told about a comment — it is asked, and being
  // asked is what an @-mention on a page already queues a run for. Leaving
  // them out here keeps a machine from collecting an inbox nobody reads.
  const { rows: people } = await pool.query(
    `SELECT id, email FROM users WHERE id = ANY($1) AND kind <> 'agent'`,
    [[...recipients.keys()]]
  );

  const actorName = actor.name || actor.email;
  const title = task.title || 'Untitled task';
  const snippet = body.slice(0, 280);
  const base = process.env.BASE_URL || '';
  const link = linkFor({ docId: task.doc_id, projectId: task.project_id });

  for (const person of people) {
    const kind = recipients.get(person.id);
    const rowId = crypto.randomUUID();
    const verb = kind === 'mention' ? 'mentioned you in' : 'commented on';
    await pool.query(
      `INSERT INTO notifications (id, user_id, actor_id, actor_name, doc_id, task_id, comment_id, kind, body)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [rowId, person.id, actor.id, actorName, task.doc_id, task.id, commentId, kind, snippet]
    );
    // Tagged with the notification row id, the same as every other alert, so a
    // push and the open tab's own poll raise one notification between them.
    sendPush(person.id, {
      title: `${actorName} ${verb} "${title}"`,
      body: snippet,
      tag: rowId,
      docId: task.doc_id,
      projectId: task.project_id,
    }).catch((e) => console.error('[push] task comment:', e.message));
    if (!person.email) continue;
    await sendNotificationEmail(
      person.email,
      `${actorName} ${verb} "${title}"`,
      snippet,
      `${base}${link}`
    );
  }
}

export function registerTaskCommentRoutes(app, { requireUser, wrap }) {
  app.get('/api/tasks/:id/comments', requireUser, wrap(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT c.id, c.body, c.author_id, c.author_name, c.parent_id, c.resolved, c.created_at,
              u.kind AS author_kind
         FROM comments c
         LEFT JOIN users u ON u.id = c.author_id
        WHERE c.task_id = $1
        ORDER BY c.created_at ASC`,
      [req.params.id]
    );
    res.json(rows);
  }));

  app.post('/api/tasks/:id/comments', requireUser, wrap(async (req, res) => {
    const body = String(req.body?.body || '').trim().slice(0, MAX_BODY);
    if (!body) return res.status(400).json({ error: 'empty comment' });
    const { rows: task } = await pool.query(
      'SELECT id, title, doc_id, project_id, created_by FROM tasks WHERE id = $1 AND deleted_at IS NULL',
      [req.params.id]
    );
    if (!task[0]) return res.status(404).json({ error: 'not found' });

    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO comments (id, task_id, body, author_id, author_name, parent_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, task[0].id, body, req.user.id, req.user.name || req.user.email, req.body?.parentId || null]
    );
    notify({ commentId: id, task: task[0], body, actor: req.user })
      .catch((e) => console.error('[notify] task comment fanout failed:', e.message));
    emit('comment.created', { id, task_id: task[0].id, body, author_id: req.user.id });
    res.json({
      id,
      body,
      author_id: req.user.id,
      author_name: req.user.name || req.user.email,
      parent_id: req.body?.parentId || null,
      resolved: false,
      created_at: new Date().toISOString(),
    });
  }));
}
