/**
 * "Start notes" for a calendar event: one private page per person per event
 * occurrence, pre-filled with when, who, the pages the invite links to and a
 * snapshot of each teammate's open tasks. Never automatic — only on a click.
 */
import { zoneOf } from './timezone.js';
import { spaceForNew } from './space-move.js';

const TASKS_PER_ATTENDEE = 5;

/** Plain text that must not turn into markup (or a page link) in the notes. */
const lit = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().replace(/[\\`*_~[\]<>#|]/g, '\\$&');
/** Link text: the link pattern stops at the first `]`, so brackets go entirely. */
const linkText = (s) => String(s ?? '').replace(/\s+/g, ' ').replace(/[[\]]/g, '').trim() || 'Untitled';

/** Ids of `${baseUrl}/d/<id>` links in the event description, in order, deduped. */
export function docIdsIn(description, baseUrl) {
  const base = String(baseUrl || '').replace(/\/+$/, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (!base || !description) return [];
  const re = new RegExp(`${base}/d/([A-Za-z0-9_-]+)`, 'g');
  return [...new Set([...String(description).matchAll(re)].map((m) => m[1]))];
}

/** When the meeting is, in the person's zone: date for all-day, date · start – end otherwise. */
export function whenLine(event, zone) {
  if (!event.start?.dateTime && event.start?.date) {
    // An all-day date is a calendar day, not an instant: read it as such.
    return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', dateStyle: 'full' }).format(new Date(`${event.start.date}T00:00:00Z`));
  }
  const s = new Date(event.start?.dateTime);
  const e = event.end?.dateTime ? new Date(event.end.dateTime) : null;
  const day = new Intl.DateTimeFormat('en-US', { timeZone: zone, dateStyle: 'full' }).format(s);
  const t = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeStyle: 'short' });
  const zoneName = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'short' })
    .formatToParts(s).find((p) => p.type === 'timeZoneName')?.value;
  return `${day} · ${t.format(s)}${e ? ` – ${t.format(e)}` : ''}${zoneName ? ` (${zoneName})` : ''}`;
}

/** The title's date part, in the person's zone. */
export function titleDate(event, zone) {
  if (!event.start?.dateTime && event.start?.date) {
    return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', dateStyle: 'medium' }).format(new Date(`${event.start.date}T00:00:00Z`));
  }
  return new Intl.DateTimeFormat('en-US', { timeZone: zone, dateStyle: 'medium' }).format(new Date(event.start?.dateTime));
}

/**
 * The page body. `teammates`: email (lowercase) -> { id, name };
 * `linked`: doc ids the person can open; `tasks`: user id -> [{ id, title, project_id }].
 */
export function notesMarkdown({ event, zone, teammates, linked, tasks }) {
  const out = [lit(whenLine(event, zone)), '', '## Attendees'];
  const people = (event.attendees || []).filter((a) => a && !a.resource);
  if (!people.length) out.push('- (none listed)');
  const matched = [];
  for (const a of people) {
    const u = teammates.get(String(a.email || '').toLowerCase());
    if (u) { matched.push(u); out.push(`- ${lit(u.name || a.displayName || a.email)}`); continue; }
    const name = a.displayName && a.displayName !== a.email ? `${a.displayName} (${a.email})` : a.email || a.displayName;
    out.push(`- ${lit(name)}`);
  }
  if (linked.length) out.push('', '## Linked pages', ...linked.map((id) => `- [[${id}]]`));
  const withTasks = matched.filter((u) => tasks.get(u.id)?.length);
  if (withTasks.length) {
    out.push('', '## Open tasks');
    for (const u of withTasks) {
      out.push(`- ${lit(u.name)}`);
      for (const t of tasks.get(u.id).slice(0, TASKS_PER_ATTENDEE)) {
        out.push(`  - [${linkText(t.title)}](/db/${encodeURIComponent(t.project_id)}?task=${encodeURIComponent(t.id)})`);
      }
    }
  }
  out.push('', '## Notes', '', '', '## Action items', '- [ ] ');
  return out.join('\n');
}

export function registerMeetingNotesRoutes(app, {
  requireUser, needsPerson, wrap, pool, createDocRow, grantOn, fetchEvent, calendarReady,
  baseUrl = process.env.BASE_URL,
}) {
  /** The caller's own notes page for the event, if it is still a live page. */
  async function liveNotes(uid, eventId) {
    const { rows } = await pool.query(
      `SELECT m.doc_id, d.deleted_at IS NULL AS live FROM meeting_notes m LEFT JOIN docs d ON d.id = m.doc_id
        WHERE m.user_id = $1 AND m.event_id = $2`,
      [uid, eventId],
    );
    return rows[0] || null;
  }

  app.post('/api/calendar/events/:eventId/notes', requireUser, needsPerson, wrap(async (req, res) => {
    if (!(await calendarReady())) return res.status(404).json({ error: 'Not found' });
    const uid = req.user.id;
    const eventId = String(req.params.eventId || '');
    if (!eventId || eventId.length > 1024) return res.status(400).json({ error: 'Bad event id' });

    const had = await liveNotes(uid, eventId);
    if (had?.live) return res.json({ docId: had.doc_id, created: false });

    // Fetched with the person's own token from their own calendar: an id that is not theirs is simply missing.
    const got = await fetchEvent(uid, eventId);
    if (got.reconnect) return res.status(409).json({ error: 'Reconnect your calendar', reconnect: true });
    if (got.missing) return res.status(404).json({ error: 'Event not found' });
    const event = got.event;
    const zone = zoneOf(req.user);

    const emails = [...new Set((event.attendees || []).map((a) => String(a?.email || '').toLowerCase()).filter(Boolean))];
    const teammates = new Map();
    if (emails.length) {
      const u = await pool.query(
        "SELECT id, name, lower(email) AS email FROM users WHERE kind <> 'agent' AND lower(email) = ANY($1)", [emails],
      );
      for (const r of u.rows) teammates.set(r.email, { id: r.id, name: r.name });
    }

    // A grant outlives the trash, so live pages are picked first.
    const mentioned = docIdsIn(event.description, baseUrl);
    const live = mentioned.length
      ? new Set((await pool.query('SELECT id FROM docs WHERE id = ANY($1) AND deleted_at IS NULL', [mentioned])).rows.map((r) => r.id))
      : new Set();
    const linked = [];
    for (const id of mentioned) if (live.has(id) && await grantOn(id, uid)) linked.push(id);

    const tasks = new Map();
    const ids = [...teammates.values()].map((t) => t.id);
    if (ids.length) {
      const t = await pool.query(
        `SELECT user_id, id, title, project_id FROM (
           SELECT ta.user_id, t.id, t.title, t.project_id,
                  row_number() OVER (PARTITION BY ta.user_id ORDER BY t.due_at ASC NULLS LAST, t.created_at) AS rn
             FROM task_assignees ta
             JOIN tasks t ON t.id = ta.task_id
             JOIN projects p ON p.id = t.project_id
            WHERE ta.user_id = ANY($1) AND t.status <> 'done' AND t.deleted_at IS NULL
              AND p.archived_at IS NULL AND p.mode <> 'data'
         ) x WHERE rn <= ${TASKS_PER_ATTENDEE} ORDER BY user_id, rn`,
        [ids],
      );
      for (const r of t.rows) tasks.set(r.user_id, [...(tasks.get(r.user_id) || []), r]);
    }

    const title = `${String(event.summary || '(No title)').replace(/\s+/g, ' ').trim()} — ${titleDate(event, zone)}`.slice(0, 200);
    const doc = await createDocRow({
      title, icon: '📝', userId: uid, folderId: null, visibility: 'private', kind: 'doc',
      spaceId: await spaceForNew(pool, { requested: req.body?.spaceId }),
      content: notesMarkdown({ event, zone, teammates, linked, tasks }),
    });

    // The page is made before the row, so two clicks at once can both make one:
    // the row's primary key picks the winner and the loser's page is removed
    // (it is brand new, private and unseen). A stale row pointing at a trashed
    // page is cleared first, so it is replaced rather than kept.
    if (had) await pool.query('DELETE FROM meeting_notes WHERE user_id = $1 AND event_id = $2 AND doc_id = $3', [uid, eventId, had.doc_id]);
    const ins = await pool.query(
      `INSERT INTO meeting_notes (user_id, event_id, doc_id) VALUES ($1, $2, $3)
       ON CONFLICT (user_id, event_id) DO NOTHING RETURNING doc_id`,
      [uid, eventId, doc.id],
    );
    if (ins.rows[0]) return res.json({ docId: doc.id, created: true });
    await pool.query('DELETE FROM docs WHERE id = $1 AND created_by = $2', [doc.id, uid]);
    const won = await liveNotes(uid, eventId);
    if (!won?.live) throw new Error('Notes page lost a race to a page that is gone');
    res.json({ docId: won.doc_id, created: false });
  }));
}
