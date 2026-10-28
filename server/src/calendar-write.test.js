import test from 'node:test';
import assert from 'node:assert/strict';
import { registerCalendarWriteRoutes } from './calendar-write.js';

const ok = (body = { id: 'new1' }, status = 200) => ({ ok: status < 300, status, json: async () => body });

function harness({ event, ready = true, reply = () => ok() } = {}) {
  const routes = {};
  const sent = [];
  const fetched = [];
  const reg = (m) => (path, ...h) => { routes[`${m} ${path}`] = h[h.length - 1]; };
  const app = { post: reg('POST'), patch: reg('PATCH'), delete: reg('DELETE') };
  registerCalendarWriteRoutes(app, {
    requireUser: () => {}, needsPerson: () => {}, wrap: (fn) => fn,
    calendarReady: async () => ready,
    uuid: () => 'req-1',
    fetchEvent: async (uid, id) => {
      fetched.push(id);
      if (typeof event === 'function') return event(id);
      return event === undefined ? { missing: true } : { event };
    },
    googleSend: async (uid, method, path, body) => { sent.push({ uid, method, path, body }); return reply(method, path, body); },
  });
  const call = async (key, { id, body } = {}) => {
    let status = 200;
    let out;
    await routes[key](
      { params: id === undefined ? {} : { id }, user: { id: 'me', timezone: 'Asia/Dhaka' }, body },
      { status(s) { status = s; return this; }, json(v) { out = v; }, end() {} },
    );
    return { status, out };
  };
  return { call, sent, fetched };
}

const timed = { title: 'Sync', start: '2026-11-02T10:00:00+06:00', end: '2026-11-02T11:00:00+06:00', allDay: false, attendees: [] };
const P = '/calendar/v3/calendars/primary/events';

// ── create ────────────────────────────────────────────────────────────────

test('create: timed event → insert with sendUpdates=all, zone, trimmed title, deduped lower-cased attendees', async () => {
  const h = harness();
  const r = await h.call('POST /api/calendar/events', {
    body: { ...timed, title: '  Sync  ', attendees: ['Ana@Example.com', 'ana@example.com', 'bob@example.org'], description: 'hi' },
  });
  assert.equal(r.status, 201);
  assert.deepEqual(r.out, { id: 'new1' });
  assert.equal(h.sent.length, 1);
  const s = h.sent[0];
  assert.equal(s.method, 'POST');
  assert.equal(s.path, `${P}?sendUpdates=all`);
  assert.deepEqual(s.body, {
    summary: 'Sync',
    start: { dateTime: timed.start, timeZone: 'Asia/Dhaka' },
    end: { dateTime: timed.end, timeZone: 'Asia/Dhaka' },
    attendees: [{ email: 'ana@example.com' }, { email: 'bob@example.org' }],
    description: 'hi',
  });
});

test('create: all-day uses dates; meet asks for a Hangouts Meet conference', async () => {
  const h = harness();
  const r = await h.call('POST /api/calendar/events', {
    body: { title: 'Offsite', start: '2026-11-02', end: '2026-11-04', allDay: true, attendees: [], meet: true },
  });
  assert.equal(r.status, 201);
  const s = h.sent[0];
  assert.equal(s.path, `${P}?sendUpdates=all&conferenceDataVersion=1`);
  assert.deepEqual(s.body.start, { date: '2026-11-02' });
  assert.deepEqual(s.body.end, { date: '2026-11-04' });
  assert.deepEqual(s.body.conferenceData, { createRequest: { requestId: 'req-1', conferenceSolutionKey: { type: 'hangoutsMeet' } } });
  assert.ok(!('description' in s.body));
});

test('create: every validation rule → 400 and nothing sent', async () => {
  const bad = [
    { ...timed, title: '   ' },
    { ...timed, title: 'x'.repeat(201) },
    { ...timed, title: 7 },
    { ...timed, start: 'tomorrow' },
    { ...timed, start: '2026-11-02T10:00:00' }, // no offset: ambiguous
    { ...timed, end: timed.start },
    { ...timed, end: '2026-11-02T09:00:00+06:00' },
    { ...timed, end: '2026-11-16T10:00:01+06:00' }, // > 14 days
    { ...timed, allDay: true }, // date-times on an all-day event
    { ...timed, allDay: true, start: '2026-11-02', end: '2026-11-02' },
    { ...timed, allDay: true, start: '2026-02-30', end: '2026-03-02' },
    { ...timed, allDay: true, start: '2026-11-01', end: '2026-11-16' }, // 15 days
    { ...timed, attendees: ['not-an-email'] },
    { ...timed, attendees: ['a b@example.com'] },
    { ...timed, attendees: 'ana@example.com' },
    { ...timed, attendees: Array.from({ length: 51 }, (_, i) => `p${i}@example.com`) },
    { ...timed, description: 'x'.repeat(5001) },
    { ...timed, description: 5 },
    { ...timed, start: undefined },
  ];
  const h = harness();
  for (const body of bad) {
    const r = await h.call('POST /api/calendar/events', { body });
    assert.equal(r.status, 400, JSON.stringify(body).slice(0, 120));
    assert.ok(r.out.error);
  }
  assert.equal(h.sent.length, 0);
  // The edges hold: 200 chars, 50 attendees, exactly 14 days, 5000-char description.
  const edge = await h.call('POST /api/calendar/events', {
    body: { ...timed, title: 'x'.repeat(200), end: '2026-11-16T10:00:00+06:00', description: 'd'.repeat(5000),
      attendees: Array.from({ length: 50 }, (_, i) => `p${i}@example.com`) },
  });
  assert.equal(edge.status, 201);
});

test('create: needsWrite → 409 needsWrite; reconnect → 409 reconnect; Google failure → 502 without its text', async () => {
  const nw = harness({ reply: () => ({ needsWrite: true }) });
  const a = await nw.call('POST /api/calendar/events', { body: timed });
  assert.deepEqual([a.status, a.out], [409, { needsWrite: true, error: 'Reconnect your calendar to make changes' }]);
  const rc = harness({ reply: () => ({ reconnect: true }) });
  const b = await rc.call('POST /api/calendar/events', { body: timed });
  assert.equal(b.status, 409);
  assert.equal(b.out.reconnect, true);
  const errs = [];
  const orig = console.error;
  console.error = (...x) => errs.push(x);
  try {
    const g = harness({ reply: () => ok({ error: { message: 'SECRET google text' } }, 400) });
    const c = await g.call('POST /api/calendar/events', { body: timed });
    assert.equal(c.status, 502);
    assert.ok(!JSON.stringify(c.out).includes('SECRET'));
    assert.ok(errs.some((x) => x.includes(400)));
    const t = harness({ reply: () => { throw new Error('network'); } });
    assert.equal((await t.call('POST /api/calendar/events', { body: timed })).status, 502);
  } finally { console.error = orig; }
});

test('the whole thing 404s when the calendar is not set up', async () => {
  const h = harness({ ready: false, event: { organizer: { self: true } } });
  assert.equal((await h.call('POST /api/calendar/events', { body: timed })).status, 404);
  assert.equal((await h.call('PATCH /api/calendar/events/:id', { id: 'abc', body: { title: 'x' } })).status, 404);
  assert.equal((await h.call('DELETE /api/calendar/events/:id', { id: 'abc' })).status, 404);
  assert.equal((await h.call('POST /api/calendar/events/:id/respond', { id: 'abc', body: { response: 'accepted' } })).status, 404);
  assert.equal(h.sent.length + h.fetched.length, 0);
});

// ── edit / cancel ─────────────────────────────────────────────────────────

const mine = {
  id: 'abc_20261102T150000Z', organizer: { self: true },
  attendees: [{ email: 'me@x.com', self: true, organizer: true, responseStatus: 'accepted' }, { email: 'ana@x.com', responseStatus: 'tentative' }],
};

test('edit: patches only the fields given, on that instance id; description omitted unless in the body', async () => {
  const h = harness({ event: mine });
  const r = await h.call('PATCH /api/calendar/events/:id', { id: 'abc_20261102T150000Z', body: { title: 'New' } });
  assert.equal(r.status, 200);
  assert.deepEqual(h.fetched, ['abc_20261102T150000Z']);
  assert.equal(h.sent[0].method, 'PATCH');
  assert.equal(h.sent[0].path, `${P}/abc_20261102T150000Z?sendUpdates=all`);
  assert.deepEqual(h.sent[0].body, { summary: 'New' });
  await h.call('PATCH /api/calendar/events/:id', { id: 'abc_20261102T150000Z', body: { description: '' } });
  assert.deepEqual(h.sent[1].body, { description: '' });
});

test('edit: attendee list keeps existing answers and your own entry; times switch cleanly', async () => {
  const h = harness({ event: mine });
  await h.call('PATCH /api/calendar/events/:id', {
    id: 'abc', body: { attendees: ['ANA@x.com', 'new@x.com'], start: '2026-11-02', end: '2026-11-03', allDay: true },
  });
  const b = h.sent[0].body;
  assert.deepEqual(b.attendees, [mine.attendees[0], mine.attendees[1], { email: 'new@x.com' }]);
  assert.deepEqual(b.start, { date: '2026-11-02', dateTime: null, timeZone: null });
  await h.call('PATCH /api/calendar/events/:id', { id: 'abc', body: { attendees: [] } });
  assert.deepEqual(h.sent[1].body.attendees, [mine.attendees[0]]);
  await h.call('PATCH /api/calendar/events/:id', { id: 'abc', body: { start: timed.start, end: timed.end } });
  assert.deepEqual(h.sent[2].body.start, { dateTime: timed.start, timeZone: 'Asia/Dhaka', date: null });
  // meet on an edit: added when there is none, never a second one.
  await h.call('PATCH /api/calendar/events/:id', { id: 'abc', body: { meet: true } });
  assert.equal(h.sent[3].path, `${P}/abc?sendUpdates=all&conferenceDataVersion=1`);
  const withMeet = harness({ event: { ...mine, attendees: 'junk', conferenceData: { entryPoints: [] } } });
  assert.equal((await withMeet.call('PATCH /api/calendar/events/:id', { id: 'abc', body: { meet: true } })).status, 400);
  await withMeet.call('PATCH /api/calendar/events/:id', { id: 'abc', body: { attendees: ['a@x.com'] } });
  assert.deepEqual(withMeet.sent[0].body.attendees, [{ email: 'a@x.com' }]);
  // meet: false removes an existing Meet; absent leaves it alone; false with none is nothing to change.
  const r = await withMeet.call('PATCH /api/calendar/events/:id', { id: 'abc', body: { meet: false } });
  assert.equal(r.status, 200);
  assert.equal(withMeet.sent[1].path, `${P}/abc?sendUpdates=all&conferenceDataVersion=1`);
  assert.deepEqual(withMeet.sent[1].body, { conferenceData: null });
  assert.ok(!('conferenceData' in withMeet.sent[0].body));
  assert.equal(withMeet.sent[0].path, `${P}/abc?sendUpdates=all`);
  assert.equal((await h.call('PATCH /api/calendar/events/:id', { id: 'abc', body: { meet: false } })).status, 400);
  // meet: false on create is simply no Meet.
  await h.call('POST /api/calendar/events', { body: { ...timed, meet: false } });
  assert.ok(!('conferenceData' in h.sent.at(-1).body));
  assert.equal(h.sent.at(-1).path, `${P}?sendUpdates=all`);
});

test('edit: bad input → 400 (one time without the other, empty body, bad title)', async () => {
  const h = harness({ event: mine });
  for (const body of [{}, { start: timed.start }, { allDay: true }, { title: '' }, { attendees: ['x'] }, { description: 'x'.repeat(5001) }]) {
    assert.equal((await h.call('PATCH /api/calendar/events/:id', { id: 'abc', body })).status, 400, JSON.stringify(body));
  }
  assert.equal(h.sent.length, 0);
});

test('edit/cancel: not the organiser → 403 even with a forged body; missing → 404; bad id → 404', async () => {
  const theirs = { ...mine, organizer: { email: 'boss@x.com' } };
  const h = harness({ event: theirs });
  const forged = { title: 'mine now', organizer: { self: true }, organizerSelf: true };
  assert.equal((await h.call('PATCH /api/calendar/events/:id', { id: 'abc', body: forged })).status, 403);
  assert.equal((await h.call('DELETE /api/calendar/events/:id', { id: 'abc' })).status, 403);
  assert.equal(h.sent.length, 0);

  const gone = harness();
  assert.equal((await gone.call('PATCH /api/calendar/events/:id', { id: 'abc', body: { title: 'x' } })).status, 404);
  assert.equal((await gone.call('DELETE /api/calendar/events/:id', { id: 'abc' })).status, 404);

  const any = harness({ event: mine });
  for (const id of ['', '../x', 'a/b', 'a%2Fb', 'x'.repeat(1025)]) {
    assert.equal((await any.call('DELETE /api/calendar/events/:id', { id })).status, 404, id);
  }
  assert.equal(any.fetched.length + any.sent.length, 0);

  const rc = harness({ event: () => ({ reconnect: true }) });
  const r = await rc.call('DELETE /api/calendar/events/:id', { id: 'abc' });
  assert.deepEqual([r.status, r.out.reconnect], [409, true]);
});

test('cancel: organiser → events.delete with sendUpdates=all → 204', async () => {
  const h = harness({ event: mine, reply: () => ok(null, 204) });
  const r = await h.call('DELETE /api/calendar/events/:id', { id: 'abc_20261102T150000Z' });
  assert.equal(r.status, 204);
  assert.deepEqual(h.sent, [{ uid: 'me', method: 'DELETE', path: `${P}/abc_20261102T150000Z?sendUpdates=all`, body: undefined }]);
  const nw = harness({ event: mine, reply: () => ({ needsWrite: true }) });
  assert.equal((await nw.call('DELETE /api/calendar/events/:id', { id: 'abc' })).out.needsWrite, true);
});

// ── respond ───────────────────────────────────────────────────────────────

test('respond: sends only your answer (attendeesOmitted), on an instance id', async () => {
  const invite = {
    id: 'abc_20261102T150000Z', organizer: { email: 'boss@x.com' },
    attendees: [
      { email: 'boss@x.com', organizer: true, responseStatus: 'accepted' },
      { email: 'me@x.com', self: true, responseStatus: 'needsAction', comment: 'hi' },
      { email: 'ana@x.com', responseStatus: 'declined', optional: true },
    ],
  };
  const h = harness({ event: invite });
  const r = await h.call('POST /api/calendar/events/:id/respond', { id: 'abc_20261102T150000Z', body: { response: 'tentative' } });
  assert.equal(r.status, 200);
  assert.equal(h.sent[0].method, 'PATCH');
  assert.equal(h.sent[0].path, `${P}/abc_20261102T150000Z?sendUpdates=all`);
  // Only your own entry, with patch semantics: a guest added meanwhile cannot be dropped.
  assert.deepEqual(h.sent[0].body, { attendeesOmitted: true, attendees: [{ email: 'me@x.com', responseStatus: 'tentative' }] });
});

test('respond: bad answer → 400; not invited → 409; missing → 404; needsWrite → 409', async () => {
  const h = harness({ event: mine });
  for (const response of ['needsAction', 'yes', undefined]) {
    assert.equal((await h.call('POST /api/calendar/events/:id/respond', { id: 'abc', body: { response } })).status, 400);
  }
  const no = harness({ event: { organizer: {}, attendees: [{ email: 'ana@x.com' }] } });
  const r = await no.call('POST /api/calendar/events/:id/respond', { id: 'abc', body: { response: 'accepted' } });
  assert.deepEqual([r.status, r.out.error], [409, "You're not invited to this one"]);
  const gone = harness();
  assert.equal((await gone.call('POST /api/calendar/events/:id/respond', { id: 'abc', body: { response: 'accepted' } })).status, 404);
  const nw = harness({ event: mine, reply: () => ({ needsWrite: true }) });
  const w = await nw.call('POST /api/calendar/events/:id/respond', { id: 'abc', body: { response: 'accepted' } });
  assert.deepEqual([w.status, w.out.needsWrite], [409, true]);
});
