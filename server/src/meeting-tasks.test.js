import test from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { buildDocState } from './blocks.js';
import { openTodos, parseTodo, registerMeetingTaskRoutes } from './meeting-tasks.js';

// 2026-10-30 is a Friday.
const FRI = '2026-10-30';
const at = (today) => ({ today, zone: 'Asia/Dhaka' });

test('parseTodo: the spec example', () => {
  assert.deepEqual(parseTodo('@farhanaj send the deck by Friday', at('2026-10-27')),
    { title: 'send the deck', handles: ['farhanaj'], dueAt: FRI });
});

test('parseTodo: ISO dates, invalid ones stay in the title', () => {
  assert.equal(parseTodo('ship 2026-11-02', at(FRI)).dueAt, '2026-11-02');
  assert.equal(parseTodo('ship 2026-11-02', at(FRI)).title, 'ship');
  assert.equal(parseTodo('ship by 2026-11-02', at(FRI)).title, 'ship');
  const bad = parseTodo('ship 2026-02-31', at(FRI));
  assert.deepEqual([bad.title, bad.dueAt], ['ship 2026-02-31', null]);
});

test('parseTodo: today and tomorrow, across a month end', () => {
  assert.equal(parseTodo('call today', at('2026-10-31')).dueAt, '2026-10-31');
  assert.equal(parseTodo('call tomorrow', at('2026-10-31')).dueAt, '2026-11-01');
  assert.equal(parseTodo('call tomorrow', at('2026-12-31')).dueAt, '2027-01-01');
  assert.equal(parseTodo('call Tomorrow', at(FRI)).title, 'call');
});

test('parseTodo: weekdays are the coming one, today if today is that day', () => {
  assert.equal(parseTodo('report by Friday', at(FRI)).dueAt, FRI);
  assert.equal(parseTodo('report by Friday', at('2026-10-31')).dueAt, '2026-11-06');
  assert.equal(parseTodo('demo on monday', at(FRI)).dueAt, '2026-11-02');
  assert.equal(parseTodo('demo on monday', at(FRI)).title, 'demo');
  assert.equal(parseTodo('sync thursday', at(FRI)).dueAt, '2026-11-05');
  assert.equal(parseTodo('due Sunday: tidy up', at(FRI)).dueAt, '2026-11-01');
});

test('parseTodo: words that only contain a date phrase are not one', () => {
  const r = parseTodo("read today's notes", at(FRI));
  assert.deepEqual([r.title, r.dueAt], ["read today's notes", null]);
  assert.equal(parseTodo('ask @friday', at(FRI)).dueAt, null);
  assert.equal(parseTodo('fridays are long', at(FRI)).dueAt, null);
});

test('parseTodo: handles leave the title; unknown ones stay when `known` is given', () => {
  assert.deepEqual(parseTodo('@Ana and @bob review', at(FRI)),
    { title: 'and review', handles: ['ana', 'bob'], dueAt: null });
  const r = parseTodo('@ana ask @ghost about it', { ...at(FRI), known: new Set(['ana']) });
  assert.equal(r.title, 'ask @ghost about it');
  assert.deepEqual(r.handles, ['ana', 'ghost']);
  assert.equal(parseTodo('ask @ana.', { ...at(FRI), known: new Set(['ana']) }).title, 'ask.');
});

test('parseTodo: an email address is not a handle', () => {
  const r = parseTodo('mail ana@example.com and @bob', at(FRI));
  assert.deepEqual(r.handles, ['bob']);
  assert.equal(r.title, 'mail ana@example.com and');
});

test("parseTodo: a possessive handle keeps the name, not a stray 's", () => {
  const r = parseTodo("fix @ana's deck", { ...at(FRI), known: new Set(['ana']) });
  assert.deepEqual([r.title, r.handles], ["fix ana's deck", ['ana']]);
});

test('parseTodo: whitespace collapsed; only the first date phrase is taken', () => {
  const r = parseTodo('   send   the   deck  by friday   then monday ', at(FRI));
  assert.deepEqual([r.title, r.dueAt], ['send the deck then monday', FRI]);
});

test('parseTodo: today defaults to the zone\'s own date', () => {
  assert.match(parseTodo('x today', { zone: 'UTC' }).dueAt, /^\d{4}-\d{2}-\d{2}$/);
});

// ── the route ─────────────────────────────────────────────────────────────

const page = (md, resolve) => {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, buildDocState('Standup', md, resolve));
  return doc;
};
const todoTexts = (doc) => [...doc.getMap('blocks').values()]
  .filter((b) => b.get('prop:type') === 'todo').map((b) => b.get('prop:text'));

function harness({ doc, project = { mode: 'tasks', archived_at: null }, grant = 'owner', fail } = {}) {
  const routes = {};
  const made = [];
  const pages = [];
  let n = 0;
  const app = { post: (path, ...h) => { routes[path] = h[h.length - 1]; } };
  registerMeetingTaskRoutes(app, {
    requireUser: () => {}, needsPerson: () => {}, wrap: (fn) => fn,
    baseUrl: 'https://docs.example.com',
    editGrant: async () => grant,
    pool: {
      query: async (sql, args) => {
        if (/FROM docs/.test(sql)) return { rows: [{ '?column?': 1 }] };
        if (/FROM projects/.test(sql)) return { rows: project ? [project] : [] };
        if (/FROM users/.test(sql)) {
          const all = [{ id: 'u-far', handle: 'farhanaj' }, { id: 'u-sa', handle: 'sajjad' }];
          return { rows: all.filter((u) => args[0].includes(u.handle)) };
        }
        throw new Error(`unexpected ${sql}`);
      },
    },
    getHocuspocus: () => ({
      openDirectConnection: async () => ({
        document: doc, transact: async (fn) => fn(doc), disconnect: async () => {},
      }),
    }),
    createTask: async (body, user) => {
      if (fail && made.length === fail) return { status: 400, error: 'nope' };
      made.push({ body, user });
      return { task: { id: `t${++n}` } };
    },
    taskPage: async (taskId, userId, md) => { pages.push({ taskId, userId, md }); },
  });
  const call = async (body = { projectId: 'p1' }) => {
    let status = 200;
    let out;
    await routes['/api/docs/:id/make-tasks'](
      { params: { id: 'd1' }, user: { id: 'me', timezone: 'Asia/Dhaka' }, body },
      { status(s) { status = s; return this; }, json(v) { out = v; } },
    );
    return { status, out };
  };
  return { call, made, pages };
}

const NOTES = [
  '## Action items',
  '- [ ] @farhanaj send the deck by Friday',
  '- [x] already done',
  '- [ ] @ghost @sajjad check the numbers tomorrow',
  '- [ ] ',
].join('\n');

test('make-tasks: creates open to-dos with assignees and dates, links each line', async () => {
  const doc = page(NOTES);
  const { call, made, pages } = harness({ doc });
  const { status, out } = await call();
  assert.equal(status, 200);
  assert.deepEqual(out, {
    created: [{ taskId: 't1', title: 'send the deck' }, { taskId: 't2', title: '@ghost check the numbers' }],
    skipped: 1,
  });
  assert.deepEqual(made.map((m) => m.body.assigneeIds), [['u-far'], ['u-sa']]);
  assert.ok(made.every((m) => m.body.projectId === 'p1' && /^\d{4}-\d{2}-\d{2}$/.test(m.body.dueAt)));
  assert.deepEqual(pages.map((p) => p.md), ['From meeting notes: [[d1]]', 'From meeting notes: [[d1]]']);
  const [first, , second] = todoTexts(doc);
  assert.deepEqual(first.toDelta(), [{ insert: '@farhanaj send the deck by Friday', attributes: { link: '/db/p1?task=t1' } }]);
  assert.equal(second.toDelta()[0].attributes.link, '/db/p1?task=t2');
});

test('make-tasks: a second run creates nothing and skips the linked lines', async () => {
  const doc = page(NOTES);
  const h = harness({ doc });
  await h.call();
  const again = await h.call();
  assert.deepEqual(again.out, { created: [], skipped: 3 });
  assert.equal(h.made.length, 2);
});

test('make-tasks: a line linked by absolute URL counts as linked', async () => {
  const doc = page('- [ ] old one\n- [ ] new one');
  const [old] = todoTexts(doc);
  old.format(0, old.length, { link: 'https://docs.example.com/db/p9?task=x' });
  const { call, made } = harness({ doc });
  const { out } = await call();
  assert.deepEqual(out, { created: [{ taskId: 't1', title: 'new one' }], skipped: 1 });
  assert.equal(made.length, 1);
});

test('make-tasks: a failure mid-run still links what was made, and says so', async () => {
  const doc = page('- [ ] one\n- [ ] two\n- [ ] three');
  const { call } = harness({ doc, fail: 1 });
  const logged = [];
  const was = console.error;
  console.error = (...a) => logged.push(a.join(' '));
  let out;
  try { ({ out } = await call()); } finally { console.error = was; }
  assert.deepEqual(out, { created: [{ taskId: 't1', title: 'one' }], skipped: 0, failed: 2, error: 'nope' });
  assert.deepEqual(logged, ['[make-tasks] nope']);
  assert.equal(todoTexts(doc)[0].toDelta()[0].attributes.link, '/db/p1?task=t1');
  assert.equal(todoTexts(doc)[1].toDelta()[0].attributes, undefined);
});

test('make-tasks: links only plain runs, keeping an external link and a page reference', async () => {
  const doc = page('- [ ] review [PR #12](https://github.com/x/y/pull/12) with [[Spec]]', (k) => (k === 'Spec' ? 'pg1' : null));
  const h = harness({ doc });
  await h.call();
  const ops = todoTexts(doc)[0].toDelta();
  assert.ok(ops.some((o) => o.insert === 'PR #12' && o.attributes.link === 'https://github.com/x/y/pull/12'));
  const ref = ops.find((o) => o.attributes?.reference);
  assert.equal(ref.attributes.reference.pageId, 'pg1');
  assert.equal(ref.attributes.link, undefined);
  assert.ok(ops.filter((o) => !o.attributes?.reference && o.insert !== 'PR #12')
    .every((o) => o.attributes.link === '/db/p1?task=t1'));
  assert.deepEqual((await h.call()).out, { created: [], skipped: 1 });
});

test('make-tasks: a line that is all links still gets a task link', async () => {
  const doc = page('- [ ] [PR](https://github.com/x)');
  const h = harness({ doc });
  await h.call();
  const ops = todoTexts(doc)[0].toDelta();
  assert.equal(ops[0].attributes.link, 'https://github.com/x');
  assert.ok(ops.some((o) => o.attributes?.link === '/db/p1?task=t1'));
  assert.deepEqual((await h.call()).out, { created: [], skipped: 1 });
});

test('make-tasks: archived, data or missing databases are refused', async () => {
  for (const project of [{ mode: 'tasks', archived_at: new Date() }, { mode: 'data', archived_at: null }, null]) {
    const h = harness({ doc: page(NOTES), project });
    const { status } = await h.call();
    assert.ok(status === 404 || status === 400, `refused ${JSON.stringify(project)}`);
    assert.equal(h.made.length, 0);
  }
});

test('make-tasks: needs edit access and a projectId', async () => {
  assert.equal((await harness({ doc: page(NOTES), grant: null }).call()).status, 403);
  assert.equal((await harness({ doc: page(NOTES) }).call({})).status, 400);
});

test('openTodos walks in page order, nested lines included', () => {
  const { todos } = openTodos(page('- [ ] a\n  - [ ] b\n- [ ] c'));
  assert.deepEqual(todos.map((t) => t.text), ['a', 'b', 'c']);
});
