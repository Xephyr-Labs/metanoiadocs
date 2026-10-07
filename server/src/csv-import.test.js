import test from 'node:test';
import assert from 'node:assert/strict';
import { linkParents, readKind, readStamp, registerCsvRoutes } from './csv-import.js';
import { mapColumns } from './csv.js';

const kinds = [
  { key: 'epic', label: 'Epic', is_group: true },
  { key: 'story', label: 'Story', is_group: false },
  { key: 'tech-debt', label: 'Tech Debt', is_group: false },
];
const opts = { projectId: 'p1', projectKey: 'DE', kinds };

test('ID, Parent, Type and Created are columns an import understands', () => {
  const cols = mapColumns(['ID', 'Parent', 'Type', 'Created', 'External ID'], []);
  assert.deepEqual(cols.map((c) => c.field), ['externalId', 'parent', 'kind', 'createdAt', 'externalId']);
});

test('a Type cell matches a key or a label, in any case', () => {
  assert.equal(readKind('Epic', kinds), 'epic');
  assert.equal(readKind(' tech debt ', kinds), 'tech-debt');
  assert.equal(readKind('TECH-DEBT', kinds), 'tech-debt');
  assert.equal(readKind('', kinds), '');
  assert.equal(readKind('Feature', kinds), null);
});

test('a Created cell is a date, with or without the time ZenTao writes', () => {
  assert.equal(readStamp('2024-03-01'), '2024-03-01');
  assert.equal(readStamp('2024-03-01 10:22:33'), '2024-03-01 10:22:33');
  assert.equal(readStamp('01/03/2024'), null);
  assert.equal(readStamp('2024-13-45'), null);
});

test('a Parent cell finds a row of the same file, even one further down', () => {
  const plans = [
    { line: 2, extId: '7', kind: 'story', parentRef: '1' },
    { line: 3, extId: '1', kind: 'epic', parentRef: null },
  ];
  const { links, errors } = linkParents(plans, [], opts);
  assert.deepEqual(errors, []);
  assert.equal(links.get(2), 'new:3');
});

test('a Parent cell can name a task already in the project, by import ID or by key', () => {
  const existing = [
    { id: 'old-epic', num: 4, kind: 'epic', parent_id: null, ext: '100' },
    { id: 'old-epic-2', num: 5, kind: 'epic', parent_id: null, ext: null },
  ];
  const plans = [
    { line: 2, extId: '7', kind: 'story', parentRef: '100' },
    { line: 3, extId: '8', kind: 'story', parentRef: 'de-5' },
  ];
  const { links, errors } = linkParents(plans, existing, opts);
  assert.deepEqual(errors, []);
  assert.equal(links.get(2), 'old-epic');
  assert.equal(links.get(3), 'old-epic-2');
});

test('parent problems are reported per row, and the row comes in at the top level', () => {
  const plans = [
    { line: 2, extId: '1', kind: 'story', parentRef: null },
    { line: 3, extId: '2', kind: 'story', parentRef: '1' },
    { line: 4, extId: '3', kind: 'story', parentRef: '99' },
    { line: 5, extId: '4', kind: 'story', parentRef: '5' },
  ];
  const { links, errors } = linkParents(plans, [], { ...opts, dropped: new Map([['5', 9]]) });
  assert.equal(links.size, 0);
  assert.deepEqual(errors.map((e) => e.line), [3, 4, 5]);
  assert.match(errors[0].error, /imported without a parent: "1" is a Story, which cannot hold other tasks/);
  assert.match(errors[1].error, /no row in this file has ID "99"/);
  assert.match(errors[2].error, /line 9\) was not imported/);
});

test('a loop written into the file is caught on the row that closes it', () => {
  const plans = [
    { line: 2, extId: 'a', kind: 'epic', parentRef: 'b' },
    { line: 3, extId: 'b', kind: 'epic', parentRef: 'a' },
  ];
  const { links, errors } = linkParents(plans, [], opts);
  assert.equal(links.get(2), 'new:3');
  assert.deepEqual(errors.map((e) => e.line), [3]);
  assert.match(errors[0].error, /loop/);
});

/** The route's handler, with nothing behind it: the refusal has to come before any query. */
function handler() {
  let fn;
  registerCsvRoutes(
    { post: (_path, ...chain) => { fn = chain.at(-1); } },
    { requireUser: null, raw: null, wrap: (f) => f, createDocRow: null },
  );
  return async (user, query) => {
    const res = { code: 200, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
    await fn({ params: { id: 'p1' }, query, user, body: '' }, res);
    return res;
  };
}

test('only an admin may import without notifying anyone', async () => {
  const call = handler();
  const res = await call({ id: 'u1', role: 'collaborator' }, { notify: '0' });
  assert.equal(res.code, 403);
  assert.match(res.body.error, /Only an admin/);
});
