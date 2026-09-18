import crypto from 'node:crypto';
import { pool } from './db.js';
import { sendNotificationEmail } from './auth.js';
import { sendPush } from './push.js';
import { linkFor } from './push-rules.js';
import {
  dayOf, digestLine, isUrgent, reminderFor, reminderText, reminderTitle, today,
} from './reminder-rules.js';

/** The hour a working day starts, in the server's own clock. Nothing is sent
 *  before it: a reminder that arrives at 3am is read at 9 with fourteen others. */
const REMINDER_HOUR = Math.min(23, Math.max(0, Number(process.env.REMINDER_HOUR) || 8));

/** How often the sweep wakes up to check whether that hour has arrived. */
const SWEEP_INTERVAL_MS = 30 * 60 * 1000;

/** These are the only notifications nobody asks for — one a day per person,
 *  forever — so they are the only ones that have to be swept up after. A month
 *  is well past the 50 rows an inbox shows. */
const KEEP_DAYS = 30;

/** Open work, one row per person carrying it. The union covers both halves of
 *  the assignee split (see the task_assignees comment in db.js): the table holds
 *  the edges, the old column holds the first one, and a row that predates the
 *  table only appears in the column. */
const ASSIGNED = `
  SELECT t.id, t.title, t.due_at, t.priority, t.doc_id, t.project_id,
         e.user_id, u.name, u.email
    FROM tasks t
    JOIN projects p ON p.id = t.project_id AND p.archived_at IS NULL AND p.mode <> 'data'
    JOIN (
      SELECT task_id, user_id FROM task_assignees
      UNION
      SELECT id AS task_id, assignee_id AS user_id FROM tasks WHERE assignee_id IS NOT NULL
    ) e ON e.task_id = t.id
    JOIN users u ON u.id = e.user_id AND u.kind <> 'agent'
   WHERE t.deleted_at IS NULL AND t.status <> 'done'`;

/** The same work, seen from the person who handed it over. `created_by` is who
 *  the app records as having made the task — the closest thing it holds to an
 *  assignor, and the only one that survives the task being reassigned. */
const CREATED = `
  SELECT t.id, t.title, t.due_at, t.priority, t.doc_id, t.project_id,
         u.id AS user_id, u.name, u.email
    FROM tasks t
    JOIN projects p ON p.id = t.project_id AND p.archived_at IS NULL AND p.mode <> 'data'
    JOIN users u ON u.id = t.created_by AND u.kind <> 'agent'
   WHERE t.deleted_at IS NULL AND t.status <> 'done'`;

/** Local midnight, which is where a day starts for the person reading this. */
function startOfDay(now) {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/**
 * Everyone with open work, and what each of them is carrying.
 *
 * A person who both made a task and is doing it is one row, not two: the
 * assignee side wins, so they are reminded about the deadline they are actually
 * holding rather than told twice about the same thing in two voices.
 */
export async function pendingByUser(now = new Date()) {
  const [assigned, created] = await Promise.all([
    pool.query(ASSIGNED),
    pool.query(CREATED),
  ]);

  const names = new Map();
  for (const row of assigned.rows) {
    const list = names.get(row.id) ?? [];
    list.push(row.name || row.email || 'someone');
    names.set(row.id, list);
  }

  const people = new Map();
  const put = (row, role) => {
    const person = people.get(row.user_id) ?? { email: row.email, tasks: new Map() };
    // Assignee beats owner for the same task — see the doc comment.
    if (!(role === 'owner' && person.tasks.has(row.id))) {
      person.tasks.set(row.id, {
        id: row.id,
        title: row.title,
        dueIso: dayOf(row.due_at),
        priority: row.priority,
        docId: row.doc_id,
        projectId: row.project_id,
        role,
      });
    }
    people.set(row.user_id, person);
  };
  for (const row of assigned.rows) put(row, 'assignee');
  for (const row of created.rows) put(row, 'owner');

  return { people, names, todayIso: today(now) };
}

/**
 * Tell everyone what is on their plate, once a day.
 *
 * Idempotent by construction: a person gets at most one summary and at most one
 * reminder per task per day, and what has already gone out today is read back
 * out of the notifications table rather than tracked in a second one. So the
 * sweep can run every half hour, survive a restart mid-run, and still never say
 * the same thing twice.
 *
 * The inbox row and the push go out per reminder, the email does not: ten
 * overdue tasks are ten lines in one morning email, not ten emails. The summary
 * is what carries them.
 */
export async function sweepReminders(now = new Date()) {
  const { people, names, todayIso } = await pendingByUser(now);
  if (!people.size) return { digests: 0, reminders: 0 };

  const { rows: sent } = await pool.query(
    `SELECT user_id, task_id, kind FROM notifications
      WHERE kind IN ('due_soon', 'due_today', 'overdue', 'digest') AND created_at >= $1`,
    [startOfDay(now)],
  );
  const already = new Set(sent.map((r) => `${r.user_id}:${r.task_id ?? ''}:${r.kind}`));

  const base = process.env.BASE_URL || '';
  let digests = 0;
  let reminders = 0;

  for (const [userId, person] of people) {
    const tasks = [...person.tasks.values()];
    const urgent = tasks.filter((t) => isUrgent(t, todayIso)).length;
    const lines = [];

    for (const task of tasks) {
      const kind = reminderFor({ dueIso: task.dueIso, todayIso, role: task.role });
      if (!kind) continue;
      const line = reminderText(kind, {
        title: task.title,
        dueIso: task.dueIso,
        todayIso,
        // Who is carrying it is the assignor's half of the message; on your own
        // task it would only ever say your own name back at you.
        who: task.role === 'owner' ? (names.get(task.id) ?? []).join(', ') : null,
      });
      lines.push(line);
      // The kind is stored rather than flattened to "reminder": one task can
      // only earn one of these on one day, so it dedupes exactly the same, and
      // the inbox can tell a deadline arriving from a deadline missed without
      // reading the sentence back out of the body.
      if (already.has(`${userId}:${task.id}:${kind}`)) continue;
      const id = crypto.randomUUID();
      await pool.query(
        `INSERT INTO notifications (id, user_id, actor_id, actor_name, doc_id, task_id, kind, body)
         VALUES ($1, $2, NULL, 'MetanoiaDocs', $3, $4, $5, $6)`,
        [id, userId, task.docId, task.id, kind, line.slice(0, 280)],
      );
      reminders += 1;
      sendPush(userId, {
        title: reminderTitle(kind),
        body: line,
        tag: id,
        docId: task.docId,
      }).catch((e) => console.error('[push] reminder:', e.message));
    }

    const summary = digestLine(tasks.length, urgent);
    if (!summary || already.has(`${userId}::digest`)) continue;
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO notifications (id, user_id, actor_id, actor_name, doc_id, task_id, kind, body)
       VALUES ($1, $2, NULL, 'MetanoiaDocs', NULL, NULL, 'digest', $3)`,
      [id, userId, summary],
    );
    digests += 1;
    sendPush(userId, { title: 'Your tasks today', body: summary, tag: id }).catch((e) =>
      console.error('[push] digest:', e.message));
    if (person.email) {
      await sendNotificationEmail(
        person.email,
        `Your tasks today — ${summary}`,
        lines.join('\n'),
        `${base}${linkFor({})}`,
      );
    }
  }

  await pool.query(
    `DELETE FROM notifications
      WHERE kind IN ('due_soon', 'due_today', 'overdue', 'digest')
        AND created_at < now() - ($1 || ' days')::interval`,
    [String(KEEP_DAYS)],
  );

  return { digests, reminders };
}

let running = false;

/** Sweep at boot and every half hour after; act only once the day has started.
 *  A failed sweep is logged, never fatal — the next one repeats it. `running`
 *  guards the case where one sweep outlives the interval: two of them at once
 *  would both read the same "already sent" set and both act on it. */
export function startReminders() {
  const sweep = () => {
    if (running || new Date().getHours() < REMINDER_HOUR) return;
    running = true;
    sweepReminders()
      .then(({ digests, reminders }) => {
        if (digests || reminders) {
          console.log(`[reminders] ${digests} summary(s), ${reminders} reminder(s)`);
        }
      })
      .catch((e) => console.error('[reminders] sweep failed', e))
      .finally(() => { running = false; });
  };
  sweep();
  setInterval(sweep, SWEEP_INTERVAL_MS).unref();
}
