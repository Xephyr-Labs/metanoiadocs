export interface CalendarAttendee { email: string; name: string; userId: string | null; self: boolean }
export interface CalendarEvent {
  id: string; title: string; start: string | null; end: string | null; allDay: boolean;
  meetLink: string | null; attendees: CalendarAttendee[]; notesDocId: string | null;
}
export interface CalendarEvents { connected: boolean; reconnect?: boolean; events: CalendarEvent[] }

/** Today's (or the next `days`) meetings; a failure reads as "not connected" so the UI just hides. */
export async function fetchEvents(days = 1): Promise<CalendarEvents> {
  try {
    const res = await fetch(`/api/calendar/events?days=${days}`, { credentials: 'include' });
    if (!res.ok) return { connected: false, events: [] };
    return await res.json();
  } catch {
    return { connected: false, events: [] };
  }
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
