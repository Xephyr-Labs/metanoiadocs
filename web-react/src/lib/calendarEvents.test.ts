import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  fetchEvents, fetchEventsRange, meetingsView, otherAttendees, type CalendarEvent,
  createMeeting, updateMeeting, cancelMeeting, respondToMeeting, CalendarWriteError, linkParts, calendarPageView,
} from './calendarEvents';

afterEach(() => vi.unstubAllGlobals());

describe('calendarEvents', () => {
  it('fetches with the day count', async () => {
    const f = vi.fn(async () => ({ ok: true, json: async () => ({ connected: true, events: [] }) }));
    vi.stubGlobal('fetch', f);
    expect(await fetchEvents(3)).toEqual({ connected: true, events: [] });
    expect(f).toHaveBeenCalledWith('/api/calendar/events?days=3', { credentials: 'include' });
  });
  it('fetchEventsRange sends from/to, and declined=1 only when asked', async () => {
    const f = vi.fn(async (_u: string) => ({ ok: true, json: async () => ({ connected: true, events: [] }) }));
    vi.stubGlobal('fetch', f);
    expect(await fetchEventsRange('2026-10-26', '2026-11-02')).toEqual({ connected: true, events: [] });
    expect(f).toHaveBeenLastCalledWith('/api/calendar/events?from=2026-10-26&to=2026-11-02', { credentials: 'include' });
    await fetchEventsRange('2026-10-26', '2026-11-02', { declined: true });
    expect(f).toHaveBeenLastCalledWith('/api/calendar/events?from=2026-10-26&to=2026-11-02&declined=1', { credentials: 'include' });
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 400 }));
    expect(await fetchEventsRange('2026-10-26', '2026-10-26')).toEqual({ error: true, events: [] });
  });
  it('a failure is an error that leaves connected to the status', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 502 }));
    expect(await fetchEvents()).toEqual({ error: true, events: [] });
    vi.stubGlobal('fetch', async () => { throw new Error('x'); });
    expect(await fetchEvents()).toEqual({ error: true, events: [] });
  });
  it('meetingsView: hidden, connect, reconnect, error, list', () => {
    const st = (connected: boolean) => ({ available: true, connected, email: null });
    expect(meetingsView(null, null)).toBe('hidden');
    expect(meetingsView({ available: false, connected: false, email: null }, null)).toBe('hidden');
    expect(meetingsView(st(false), { connected: false, events: [] })).toBe('connect');
    expect(meetingsView(st(true), { connected: true, reconnect: true, events: [] })).toBe('reconnect');
    // A Google error or a failed fetch never reads as "Connect your calendar" while Settings says Connected.
    expect(meetingsView(st(true), { connected: true, error: true, events: [] })).toBe('error');
    expect(meetingsView(st(true), { error: true, events: [] })).toBe('error');
    expect(meetingsView(st(false), { error: true, events: [] })).toBe('connect');
    expect(meetingsView(st(true), null)).toBe('loading');
    expect(meetingsView(st(true), { connected: true, events: [] })).toBe('list');
  });
  it('otherAttendees drops self', () => {
    const e = { attendees: [{ email: 'a', name: '', userId: null, self: true, response: null }, { email: 'b', name: '', userId: null, self: false, response: 'accepted' }] } as CalendarEvent;
    expect(otherAttendees(e).map((a) => a.email)).toEqual(['b']);
  });
});

import { meetingLabel, meetingTime, nextMeeting, orderMeetings, safeMeetLink, startNotes } from './calendarEvents';

const ev = (o: Partial<CalendarEvent>): CalendarEvent => ({
  id: 'x', title: 't', start: null, end: null, allDay: false, meetLink: null, attendees: [], notesDocId: null,
  description: '', location: '', organizerSelf: false, myResponse: null, recurringEventId: null, htmlLink: null, ...o,
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
  it('nextMeeting is the first future timed event', () => {
    expect(nextMeeting([c, a, d, b], now)?.id).toBe('b');
    expect(nextMeeting([a, d], now)).toBeUndefined();
  });
  it('safeMeetLink allows only http(s)', () => {
    expect(safeMeetLink('https://meet.google.com/x')).toBe('https://meet.google.com/x');
    expect(safeMeetLink('javascript:alert(1)')).toBeNull();
    expect(safeMeetLink('data:text/html,x')).toBeNull();
    expect(safeMeetLink(null)).toBeNull();
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
    expect(JSON.parse((f.mock.calls[0][1] as { body: string }).body)).toEqual({ spaceId: 's1' });
  });
  it('startNotes throws the server error', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 409, json: async () => ({ error: 'Reconnect' }) }));
    await expect(startNotes('e')).rejects.toThrow('Reconnect');
  });
});

describe('calendar writes', () => {
  const reply = (status: number, body: unknown) => vi.fn(async (_u: string, _o?: RequestInit) => ({
    ok: status < 300, status, json: async () => body,
  }));
  const body = { title: 'Sync', start: '2026-11-02T10:00:00+06:00', end: '2026-11-02T11:00:00+06:00', allDay: false, attendees: ['a@x.com'] };

  it('createMeeting POSTs the body as JSON', async () => {
    const f = reply(201, { id: 'n1' });
    vi.stubGlobal('fetch', f);
    expect(await createMeeting(body)).toEqual({ id: 'n1' });
    const [url, o] = f.mock.calls[0];
    expect(url).toBe('/api/calendar/events');
    expect(o).toMatchObject({ method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' } });
    expect(JSON.parse(o!.body as string)).toEqual(body);
  });
  it('updateMeeting PATCHes the encoded id with only the given fields', async () => {
    const f = reply(200, { id: 'a_1' });
    vi.stubGlobal('fetch', f);
    await updateMeeting('a/1', { title: 'New' });
    expect(f.mock.calls[0][0]).toBe('/api/calendar/events/a%2F1');
    expect(f.mock.calls[0][1]!.method).toBe('PATCH');
    expect(JSON.parse(f.mock.calls[0][1]!.body as string)).toEqual({ title: 'New' });
  });
  it('cancelMeeting DELETEs with no body and accepts a 204', async () => {
    const f = vi.fn(async (_u: string, _o?: RequestInit) => ({ ok: true, status: 204, json: async () => { throw new Error('no body'); } }));
    vi.stubGlobal('fetch', f);
    await expect(cancelMeeting('abc_20261102T150000Z')).resolves.toBeUndefined();
    expect(f.mock.calls[0][0]).toBe('/api/calendar/events/abc_20261102T150000Z');
    expect(f.mock.calls[0][1]).toMatchObject({ method: 'DELETE', credentials: 'include' });
    expect(f.mock.calls[0][1]!.body).toBeUndefined();
  });
  it('respondToMeeting POSTs the answer to /respond', async () => {
    const f = reply(200, { id: 'abc' });
    vi.stubGlobal('fetch', f);
    await respondToMeeting('abc', 'tentative');
    expect(f.mock.calls[0][0]).toBe('/api/calendar/events/abc/respond');
    expect(f.mock.calls[0][1]!.method).toBe('POST');
    expect(JSON.parse(f.mock.calls[0][1]!.body as string)).toEqual({ response: 'tentative' });
  });
  it('failures throw the server message with needsWrite / reconnect flags', async () => {
    vi.stubGlobal('fetch', reply(409, { needsWrite: true, error: 'Reconnect your calendar to make changes' }));
    const e = await createMeeting(body).catch((x) => x);
    expect(e).toBeInstanceOf(CalendarWriteError);
    expect([e.message, e.needsWrite, e.reconnect, e.status]).toEqual(['Reconnect your calendar to make changes', true, false, 409]);
    vi.stubGlobal('fetch', reply(409, { reconnect: true }));
    expect((await cancelMeeting('a').catch((x) => x)).reconnect).toBe(true);
    vi.stubGlobal('fetch', async () => { throw new Error('offline'); });
    const n = await respondToMeeting('a', 'accepted').catch((x) => x);
    expect(n).toBeInstanceOf(CalendarWriteError);
    expect(n.status).toBe(0);
  });
});

describe('linkParts', () => {
  it('links http(s) only, without trailing punctuation', () => {
    expect(linkParts('Doc: https://x.test/a?b=1. Call javascript:alert(1) or (http://y.test)')).toEqual([
      { text: 'Doc: ' }, { text: 'https://x.test/a?b=1', href: 'https://x.test/a?b=1' },
      { text: '. Call javascript:alert(1) or (' }, { text: 'http://y.test', href: 'http://y.test' }, { text: ')' },
    ]);
    expect(linkParts('')).toEqual([]);
  });
});

describe('calendarPageView', () => {
  const st = { available: true, connected: true, email: null };
  it('a failed status ask is an error, a pending one is loading', () => {
    expect(calendarPageView('failed', null)).toBe('error');
    expect(calendarPageView(null, null)).toBe('loading');
  });
  it('otherwise reads like the Home card', () => {
    expect(calendarPageView({ ...st, available: false }, null)).toBe('hidden');
    expect(calendarPageView(st, null)).toBe('loading');
    expect(calendarPageView(st, { connected: true, events: [] })).toBe('list');
    expect(calendarPageView(st, { error: true, events: [] })).toBe('error');
  });
});
