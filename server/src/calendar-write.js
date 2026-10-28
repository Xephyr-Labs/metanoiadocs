/**
 * Create, edit, cancel and answer meetings on the person's own primary Google
 * calendar. Edit and cancel are for the organiser only, checked against a fresh
 * fetch of the event, never against anything the browser sends. Every write
 * tells the guests (sendUpdates=all). Google's error text stays on the server.
 */
import { randomUUID } from 'node:crypto';
import { zoneOf } from './timezone.js';

const EVENTS = '/calendar/v3/calendars/primary/events';
const DAY = 86_400_000;
const MAX_SPAN = 14 * DAY;
// Google ids are base32hex, plus `_` for a recurring instance (abc_20261102T150000Z).
const ID_RE = /^[a-zA-Z0-9_]{1,1024}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// An offset is required: a bare local time means nothing without a zone.
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;
const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:".]+(\.[^\s@<>()[\]\\,;:".]+)+$/;
const RESPONSES = ['accepted', 'tentative', 'declined'];

const realDate = (s) => DATE_RE.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`))
  && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

/** start/end/allDay → Google's start/end, or an error string. `clear` nulls the other shape (a PATCH merges). */
function times(b, zone, clear) {
  const allDay = b.allDay === true;
  const { start, end } = b;
  if (typeof start !== 'string' || typeof end !== 'string') return 'Start and end are required.';
  let span;
  if (allDay) {
    if (!realDate(start) || !realDate(end)) return 'All-day dates must be YYYY-MM-DD.';
    span = Date.parse(end) - Date.parse(start);
  } else {
    if (!DATETIME_RE.test(start) || !DATETIME_RE.test(end) || Number.isNaN(Date.parse(start)) || Number.isNaN(Date.parse(end))) {
      return 'Start and end must be ISO date-times.';
    }
    span = Date.parse(end) - Date.parse(start);
  }
  if (!(span > 0)) return 'The end must be after the start.';
  if (span > MAX_SPAN) return 'A meeting can last at most 14 days.';
  const one = (v) => (allDay
    ? { date: v, ...(clear && { dateTime: null, timeZone: null }) }
    : { dateTime: v, timeZone: zone, ...(clear && { date: null }) });
  return { start: one(start), end: one(end) };
}

/** Validated, lower-cased, deduped attendee emails, or an error string. */
function emails(list) {
  if (!Array.isArray(list)) return 'Attendees must be a list of emails.';
  const out = [...new Set(list.map((e) => (typeof e === 'string' ? e.trim().toLowerCase() : '')))];
  if (out.length > 50) return 'At most 50 attendees.';
  if (out.some((e) => e.length > 254 || !EMAIL_RE.test(e))) return 'One of the attendee emails is not valid.';
  return out;
}

/**
 * The request body → a Google event body (partial for a PATCH), or { error }.
 * `existing` (PATCH) lets an edited guest list keep answers already given and your own entry.
 */
function eventBody(b, zone, { partial, existing, uuid = randomUUID } = {}) {
  if (!b || typeof b !== 'object') return { error: 'Missing body.' };
  const out = {};
  if (!partial || b.title !== undefined) {
    const t = typeof b.title === 'string' ? b.title.trim() : '';
    if (!t || t.length > 200) return { error: 'Title must be 1 to 200 characters.' };
    out.summary = t;
  }
  if (!partial || b.start !== undefined || b.end !== undefined || b.allDay !== undefined) {
    const t = times(b, zone, partial);
    if (typeof t === 'string') return { error: t };
    Object.assign(out, t);
  }
  if (!partial || b.attendees !== undefined) {
    const list = emails(b.attendees ?? []);
    if (typeof list === 'string') return { error: list };
    const old = Array.isArray(existing?.attendees) ? existing.attendees : [];
    const had = new Set(old.map((a) => String(a?.email || '').toLowerCase()));
    const want = new Set(list);
    out.attendees = partial
      ? [...old.filter((a) => a?.self || want.has(String(a?.email || '').toLowerCase())),
        ...list.filter((e) => !had.has(e)).map((email) => ({ email }))]
      : list.map((email) => ({ email }));
  }
  if (b.description !== undefined) {
    if (typeof b.description !== 'string' || b.description.length > 5000) return { error: 'Description must be at most 5000 characters.' };
    out.description = b.description;
  }
  if (b.meet === true && !existing?.conferenceData) {
    out.conferenceData = { createRequest: { requestId: uuid(), conferenceSolutionKey: { type: 'hangoutsMeet' } } };
  }
  // null clears the conference; only meaningful on an edit of an event that has one.
  if (b.meet === false && existing?.conferenceData) out.conferenceData = null;
  // Before the fetch (no `existing`) a meet flag may still turn out to be a change.
  const meetPending = partial && !existing && typeof b.meet === 'boolean';
  if (!Object.keys(out).length && !meetPending) return { error: 'Nothing to change.' };
  return { body: out };
}

export function registerCalendarWriteRoutes(app, {
  requireUser, needsPerson, wrap, googleSend, fetchEvent, calendarReady, uuid = randomUUID,
}) {
  const notFound = (res) => res.status(404).json({ error: 'Not found' });
  const failed = (res, status) => {
    console.error('[calendar] Google write failed', status);
    return res.status(502).json({ error: "Google Calendar didn't take that change. Try again in a moment." });
  };

  /** Runs one write and answers for it; `done(response)` sends the success reply. */
  async function send(res, uid, method, path, body, done) {
    let r;
    try { r = await googleSend(uid, method, path, body); } catch { return failed(res, 'network or token refresh'); }
    if (r.needsWrite) return res.status(409).json({ needsWrite: true, error: 'Reconnect your calendar to make changes' });
    if (r.reconnect) return res.status(409).json({ reconnect: true, error: 'Reconnect your calendar' });
    if (r.status === 404 || r.status === 410) return res.status(404).json({ error: 'Event not found' });
    if (!r.ok) return failed(res, r.status);
    return done(r);
  }

  const idOf = async (r) => ({ id: (await r.json().catch(() => null))?.id ?? null });

  /** The live event for a valid :id (fresh from Google), or the reply already sent. */
  async function load(req, res, { organiser } = {}) {
    if (!(await calendarReady())) return notFound(res), null;
    const id = String(req.params?.id ?? '');
    if (!ID_RE.test(id)) return notFound(res), null;
    let got;
    try { got = await fetchEvent(req.user.id, id); } catch { return failed(res, 'event fetch'), null; }
    if (got.reconnect) return res.status(409).json({ reconnect: true, error: 'Reconnect your calendar' }), null;
    if (got.missing) return res.status(404).json({ error: 'Event not found' }), null;
    if (organiser && got.event.organizer?.self !== true) {
      return res.status(403).json({ error: 'Only the organiser can change this meeting' }), null;
    }
    return { id, event: got.event, path: `${EVENTS}/${encodeURIComponent(id)}?sendUpdates=all` };
  }

  app.post('/api/calendar/events', requireUser, needsPerson, wrap(async (req, res) => {
    if (!(await calendarReady())) return notFound(res);
    const v = eventBody(req.body, zoneOf(req.user), { uuid });
    if (v.error) return res.status(400).json({ error: v.error });
    const q = 'conferenceData' in v.body ? 'sendUpdates=all&conferenceDataVersion=1' : 'sendUpdates=all';
    return send(res, req.user.id, 'POST', `${EVENTS}?${q}`, v.body, async (r) => res.status(201).json(await idOf(r)));
  }));

  app.patch('/api/calendar/events/:id', requireUser, needsPerson, wrap(async (req, res) => {
    // Validate before the fetch so bad input costs no Google call; again after, with the guest list.
    if (!(await calendarReady())) return notFound(res);
    const pre = eventBody(req.body, zoneOf(req.user), { partial: true });
    if (pre.error) return res.status(400).json({ error: pre.error });
    const ev = await load(req, res, { organiser: true });
    if (!ev) return;
    const v = eventBody(req.body, zoneOf(req.user), { partial: true, existing: ev.event, uuid });
    if (v.error) return res.status(400).json({ error: v.error });
    const path = 'conferenceData' in v.body ? `${ev.path}&conferenceDataVersion=1` : ev.path;
    return send(res, req.user.id, 'PATCH', path, v.body, async (r) => res.json(await idOf(r)));
  }));

  app.delete('/api/calendar/events/:id', requireUser, needsPerson, wrap(async (req, res) => {
    const ev = await load(req, res, { organiser: true });
    if (!ev) return;
    return send(res, req.user.id, 'DELETE', ev.path, undefined, () => res.status(204).end());
  }));

  app.post('/api/calendar/events/:id/respond', requireUser, needsPerson, wrap(async (req, res) => {
    if (!(await calendarReady())) return notFound(res);
    const response = req.body?.response;
    if (!RESPONSES.includes(response)) return res.status(400).json({ error: 'Response must be accepted, tentative or declined.' });
    const ev = await load(req, res);
    if (!ev) return;
    const me = (Array.isArray(ev.event.attendees) ? ev.event.attendees : []).find((a) => a?.self);
    if (!me?.email) return res.status(409).json({ error: "You're not invited to this one" });
    // Only your own entry: attendeesOmitted keeps a guest added meanwhile from being dropped.
    const body = { attendeesOmitted: true, attendees: [{ email: me.email, responseStatus: response }] };
    return send(res, req.user.id, 'PATCH', ev.path, body, async (r) => res.json(await idOf(r)));
  }));
}
