// "Needs you" on Home: four lists of what is waiting on the signed-in person,
// built from rules over data already in the database. The pool is passed in so
// the SQL and the mapping are testable without Postgres.
import { VISIBLE, VISIBLE_JOIN, IN_SPACE, MY_SPACE } from './home.js';
import { dayIn, zoneOf, isoDate } from './timezone.js';

const LIMIT = 20;

/** The calendar day after a 'YYYY-MM-DD', with no clock or zone involved. */
export function nextDay(day) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Today and tomorrow where the reader is — what "Overdue" and "Tomorrow" mean. */
export function needsDays(user, at = new Date()) {
  const today = dayIn(zoneOf(user), at);
  return { today, tomorrow: nextDay(today) };
}

// Mirrors grantOn: an explicit editor/owner grant, else the team role on a
// team page (unknown roles count as editor, as teamRole does), and a template
// is editable by anyone who can open it.
const EDITOR = `(a.role IN ('editor', 'owner')
  OR (a.user_id IS NULL AND d.visibility = 'team' AND d.team_role NOT IN ('viewer', 'commenter', 'suggester'))
  OR d.is_template)`;

const REVIEW_SQL = (space) => `
  SELECT s.id, s.doc_id, d.title AS doc_title, coalesce(nullif(u.name, ''), u.email) AS author_name,
         s.writer_via, s.submitted_at, count(*) OVER () AS total
    FROM doc_suggestions s JOIN docs d ON d.id = s.doc_id
    ${VISIBLE_JOIN}
    JOIN users u ON u.id = s.author_id
   WHERE s.status = 'submitted'
     AND d.deleted_at IS NULL AND ${VISIBLE} AND ${IN_SPACE('d.space_id', 2, space)}
     -- An AI draft is decided by its one approver, even when that is its author
     -- (Ask AI drafts as me, for me); a person's draft by anyone else who can edit.
     AND (s.approver_id = $1 OR (s.author_id <> $1 AND s.approver_id IS NULL AND s.writer_via IS NULL AND ${EDITOR}))
   ORDER BY s.submitted_at DESC NULLS LAST
   LIMIT ${LIMIT}`;

// Same filters as MY_TASKS_SQL in home.js, bounded at the reader's today. The
// list holds past-due and due-today (oldest first); the counts keep them apart.
const OVERDUE_SQL = (space) => `
  SELECT t.id, t.title, t.project_id, p.name AS project_name, t.due_at,
         count(*) FILTER (WHERE t.due_at < $2::date) OVER () AS total,
         count(*) FILTER (WHERE t.due_at = $2::date) OVER () AS due_today
    FROM tasks t JOIN projects p ON p.id = t.project_id
   WHERE EXISTS (SELECT 1 FROM task_assignees ta WHERE ta.task_id = t.id AND ta.user_id = $1) AND t.status <> 'done'
     AND t.due_at <= $2::date
     AND t.deleted_at IS NULL AND p.archived_at IS NULL AND p.mode <> 'data'
     AND ${MY_SPACE('p.space_id', 3, space)}
   ORDER BY t.due_at ASC, t.priority DESC
   LIMIT ${LIMIT}`;

// One row per open thread (its newest notification), until I reply in it or it
// is resolved. Resolved lives on the root; the root is coalesce(parent_id, id).
// Task threads follow the task's space the way My tasks does: a task given to
// me never drops out of sight.
const MENTIONS_SQL = (space) => `
  SELECT x.*, count(*) OVER () AS total FROM (
    SELECT DISTINCT ON (r.id)
           n.id AS notification_id, c.id AS comment_id, r.id AS thread_id, c.doc_id, c.task_id,
           coalesce(d.title, t.title) AS title, coalesce(nullif(u.name, ''), nullif(c.author_name, ''), u.email) AS author_name,
           left(coalesce(nullif(c.body, ''), CASE WHEN jsonb_array_length(c.attachments) > 0 THEN '🎤 Voice note' END), 140) AS snippet,
           n.created_at,
           -- The resolve route's rule: the thread's author, or on a page someone who can edit it.
           (r.author_id = $1 OR (c.doc_id IS NOT NULL AND ${EDITOR})) AS can_resolve
      FROM notifications n
      JOIN comments c ON c.id = n.comment_id
      JOIN comments r ON r.id = coalesce(c.parent_id, c.id)
      LEFT JOIN docs d ON d.id = c.doc_id
      LEFT JOIN doc_access a ON a.doc_id = d.id AND a.user_id = $1
      LEFT JOIN tasks t ON t.id = c.task_id
      LEFT JOIN projects p ON p.id = t.project_id
      LEFT JOIN users u ON u.id = c.author_id
     WHERE n.user_id = $1 AND n.kind IN ('mention', 'reply', 'reply_to_you')
       AND NOT r.resolved
       -- Written as id/parent_id rather than coalesce() so comments_parent_idx serves it.
       AND NOT EXISTS (SELECT 1 FROM comments m WHERE (m.id = r.id OR m.parent_id = r.id) AND m.author_id = $1 AND m.created_at > n.created_at)
       -- A plain 'reply' goes to everyone around the page or task; it needs me
       -- only in a thread I took part in.
       AND (n.kind <> 'reply' OR EXISTS (SELECT 1 FROM comments q WHERE (q.id = r.id OR q.parent_id = r.id) AND q.author_id = $1))
       AND ((c.doc_id IS NOT NULL AND d.deleted_at IS NULL AND ${VISIBLE} AND ${IN_SPACE('d.space_id', 2, space)})
         OR (c.task_id IS NOT NULL AND t.deleted_at IS NULL AND p.archived_at IS NULL AND ${MY_SPACE('p.space_id', 2, space)}))
     ORDER BY r.id, n.created_at DESC
  ) x
  ORDER BY x.created_at DESC
  LIMIT ${LIMIT}`;

// Pages I made, edited or pinned that someone else saved since I last opened
// them. A page I never opened counts from its creation only if I created it.
const CHANGED_SQL = (space) => `
  SELECT d.id, d.title, d.updated_at, coalesce(nullif(u.name, ''), u.email) AS changed_by_name, count(*) OVER () AS total
    FROM docs d ${VISIBLE_JOIN}
    LEFT JOIN doc_opens o ON o.doc_id = d.id AND o.user_id = $1
    LEFT JOIN users u ON u.id = d.updated_by
   WHERE d.deleted_at IS NULL AND d.kind <> 'task' AND ${VISIBLE} AND ${IN_SPACE('d.space_id', 2, space)}
     AND (d.created_by = $1
          OR EXISTS (SELECT 1 FROM doc_editors e WHERE e.doc_id = d.id AND e.user_id = $1)
          OR EXISTS (SELECT 1 FROM favorites f WHERE f.doc_id = d.id AND f.user_id = $1))
     AND d.updated_by IS NOT NULL AND d.updated_by <> $1
     AND d.updated_at > coalesce(o.opened_at, CASE WHEN d.created_by = $1 THEN d.created_at END)
   ORDER BY d.updated_at DESC
   LIMIT ${LIMIT}`;

const countOf = (r) => Number(r.rows[0]?.total ?? 0);

export async function needsQueries(pool, { userId, spaceId, today }) {
  const space = spaceId || null;
  const sp = space ? [space] : [];
  const [review, overdue, mentions, changed] = await Promise.all([
    pool.query(REVIEW_SQL(space), [userId, ...sp]),
    pool.query(OVERDUE_SQL(space), [userId, today, ...sp]),
    pool.query(MENTIONS_SQL(space), [userId, ...sp]),
    pool.query(CHANGED_SQL(space), [userId, ...sp]),
  ]);
  return {
    counts: {
      review: countOf(review), overdue: countOf(overdue),
      dueToday: Number(overdue.rows[0]?.due_today ?? 0), mentions: countOf(mentions), changed: countOf(changed) },
    review: review.rows.map((r) => ({
      suggestionId: r.id, docId: r.doc_id, docTitle: r.doc_title, authorName: r.author_name,
      writerVia: r.writer_via ?? null, submittedAt: r.submitted_at,
    })),
    overdue: overdue.rows.map((r) => {
      const dueAt = isoDate(r.due_at);
      return { taskId: r.id, title: r.title, projectId: r.project_id, projectName: r.project_name, dueAt, today: dueAt === today };
    }),
    mentions: mentions.rows.map((r) => ({
      notificationId: r.notification_id, commentId: r.comment_id, threadId: r.thread_id,
      docId: r.doc_id ?? null, taskId: r.task_id ?? null, title: r.title, authorName: r.author_name,
      snippet: r.snippet, createdAt: r.created_at, canResolve: Boolean(r.can_resolve),
    })),
    changed: changed.rows.map((r) => ({
      docId: r.id, title: r.title, changedByName: r.changed_by_name, changedAt: r.updated_at,
    })),
    today,
    tomorrow: nextDay(today),
  };
}
