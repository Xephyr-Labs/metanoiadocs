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
