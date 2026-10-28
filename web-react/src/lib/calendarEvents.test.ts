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
  description: '', location: '', hasMeet: false, organizerSelf: false, myResponse: null, recurringEventId: null, htmlLink: null, ...o,
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

import { meetingForm, meetingRequest, type MeetingForm } from './calendarEvents';

describe('meetingRequest', () => {
  const base: MeetingForm = {
    title: ' Planning ', allDay: false, date: '2026-11-02', endDate: '2026-11-02', start: '10:00', end: '10:30',
    attendees: [], description: '', meet: false,
  };
  const zone = 'America/New_York'; // not the test runner's zone

  it('timed: instants for the profile zone, across a DST change', () => {
    // Nov 2 2026 is after the US fall-back (Nov 1): New York is UTC-5.
    expect(meetingRequest(base, zone)).toEqual({ body: {
      title: 'Planning', allDay: false, start: '2026-11-02T15:00:00.000Z', end: '2026-11-02T15:30:00.000Z', attendees: [],
    } });
    // Oct 30 is still UTC-4.
    const r = meetingRequest({ ...base, date: '2026-10-30' }, zone);
    expect('body' in r && r.body.start).toBe('2026-10-30T14:00:00.000Z');
    // Dhaka, no DST, UTC+6.
    const d = meetingRequest(base, 'Asia/Dhaka');
    expect('body' in d && d.body.start).toBe('2026-11-02T04:00:00.000Z');
  });
  it('a timed meeting may end on a later day, up to 14 days on', () => {
    const r = meetingRequest({ ...base, start: '23:00', end: '00:00', endDate: '2026-11-03' }, zone);
    expect('body' in r && r.body.end).toBe('2026-11-03T05:00:00.000Z');
    expect(meetingRequest({ ...base, start: '23:00', end: '00:00' }, zone)).toHaveProperty('errors.end');
    expect(meetingRequest({ ...base, endDate: '2026-11-17' }, zone)).toEqual({ errors: { end: 'A meeting can last at most 14 days.' } });
  });
  it('all day: dates with an exclusive end', () => {
    expect(meetingRequest({ ...base, allDay: true }, zone)).toMatchObject({ body: { allDay: true, start: '2026-11-02', end: '2026-11-03' } });
    expect(meetingRequest({ ...base, allDay: true, endDate: '2026-11-04' }, zone)).toMatchObject({ body: { start: '2026-11-02', end: '2026-11-05' } });
  });
  it('attendees lower-cased and deduped; description and Meet only when given', () => {
    const r = meetingRequest({ ...base, attendees: ['Ann@X.io', ' ann@x.io', 'bo@y.org'], description: 'Agenda', meet: true }, zone);
    expect(r).toMatchObject({ body: { attendees: ['ann@x.io', 'bo@y.org'], description: 'Agenda', meet: true } });
  });
  it('field errors', () => {
    expect(meetingRequest({ ...base, title: '  ' }, zone)).toEqual({ errors: { title: 'Give the meeting a title.' } });
    expect(meetingRequest({ ...base, end: '10:00' }, zone)).toEqual({ errors: { end: 'The end must be after the start.' } });
    expect(meetingRequest({ ...base, end: '09:00' }, zone)).toHaveProperty('errors.end');
    expect(meetingRequest({ ...base, allDay: true, endDate: '2026-11-01' }, zone)).toHaveProperty('errors.end');
    expect(meetingRequest({ ...base, allDay: true, endDate: '2026-11-20' }, zone)).toEqual({ errors: { end: 'A meeting can last at most 14 days.' } });
    expect(meetingRequest({ ...base, attendees: ['ok@x.io', 'nope'] }, zone)).toEqual({ errors: { attendees: 'Not an email address: nope' } });
    expect(meetingRequest({ ...base, date: '' }, zone)).toHaveProperty('errors.date');
  });

  describe('edit', () => {
    const original = ev({
      id: 'e1', title: 'Planning', start: '2026-11-02T15:00:00Z', end: '2026-11-02T15:30:00Z', organizerSelf: true,
      description: 'Line one\nLine two', meetLink: 'https://meet.google.com/abc', hasMeet: true,
      attendees: [
        { email: 'me@x.io', name: 'Me', userId: 'u0', self: true, response: 'accepted' },
        { email: 'ann@x.io', name: 'Ann', userId: 'u1', self: false, response: 'accepted' },
        { email: 'room-1@resource.calendar.google.com', name: 'Room 1', userId: null, self: false, response: 'accepted' },
      ],
    });
    it('the form an event opens with: your zone, guests other than you, Meet on', () => {
      expect(meetingForm(original, zone)).toEqual({
        title: 'Planning', allDay: false, date: '2026-11-02', endDate: '2026-11-02', start: '10:00', end: '10:30',
        attendees: ['ann@x.io', 'room-1@resource.calendar.google.com'], description: 'Line one\nLine two', meet: true,
      });
      const allDay = ev({ allDay: true, start: '2026-11-02', end: '2026-11-04' });
      expect(meetingForm(allDay, zone)).toMatchObject({ allDay: true, date: '2026-11-02', endDate: '2026-11-03' });
    });
    it('sends only what changed; untouched description and times are left out', () => {
      const f = meetingForm(original, zone);
      expect(meetingRequest(f, zone, original)).toEqual({ body: {} });
      expect(meetingRequest({ ...f, title: 'Planning v2' }, zone, original)).toEqual({ body: { title: 'Planning v2' } });
      expect(meetingRequest({ ...f, end: '11:00' }, zone, original)).toEqual({ body: {
        allDay: false, start: '2026-11-02T15:00:00.000Z', end: '2026-11-02T16:00:00.000Z',
      } });
      expect(meetingRequest({ ...f, attendees: [...f.attendees, 'bo@y.org'] }, zone, original)).toEqual({ body: {
        attendees: ['ann@x.io', 'room-1@resource.calendar.google.com', 'bo@y.org'],
      } });
      expect(meetingRequest({ ...f, meet: false }, zone, original)).toEqual({ body: { meet: false } });
      expect(meetingRequest({ ...f, description: '' }, zone, original)).toEqual({ body: { description: '' } });
    });
    it('a meeting that crosses midnight keeps its times when only the title changes, and its times can be edited', () => {
      const late = ev({ title: 'Late', start: '2026-11-02T03:00:00Z', end: '2026-11-02T06:00:00Z' }); // 22:00 → 01:00 New York
      const f = meetingForm(late, zone);
      expect(f).toMatchObject({ date: '2026-11-01', endDate: '2026-11-02', start: '22:00', end: '01:00' });
      expect(meetingRequest({ ...f, title: 'Later' }, zone, late)).toEqual({ body: { title: 'Later' } });
      expect(meetingRequest({ ...f, end: '02:00' }, zone, late)).toEqual({ body: {
        allDay: false, start: '2026-11-02T03:00:00.000Z', end: '2026-11-02T07:00:00.000Z',
      } });
    });
    it('a timed meeting over two days round-trips', () => {
      const two = ev({ title: 'Offsite', start: '2026-11-02T15:00:00Z', end: '2026-11-04T15:00:00Z' });
      const f = meetingForm(two, zone);
      expect(f).toMatchObject({ date: '2026-11-02', endDate: '2026-11-04', start: '10:00', end: '10:00' });
      expect(meetingRequest(f, zone, two)).toEqual({ body: {} });
      expect(meetingRequest({ ...f, start: '09:00' }, zone, two)).toEqual({ body: {
        allDay: false, start: '2026-11-02T14:00:00.000Z', end: '2026-11-04T15:00:00.000Z',
      } });
    });
    it('another app\'s video link is not a Meet: nothing to remove', () => {
      const zoom = ev({ title: 'Zoom call', start: '2026-11-02T15:00:00Z', end: '2026-11-02T16:00:00Z', meetLink: 'https://zoom.us/j/1', hasMeet: false });
      const f = meetingForm(zoom, zone);
      expect(f.meet).toBe(false);
      expect(meetingRequest({ ...f, title: 'Zoom' }, zone, zoom)).toEqual({ body: { title: 'Zoom' } });
    });
  });
});

import { canAnswer, cancelPrompt } from './calendarEvents';

describe('organiser controls', () => {
  const guest = { email: 'g@x', name: 'G', userId: null, self: false, response: 'needsAction' as const };
  it('the organiser is never asked to answer their own meeting', () => {
    expect(canAnswer(ev({ myResponse: 'accepted', organizerSelf: true }))).toBe(false);
    expect(canAnswer(ev({ myResponse: 'needsAction' }))).toBe(true);
    expect(canAnswer(ev({ myResponse: null }))).toBe(false);
  });
  it('the cancel prompt says what it does', () => {
    expect(cancelPrompt(ev({ recurringEventId: 'r', attendees: [guest] }))).toBe('Cancel this occurrence for everyone?');
    expect(cancelPrompt(ev({ attendees: [{ ...guest, self: true }] }))).toBe('Delete this meeting?');
    expect(cancelPrompt(ev({ attendees: [guest] }))).toBe('Cancel this meeting for everyone?');
  });
});
