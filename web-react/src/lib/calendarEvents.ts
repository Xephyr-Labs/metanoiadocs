import type { CalendarStatus } from './calendar';
import { wall, wallInstant } from './calendarLayout';
import { addDays, daysBetween } from './gantt';

export type CalendarResponse = 'accepted' | 'tentative' | 'declined' | 'needsAction';
export interface CalendarAttendee { email: string; name: string; userId: string | null; self: boolean; response: CalendarResponse | null }
export interface CalendarEvent {
  id: string; title: string; start: string | null; end: string | null; allDay: boolean;
  meetLink: string | null; attendees: CalendarAttendee[]; notesDocId: string | null;
  /** Plain text (the server strips Google's HTML); render as text only. */
  description: string; location: string;
  /** A Google Meet the organiser may remove; `meetLink` without it is another app's video link. */
  hasMeet: boolean; organizerSelf: boolean; myResponse: CalendarResponse | null;
  recurringEventId: string | null; htmlLink: string | null;
}
/** `connected` is absent when the fetch itself failed: the status decides then. */
export interface CalendarEvents { connected?: boolean; reconnect?: boolean; error?: boolean; events: CalendarEvent[] }

async function getEvents(query: string): Promise<CalendarEvents> {
  try {
    const res = await fetch(`/api/calendar/events?${query}`, { credentials: 'include' });
    if (!res.ok) return { error: true, events: [] };
    return await res.json();
  } catch {
    return { error: true, events: [] };
  }
}

/** Today's (or the next `days`) meetings; a failure is an error, not "not connected". */
export const fetchEvents = (days = 1): Promise<CalendarEvents> => getEvents(`days=${days}`);

/** Events from `from` up to (not including) `to`, YYYY-MM-DD in the person's zone, 1..42 days. */
export const fetchEventsRange = (from: string, to: string, { declined = false } = {}): Promise<CalendarEvents> =>
  getEvents(`from=${from}&to=${to}${declined ? '&declined=1' : ''}`);

/** What the Home card shows for this status and events answer. */
export function meetingsView(status: CalendarStatus | null, data: CalendarEvents | null):
  'hidden' | 'connect' | 'loading' | 'reconnect' | 'error' | 'list' {
  if (!status?.available) return 'hidden';
  if (data?.reconnect) return 'reconnect';
  if (!(data?.connected ?? status.connected)) return 'connect';
  if (!data) return 'loading';
  return data.error ? 'error' : 'list';
}

/** The Calendar page's state: like the Home card, but a status ask that failed is an error
 *  (the page was opened on purpose) and one still on its way is loading, not hidden. */
export function calendarPageView(status: CalendarStatus | null | 'failed', data: CalendarEvents | null):
  ReturnType<typeof meetingsView> {
  if (status === 'failed') return 'error';
  if (!status) return 'loading';
  return meetingsView(status, data);
}

/** Attendees other than you, for a "with ..." line. */
export const otherAttendees = (e: CalendarEvent): CalendarAttendee[] => e.attendees.filter((a) => !a.self);

const startMs = (e: CalendarEvent) => (e.start ? Date.parse(e.start) : 0);

/** All-day first, then by start time. */
export function orderMeetings(events: CalendarEvent[]): CalendarEvent[] {
  return [...events].sort((a, b) => Number(b.allDay) - Number(a.allDay) || startMs(a) - startMs(b));
}

/** The first timed meeting that has not started yet. */
export const nextMeeting = (events: CalendarEvent[], now: number): CalendarEvent | undefined =>
  orderMeetings(events).find((e) => !e.allDay && startMs(e) > now);

/** "Now" while it is running, "Next" for the one `next` points at. */
export function meetingLabel(e: CalendarEvent, now: number, next?: CalendarEvent): 'Now' | 'Next' | null {
  if (e.allDay || !e.start || !e.end) return null;
  if (startMs(e) <= now && now < Date.parse(e.end)) return 'Now';
  return next && e.id === next.id ? 'Next' : null;
}

/** "10:00 AM – 11:00 AM" in the viewer's locale and zone, or "All day". */
export function meetingTime(e: CalendarEvent, locale?: string, timeZone?: string): string {
  if (e.allDay || !e.start) return 'All day';
  const f = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZone });
  return e.end ? `${f.format(new Date(e.start))} – ${f.format(new Date(e.end))}` : f.format(new Date(e.start));
}

/** Open (or create) the private notes page for a meeting. */
export async function startNotes(eventId: string, spaceId?: string): Promise<{ docId: string; created: boolean }> {
  const res = await fetch(`/api/calendar/events/${encodeURIComponent(eventId)}/notes`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(spaceId ? { spaceId } : {}),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `Could not start notes (${res.status})`);
  return data;
}

/** Only http(s) links may reach an href; an invite sender controls this value. */
export const safeMeetLink = (url: string | null | undefined): string | null =>
  url && /^https?:\/\//i.test(url) ? url : null;

/** What the create/edit routes take; on an edit every field is optional and absent ones stay as they are. */
export interface MeetingBody {
  title: string; start: string; end: string; allDay: boolean; attendees: string[];
  description?: string; meet?: boolean;
}

/** A refused write: `needsWrite` → reconnect with write access; `reconnect` → connect again; status 0 = offline. */
export class CalendarWriteError extends Error {
  constructor(message: string, readonly status: number, readonly needsWrite = false, readonly reconnect = false) {
    super(message);
  }
}

async function write<T = { id: string | null }>(path: string, method: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/calendar/events${path}`, {
      method,
      credentials: 'include',
      ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    });
  } catch {
    throw new CalendarWriteError("Couldn't reach the server. Check your connection.", 0);
  }
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    throw new CalendarWriteError(data?.error || `Could not save the meeting (${res.status})`, res.status, !!data?.needsWrite, !!data?.reconnect);
  }
  return data as T;
}

const one = (id: string) => `/${encodeURIComponent(id)}`;

export const createMeeting = (body: MeetingBody): Promise<{ id: string | null }> => write('', 'POST', body);
export const updateMeeting = (id: string, body: Partial<MeetingBody>): Promise<{ id: string | null }> => write(one(id), 'PATCH', body);
export const cancelMeeting = async (id: string): Promise<void> => { await write(one(id), 'DELETE'); };
export const respondToMeeting = (id: string, response: 'accepted' | 'tentative' | 'declined'): Promise<{ id: string | null }> =>
  write(`${one(id)}/respond`, 'POST', { response });

/** A description as text and http(s) links, in order; the links go to an href, the rest is shown as text. */
export function linkParts(text: string): { text: string; href?: string }[] {
  return text.split(/(https?:\/\/[^\s<>"]*[^\s<>".,;:!?)\]'])/i).filter(Boolean)
    .map((t) => (/^https?:\/\//i.test(t) ? { text: t, href: t } : { text: t }));
}

/** What the meeting dialog holds. Times are wall clock in the person's profile zone. */
export interface MeetingForm {
  title: string; allDay: boolean;
  /** The day it starts and the day it ends (all day: the last day, inclusive). */
  date: string; endDate: string;
  /** 'HH:MM' on `date` and on `endDate`. */
  start: string; end: string;
  /** Guests other than you, by email: teammates picked and addresses typed alike. */
  attendees: string[]; description: string; meet: boolean;
}
export type MeetingErrors = Partial<Record<'title' | 'date' | 'end' | 'attendees' | 'description', string>>;

// The server's rule, so a bad address is caught at the chip, not after a round trip.
const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:".]+(\.[^\s@<>()[\]\\,;:".]+)+$/;
export const isEmail = (s: string): boolean => s.length <= 254 && EMAIL_RE.test(s.trim().toLowerCase());

const hhmm = (min: number) => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const minutesOf = (t: string) => (/^\d{2}:\d{2}$/.test(t) ? Number(t.slice(0, 2)) * 60 + Number(t.slice(3)) : NaN);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A new meeting: at the slot clicked or dragged (30 minutes by default), or the next half hour. */
export function newMeetingForm(slot: { day: string; minutes: number | null; endMinutes?: number } | null, zone: string, now = Date.now()): MeetingForm {
  const w = wall(now, zone);
  const day = slot?.day ?? w.day;
  const at = slot ? slot.minutes : Math.min(23 * 60 + 30, Math.ceil((w.minutes + 1) / 30) * 30);
  const start = at ?? 9 * 60;
  const end = slot?.endMinutes ?? start + 30;
  return {
    title: '', allDay: at === null, date: day, endDate: end >= 24 * 60 ? addDays(day, 1) : day, start: hhmm(start), end: hhmm(end),
    attendees: [], description: '', meet: false,
  };
}

/** An existing meeting as the dialog opens on it. */
export function meetingForm(e: CalendarEvent, zone: string): MeetingForm {
  const at = (s: string | null) => wall(s ? Date.parse(s) : 0, zone);
  const day = e.allDay ? (e.start ?? '').slice(0, 10) : at(e.start).day;
  return {
    title: e.title, allDay: e.allDay, date: day,
    endDate: e.allDay ? (e.end ? addDays(e.end.slice(0, 10), -1) : day) : e.end ? at(e.end).day : day,
    start: e.allDay ? '09:00' : hhmm(at(e.start).minutes), end: e.allDay ? '09:30' : hhmm(at(e.end).minutes),
    attendees: e.attendees.filter((a) => !a.self && a.email).map((a) => a.email.toLowerCase()),
    description: e.description, meet: !!e.hasMeet,
  };
}

const sameTimes = (a: MeetingForm, b: MeetingForm) => a.allDay === b.allDay && a.date === b.date && a.endDate === b.endDate
  && (a.allDay || (a.start === b.start && a.end === b.end));

/**
 * The form → what the create (no `original`) or edit route takes, or the errors to show by field.
 * An edit sends only what changed: an untouched description is left out so Google's formatting
 * survives, and start, end and allDay go together or not at all.
 */
export function meetingRequest(f: MeetingForm, zone: string, original?: CalendarEvent):
  { body: Partial<MeetingBody> } | { errors: MeetingErrors } {
  const errors: MeetingErrors = {};
  const was = original && meetingForm(original, zone);
  const body: Partial<MeetingBody> = {};

  const title = f.title.trim();
  if (!title) errors.title = 'Give the meeting a title.';
  else if (title.length > 200) errors.title = 'Keep the title under 200 characters.';
  else if (title !== was?.title) body.title = title;

  if (!was || !sameTimes(f, was)) {
    if (!DATE.test(f.date)) errors.date = 'Pick a date.';
    else if (f.allDay) {
      const days = DATE.test(f.endDate) ? daysBetween(f.date, f.endDate) + 1 : NaN;
      if (!(days > 0)) errors.end = 'The end must be after the start.';
      else if (days > 14) errors.end = 'A meeting can last at most 14 days.';
      else Object.assign(body, { allDay: true, start: f.date, end: addDays(f.endDate, 1) });
    } else {
      const s = minutesOf(f.start);
      const e = minutesOf(f.end);
      const from = wallInstant(f.date, s, zone);
      const to = DATE.test(f.endDate) ? wallInstant(f.endDate, e, zone) : NaN;
      if (!(to > from)) errors.end = 'The end must be after the start.';
      else if (to - from > 14 * 86_400_000) errors.end = 'A meeting can last at most 14 days.';
      else Object.assign(body, { allDay: false, start: new Date(from).toISOString(), end: new Date(to).toISOString() });
    }
  }

  const list = [...new Set(f.attendees.map((a) => a.trim().toLowerCase()).filter(Boolean))];
  const bad = list.find((a) => !isEmail(a));
  if (bad) errors.attendees = `Not an email address: ${bad}`;
  else if (list.length > 50) errors.attendees = 'At most 50 guests.';
  else if (!was || list.length !== was.attendees.length || list.some((a) => !was.attendees.includes(a))) body.attendees = list;

  if (f.description.length > 5000) errors.description = 'Keep the description under 5000 characters.';
  else if (was ? f.description !== was.description : f.description.trim()) body.description = f.description;

  if (was ? f.meet !== was.meet : f.meet) body.meet = f.meet;

  return Object.keys(errors).length ? { errors } : { body };
}
