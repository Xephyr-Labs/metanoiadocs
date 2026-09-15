import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanConfig, VIEW_KINDS } from './views.js';

test('cleanConfig keeps the shapes the view engines read', () => {
  const out = cleanConfig({
    filters: [{ id: 'f1', field: 'status', op: 'is', value: 'done' }],
    sort: [{ id: 's1', field: 'due_at', dir: 'desc' }],
    groupBy: 'status',
    props: ['sys:status', 'sys:due'],
    scope: 'all',
  });
  assert.deepEqual(out.filters, [{ id: 'f1', field: 'status', op: 'is', value: 'done' }]);
  assert.deepEqual(out.sort, [{ id: 's1', field: 'due_at', dir: 'desc' }]);
  assert.equal(out.groupBy, 'status');
  assert.deepEqual(out.props, ['sys:status', 'sys:due']);
});

test('cleanConfig tells "grouped by nothing" from "not mentioned"', () => {
  // null has to survive: it is how a view says it is ungrouped, and the PATCH
  // merges rather than replaces, so an absent key would leave the old grouping.
  assert.equal(cleanConfig({ groupBy: null }).groupBy, null);
  assert.equal('groupBy' in cleanConfig({ filters: [] }), false);
});

test('cleanConfig drops entries that are not filters', () => {
  const out = cleanConfig({ filters: [{ field: 'status', op: 'is', value: 'x' }, 'nope', null, {}] });
  assert.equal(out.filters.length, 1);
  assert.equal(typeof out.filters[0].id, 'string'); // minted when missing
});

test('cleanConfig normalises a sort direction rather than trusting it', () => {
  assert.equal(cleanConfig({ sort: [{ field: 'a', dir: 'DESC' }] }).sort[0].dir, 'asc');
  assert.equal(cleanConfig({ sort: [{ field: 'a', dir: 'desc' }] }).sort[0].dir, 'desc');
});

test('cleanConfig refuses anything that is not an object', () => {
  // null is the caller's signal to answer 400 — distinct from undefined, which
  // means the request simply did not mention config.
  assert.equal(cleanConfig('{}'), null);
  assert.equal(cleanConfig([]), null);
  assert.equal(cleanConfig(undefined), undefined);
  assert.deepEqual(cleanConfig({}), {});
});

test('the seeded view kinds are the ones the client can render', () => {
  assert.deepEqual(VIEW_KINDS, ['backlog', 'board', 'table', 'gantt', 'calendar', 'gallery']);
});
