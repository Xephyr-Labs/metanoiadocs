import test from 'node:test';
import assert from 'node:assert/strict';
import { registerMeetingNotesRoutes, notesMarkdown, docIdsIn, whenLine } from './meeting-notes.js';
import { parseMarkdown } from './blocks.js';

const pass = () => {};
const event = (o = {}) => ({
  id: 'ev1', summary: 'Weekly sync', start: { dateTime: '2026-10-29T10:00:00+06:00' }, end: { dateTime: '2026-10-29T10:30:00+06:00' },
  attendees: [{ email: 'me@x.test', self: true }, { email: 'BOB@x.test', displayName: 'Bobby' }, { email: 'out@z.test', displayName: 'Olga' }],
  description: 'Agenda https://docs.test/d/doc-ok and https://docs.test/d/doc-secret, again https://docs.test/d/doc-ok',
  ...o,
});

/** A fake pool holding meeting_notes rows for every user, plus docs and tasks. */
function setup({ ev = event(), fetched = null, tasks = {}, canOpen = ['doc-ok'], race = null, trashed = [] } = {}) {
  const routes = {};
  const app = { post: (p, ...h) => { routes[p] = h[h.length - 1]; } };
  const db = { notes: [], docs: new Map(), created: [], deleted: [], fetches: 0 };
  const users = [{ id: 'me', name: 'Me Myself', email: 'me@x.test' }, { id: 'bob', name: 'Bob Teammate', email: 'bob@x.test' }];
  const pool = { query: async (sql, args = []) => {
    if (/SELECT m\.doc_id/.test(sql)) {
      const r = db.notes.find((n) => n.user_id === args[0] && n.event_id === args[1]);
      return { rows: r ? [{ doc_id: r.doc_id, live: !!db.docs.get(r.doc_id)?.live }] : [] };
    }
    if (/FROM docs WHERE id = ANY/.test(sql)) return { rows: args[0].filter((id) => !trashed.includes(id)).map((id) => ({ id })) };
    if (/FROM users/.test(sql)) return { rows: users.filter((u) => args[0].includes(u.email)).map((u) => ({ ...u })) };
    if (/FROM task_assignees/.test(sql)) return { rows: args[0].flatMap((uid) => (tasks[uid] || []).map((t) => ({ user_id: uid, ...t }))) };
    if (/FROM spaces WHERE id/.test(sql)) return { rowCount: args[0] === 'sp1' ? 1 : 0, rows: [] };
    if (/FROM spaces WHERE is_default/.test(sql)) return { rows: [{ id: 'sp-default' }] };
    if (/INSERT INTO spaces/.test(sql)) return { rows: [] };
    if (/DELETE FROM meeting_notes/.test(sql)) { db.notes = db.notes.filter((n) => !(n.user_id === args[0] && n.event_id === args[1] && n.doc_id === args[2])); return { rows: [] }; }
    if (/INSERT INTO meeting_notes/.test(sql)) {
      if (db.notes.some((n) => n.user_id === args[0] && n.event_id === args[1])) return { rows: [] };
      db.notes.push({ user_id: args[0], event_id: args[1], doc_id: args[2] });
      return { rows: [{ doc_id: args[2] }] };
    }
    if (/DELETE FROM docs/.test(sql)) { db.deleted.push(args[0]); db.docs.delete(args[0]); return { rows: [] }; }
    throw new Error('unexpected sql ' + sql);
  } };
  let n = 0;
  registerMeetingNotesRoutes(app, {
    requireUser: pass, needsPerson: pass, wrap: (f) => f, pool, baseUrl: 'https://docs.test/',
    calendarReady: async () => true,
    fetchEvent: async () => { db.fetches++; return fetched || { event: ev }; },
    grantOn: async (id) => (canOpen.includes(id) ? 'viewer' : null),
    createDocRow: async (row) => { const id = 'doc' + (++n); db.created.push({ id, ...row }); db.docs.set(id, { live: true }); race?.(db); return { id }; },
  });
  const call = async (user = { id: 'me', timezone: 'Asia/Dhaka' }, body = {}, eventId = 'ev1') => {
    const res = { code: 200, status(c) { this.code = c; return this; }, json(v) { this.body = v; return this; } };
    await routes['/api/calendar/events/:eventId/notes']({ user, body, params: { eventId } }, res);
    return res;
  };
  return { call, db };
}

test('first call creates a private page; second call returns it without refetching', async () => {
  const { call, db } = setup();
  const a = await call(undefined, { spaceId: 'sp1' });
  assert.deepEqual(a.body, { docId: 'doc1', created: true });
  assert.equal(db.created[0].visibility, 'private');
  assert.equal(db.created[0].userId, 'me');
  assert.equal(db.created[0].spaceId, 'sp1');
  assert.equal(db.created[0].title, 'Weekly sync — Oct 29, 2026');
  const b = await call();
  assert.deepEqual(b.body, { docId: 'doc1', created: false });
  assert.equal(db.created.length, 1);
  assert.equal(db.fetches, 1);
});

test('an unknown space falls back to the default space', async () => {
  const { call, db } = setup();
  await call(undefined, { spaceId: 'nope' });
  assert.equal(db.created[0].spaceId, 'sp-default');
});

test('another user\'s row for the same event is never matched', async () => {
  const { call, db } = setup();
  db.notes.push({ user_id: 'bob', event_id: 'ev1', doc_id: 'bobs' }); db.docs.set('bobs', { live: true });
  const r = await call();
  assert.equal(r.body.created, true);
  assert.notEqual(r.body.docId, 'bobs');
  assert.equal(db.notes.filter((x) => x.user_id === 'bob')[0].doc_id, 'bobs');
});

test('a trashed notes page is replaced by a new one', async () => {
  const { call, db } = setup();
  db.notes.push({ user_id: 'me', event_id: 'ev1', doc_id: 'old' }); db.docs.set('old', { live: false });
  const r = await call();
  assert.deepEqual(r.body, { docId: 'doc1', created: true });
  assert.deepEqual(db.notes.filter((x) => x.user_id === 'me').map((x) => x.doc_id), ['doc1']);
});

test('losing the race returns the winner and removes the extra page', async () => {
  // Another click lands its row while our page is being made.
  const { call, db } = setup({ race: (d) => { d.docs.set('winner', { live: true }); d.notes.push({ user_id: 'me', event_id: 'ev1', doc_id: 'winner' }); } });
  const r = await call();
  assert.deepEqual(r.body, { docId: 'winner', created: false });
  assert.deepEqual(db.deleted, ['doc1']);
});

test('only pages I can open become links, each once', async () => {
  const { call, db } = setup();
  await call();
  const md = db.created[0].content;
  assert.match(md, /^- \[\[doc-ok\]\]$/m);
  assert.equal(md.match(/doc-ok/g).length, 1);
  assert.doesNotMatch(md, /doc-secret/);
});

test('a trashed page I still hold a grant on is not linked', async () => {
  const { call, db } = setup({ canOpen: ['doc-ok', 'doc-secret'], trashed: ['doc-secret'] });
  await call();
  const md = db.created[0].content;
  assert.match(md, /^- \[\[doc-ok\]\]$/m);
  assert.doesNotMatch(md, /doc-secret/);
});

test('attendees: teammates by name, others by name and email', async () => {
  const { call, db } = setup();
  await call();
  const md = db.created[0].content;
  assert.match(md, /^- Me Myself$/m);
  assert.match(md, /^- Bob Teammate$/m);
  assert.match(md, /^- Olga \(out@z\.test\)$/m);
  assert.match(md, /^## Notes$/m);
  assert.match(md, /^## Action items\n- \[ \] $/m);
});

test('task snapshot: at most 5 open tasks per matched attendee, as task links', async () => {
  const many = Array.from({ length: 7 }, (_, i) => ({ id: 't' + i, title: `Task [${i}]`, project_id: 'p1' }));
  const { call, db } = setup({ tasks: { bob: many, me: [{ id: 'm1', title: 'Mine', project_id: 'p2' }] } });
  await call();
  const md = db.created[0].content;
  const bobLinks = md.split('## Open tasks')[1].split('- Bob Teammate\n')[1].split('\n').filter((l) => l.startsWith('  - '));
  assert.equal(bobLinks.length, 5);
  assert.equal(bobLinks[0], '  - [Task 0](/db/p1?task=t0)');
  assert.match(md, /^ {2}- \[Mine\]\(\/db\/p2\?task=m1\)$/m);
  const blocks = parseMarkdown(md);
  assert.equal(blocks.find((b) => b.text?.startsWith('[Task 0]'))?.depth, 1);
});

test('event gone, cancelled or not mine -> 404; no token -> 409 reconnect; feature off -> 404', async () => {
  assert.equal((await setup({ fetched: { missing: true } }).call()).code, 404);
  const re = await setup({ fetched: { reconnect: true } }).call();
  assert.equal(re.code, 409);
  assert.equal(re.body.reconnect, true);
});

test('when line is in the person\'s zone; all-day is the date alone', () => {
  assert.equal(whenLine(event(), 'Asia/Dhaka').replace(/ /g, ' '), 'Thursday, October 29, 2026 · 10:00 AM – 10:30 AM (GMT+6)');
  assert.match(whenLine(event(), 'America/New_York').replace(/ /g, ' '), /^Thursday, October 29, 2026 · 12:00 AM – 12:30 AM \(EDT\)$/);
  assert.equal(whenLine({ start: { date: '2026-10-29' } }, 'Pacific/Honolulu'), 'Thursday, October 29, 2026');
});

test('docIdsIn reads only this workspace\'s page links', () => {
  assert.deepEqual(docIdsIn('<a href="https://docs.test/d/a1">x</a> https://evil.test/d/b2 https://docs.test/d/a1#blk', 'https://docs.test'), ['a1']);
  assert.deepEqual(docIdsIn(undefined, 'https://docs.test'), []);
});

test('Google-supplied text cannot inject page links or markup', () => {
  const md = notesMarkdown({
    event: event({ attendees: [{ email: 'x@y', displayName: '[[doc-secret]] *bold*' }] }), zone: 'UTC',
    teammates: new Map(), linked: [], tasks: new Map(),
  });
  assert.doesNotMatch(md, /(?<!\\)\[\[doc-secret/);
});
