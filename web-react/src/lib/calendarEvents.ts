import type { CalendarStatus } from './calendar';

export type CalendarResponse = 'accepted' | 'tentative' | 'declined' | 'needsAction';
export interface CalendarAttendee { email: string; name: string; userId: string | null; self: boolean; response: CalendarResponse | null }
export interface CalendarEvent {
  id: string; title: string; start: string | null; end: string | null; allDay: boolean;
  meetLink: string | null; attendees: CalendarAttendee[]; notesDocId: string | null;
  /** Plain text (the server strips Google's HTML); render as text only. */
  description: string; location: string; organizerSelf: boolean; myResponse: CalendarResponse | null;
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
