import { describe, expect, it, vi, afterEach } from 'vitest';
import { fetchEvents, otherAttendees, type CalendarEvent } from './calendarEvents';

afterEach(() => vi.unstubAllGlobals());

describe('calendarEvents', () => {
  it('fetches with the day count', async () => {
    const f = vi.fn(async () => ({ ok: true, json: async () => ({ connected: true, events: [] }) }));
    vi.stubGlobal('fetch', f);
    expect(await fetchEvents(3)).toEqual({ connected: true, events: [] });
    expect(f).toHaveBeenCalledWith('/api/calendar/events?days=3', { credentials: 'include' });
  });
  it('degrades to not connected on failure', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: false }));
    expect(await fetchEvents()).toEqual({ connected: false, events: [] });
    vi.stubGlobal('fetch', async () => { throw new Error('x'); });
    expect(await fetchEvents()).toEqual({ connected: false, events: [] });
  });
  it('otherAttendees drops self', () => {
    const e = { attendees: [{ email: 'a', name: '', userId: null, self: true }, { email: 'b', name: '', userId: null, self: false }] } as CalendarEvent;
    expect(otherAttendees(e).map((a) => a.email)).toEqual(['b']);
  });
});

import { meetingLabel, meetingTime, orderMeetings, startNotes } from './calendarEvents';

const ev = (o: Partial<CalendarEvent>): CalendarEvent => ({
  id: 'x', title: 't', start: null, end: null, allDay: false, meetLink: null, attendees: [], notesDocId: null, ...o,
});

describe('meeting helpers', () => {
  const now = new Date('2026-10-28T10:30:00Z').getTime();
  const a = ev({ id: 'a', start: '2026-10-28T10:00:00Z', end: '2026-10-28T11:00:00Z' });
  const b = ev({ id: 'b', start: '2026-10-28T12:00:00Z', end: '2026-10-28T13:00:00Z' });
  const c = ev({ id: 'c', start: '2026-10-28T14:00:00Z', end: '2026-10-28T15:00:00Z' });
  const d = ev({ id: 'd', allDay: true, start: '2026-10-28', end: '2026-10-29' });
  it('orders all-day first, then by start', () => {
    expect(orderMeetings([c, a, d, b]).map((e) => e.id)).toEqual(['d', 'a', 'b', 'c']);
  });
  it('labels now and only the first future one as next', () => {
    expect(meetingLabel(a, now, b)).toBe('Now');
    expect(meetingLabel(b, now, b)).toBe('Next');
    expect(meetingLabel(c, now, b)).toBeNull();
    expect(meetingLabel(d, now, b)).toBeNull();
  });
  it('picks the next as the first future timed event', () => {
    const list = orderMeetings([c, a, d, b]);
    expect(list.find((e) => !e.allDay && Date.parse(e.start!) > now)?.id).toBe('b');
  });
  it('formats time in the given zone, and all-day as such', () => {
    expect(meetingTime(a, 'en-US', 'UTC')).toBe('10:00 AM – 11:00 AM');
    expect(meetingTime(d, 'en-US', 'UTC')).toBe('All day');
  });
  it('startNotes posts the space', async () => {
    const f = vi.fn(async (_u: string, _o?: unknown) => ({ ok: true, json: async () => ({ docId: 'd1', created: true }) }));
    vi.stubGlobal('fetch', f);
    expect(await startNotes('e/1', 's1')).toEqual({ docId: 'd1', created: true });
    expect(f.mock.calls[0][0]).toBe('/api/calendar/events/e%2F1/notes');
  });
  it('startNotes throws the server error', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 409, json: async () => ({ error: 'Reconnect' }) }));
    await expect(startNotes('e')).rejects.toThrow('Reconnect');
  });
});
