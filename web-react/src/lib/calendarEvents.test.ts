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
