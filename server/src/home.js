// The dashboard payload. One endpoint, one round trip — the home screen needs
// five unrelated lists and five sequential fetches would show five spinners.
import { pool } from './db.js';

// Docs the caller may see: team-visible, or explicitly granted.
const VISIBLE = `(a.user_id IS NOT NULL OR d.visibility = 'team')`;
const VISIBLE_JOIN = `LEFT JOIN doc_access a ON a.doc_id = d.id AND a.user_id = $1`;

/**
 * Activity feed, derived rather than logged: no write on the save path and it
 * works retroactively over everything already in the database. Doc edits are
 * one row per doc (the last save) rather than one per keystroke — doc_versions
 * is deliberately not a source, since it would double every edit.
 */
const ACTIVITY_SQL = `
  WITH visible AS (
    SELECT d.id, d.title, d.icon, d.created_at, d.created_by, d.updated_at, d.updated_by
      FROM docs d ${VISIBLE_JOIN}
     WHERE d.deleted_at IS NULL AND ${VISIBLE}
  ),
  events AS (
    SELECT 'doc_created' AS kind, v.created_by AS actor_id, v.created_at AS at,
           v.id AS doc_id, NULL::text AS project_id, v.title, v.icon,
           NULL::text AS task_id, NULL::text AS body
      FROM visible v WHERE v.created_by IS NOT NULL
    UNION ALL
    SELECT 'doc_edited', v.updated_by, v.updated_at, v.id, NULL, v.title, v.icon, NULL, NULL
      FROM visible v
     WHERE v.updated_by IS NOT NULL AND v.updated_at > v.created_at + interval '1 minute'
    UNION ALL
    SELECT 'comment', c.author_id, c.created_at, c.doc_id, NULL, v.title, v.icon, NULL,
           left(c.body, 140)
      FROM comments c JOIN visible v ON v.id = c.doc_id
    UNION ALL
    SELECT 'task_created', t.created_by, t.created_at, t.doc_id, p.id, p.name, p.icon, t.id, t.title
      FROM tasks t JOIN projects p ON p.id = t.project_id
     WHERE t.deleted_at IS NULL AND p.archived_at IS NULL AND p.mode <> 'data' AND t.created_by IS NOT NULL
    UNION ALL
    SELECT 'task_done', t.updated_by, t.done_at, t.doc_id, p.id, p.name, p.icon, t.id, t.title
      FROM tasks t JOIN projects p ON p.id = t.project_id
     WHERE t.deleted_at IS NULL AND p.archived_at IS NULL AND p.mode <> 'data' AND t.done_at IS NOT NULL
  )
  SELECT e.*, u.name AS actor_name
    FROM events e LEFT JOIN users u ON u.id = e.actor_id
   ORDER BY e.at DESC NULLS LAST
   LIMIT 30`;

// Assigned to me, not done, bucketed by how late it is.
const MY_TASKS_SQL = `
  SELECT t.id, t.title, t.status, t.due_at, t.priority, t.progress, t.project_id,
         p.name AS project_name, p.icon AS project_icon,
         CASE WHEN t.due_at IS NULL                THEN 'later'
              WHEN t.due_at <  current_date        THEN 'overdue'
              WHEN t.due_at =  current_date        THEN 'today'
              WHEN t.due_at <= current_date + 7    THEN 'week'
              ELSE 'later' END AS bucket
    FROM tasks t JOIN projects p ON p.id = t.project_id
   WHERE t.assignee_id = $1 AND t.status <> 'done'
     AND t.deleted_at IS NULL AND p.archived_at IS NULL AND p.mode <> 'data'
   ORDER BY t.due_at ASC NULLS LAST, t.priority DESC
   LIMIT 60`;

export function registerHomeRoutes(app, { requireUser, wrap }) {
  app.get('/api/home', requireUser, wrap(async (req, res) => {
    const uid = req.user.id;
    const [activity, myTasks, recentDocs, projects, stats] = await Promise.all([
      pool.query(ACTIVITY_SQL, [uid]),
      pool.query(MY_TASKS_SQL, [uid]),
      pool.query(
        `SELECT d.id, d.title, d.icon, d.updated_at, u.name AS updated_by_name
           FROM docs d ${VISIBLE_JOIN}
           LEFT JOIN users u ON u.id = d.updated_by
          WHERE d.deleted_at IS NULL AND ${VISIBLE}
          ORDER BY d.updated_at DESC LIMIT 12`,
        [uid]
      ),
      pool.query(
        `SELECT p.id, p.name, p.icon, p.color, p.doc_id,
                count(t.id) FILTER (WHERE t.deleted_at IS NULL) AS total,
                count(t.id) FILTER (WHERE t.deleted_at IS NULL AND t.status = 'done') AS done,
                count(t.id) FILTER (WHERE t.deleted_at IS NULL AND t.status <> 'done'
                                      AND t.due_at < current_date) AS overdue
           FROM projects p LEFT JOIN tasks t ON t.project_id = p.id
          WHERE p.archived_at IS NULL AND p.mode <> 'data'
          GROUP BY p.id ORDER BY p.position ASC, p.created_at ASC LIMIT 12`
      ),
      pool.query(
        `SELECT
           (SELECT count(*) FROM tasks t JOIN projects p ON p.id = t.project_id
             WHERE t.assignee_id = $1 AND t.status <> 'done'
               AND t.deleted_at IS NULL AND p.archived_at IS NULL AND p.mode <> 'data') AS my_open,
           (SELECT count(*) FROM tasks t JOIN projects p ON p.id = t.project_id
             WHERE t.assignee_id = $1 AND t.status <> 'done' AND t.due_at < current_date
               AND t.deleted_at IS NULL AND p.archived_at IS NULL AND p.mode <> 'data') AS my_overdue,
           (SELECT count(*) FROM tasks t JOIN projects p ON p.id = t.project_id
             WHERE t.assignee_id = $1 AND t.status <> 'done'
               AND t.due_at BETWEEN current_date AND current_date + 7
               AND t.deleted_at IS NULL AND p.archived_at IS NULL AND p.mode <> 'data') AS my_week,
           (SELECT count(*) FROM docs d ${VISIBLE_JOIN}
             WHERE d.deleted_at IS NULL AND ${VISIBLE}
               AND d.updated_at > now() - interval '7 days') AS docs_week`,
        [uid]
      ),
    ]);

    const buckets = { overdue: [], today: [], week: [], later: [] };
    for (const t of myTasks.rows) buckets[t.bucket].push(t);

    res.json({
      stats: stats.rows[0],
      myTasks: buckets,
      recentDocs: recentDocs.rows,
      activity: activity.rows,
      projects: projects.rows,
    });
  }));
}
