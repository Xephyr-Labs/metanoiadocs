import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chartQuery, chartDenied, cleanChart, pgZone, rollUp, OTHER, MAX_BUCKETS } from './chart.js';
import { cleanConfig } from './views.js';

const PROPS = [
  { id: 'p-sel', type: 'select' },
  { id: 'p-multi', type: 'multi_select' },
  { id: 'p-who', type: 'person' },
  { id: 'p-num', type: 'number' },
  { id: 'p-day', type: 'date' },
  { id: 'p-fx', type: 'formula' },
];

test('cleanChart keeps a valid chart and fills what was left out', () => {
  assert.deepEqual(cleanChart({ type: 'donut', x: 'assignee_id' }), {
    type: 'donut', x: 'assignee_id', unit: 'week', measure: 'count', of: null, stack: null,
  });
  assert.deepEqual(
    cleanChart({ type: 'line', x: 'created_at', unit: 'month', measure: 'avg', of: 'points', stack: 'status' }),
    { type: 'line', x: 'created_at', unit: 'month', measure: 'avg', of: 'points', stack: 'status' },
  );
  // Anything it does not recognise falls back rather than failing the save.
  const junk = cleanChart({ type: 'pie3d', unit: 'decade', measure: 'median', x: 42 });
  assert.equal(junk.type, 'bar');
  assert.equal(junk.unit, 'week');
  assert.equal(junk.measure, 'count');
  assert.equal(junk.x, 'status');
  // A sum of nothing is a count.
  assert.equal(cleanChart({ measure: 'sum' }).measure, 'count');
  assert.equal(cleanChart(null), null);
});

test('a view saves its chart with the rest of its config', () => {
  const out = cleanConfig({ chart: { type: 'hbar', x: 'kind' }, filters: [] });
  assert.equal(out.chart.type, 'hbar');
  assert.equal('chart' in cleanConfig({ filters: [] }), false);
});

test('the query is scoped to one project and its live rows', () => {
  const q = chartQuery({ projectId: 'P', chart: cleanChart({ x: 'status' }), props: PROPS, zone: 'UTC' });
  assert.equal(q.values[0], 'P');
  assert.match(q.text, /t\.project_id = \$1/);
  assert.match(q.text, /t\.deleted_at IS NULL/);
  assert.match(q.text, /GROUP BY 1, 2/);
  assert.deepEqual(q.ignored, []);
  // The task count reads the same WHERE with only the parameters it uses.
  assert.match(q.countText, /count\(\*\)/);
  assert.equal(q.countValues.length, 1);
});

test('every value is a parameter, never spliced into the SQL', () => {
  const evil = "x'); DROP TABLE tasks; --";
  const q = chartQuery({
    projectId: 'P',
    chart: cleanChart({ x: 'prop:p-sel', measure: 'sum', of: 'prop:p-num' }),
    filters: [{ id: 'f', field: 'title', op: 'contains', value: evil }],
    scope: evil,
    props: PROPS,
    zone: 'UTC',
  });
  assert.equal(q.text.includes('DROP TABLE'), false);
  assert.ok(q.values.includes(evil));
  assert.ok(q.values.includes('p-sel'));
});

test('a date axis is read in the reader\'s zone; a DATE column has none', () => {
  const ts = chartQuery({ projectId: 'P', chart: cleanChart({ type: 'line', x: 'done_at' }), props: PROPS, zone: 'Asia/Dhaka' });
  assert.match(ts.text, /t\.done_at AT TIME ZONE \$\d/);
  assert.ok(ts.values.includes('Asia/Dhaka'));
  const due = chartQuery({ projectId: 'P', chart: cleanChart({ type: 'line', x: 'due_at' }), props: PROPS, zone: 'Asia/Dhaka' });
  assert.match(due.text, /t\.due_at::text/);
  assert.equal(due.values.includes('Asia/Dhaka'), false);
});

test('filters the chart cannot evaluate are reported, not silently dropped', () => {
  const q = chartQuery({
    projectId: 'P',
    chart: cleanChart({ x: 'status' }),
    filters: [
      { id: 'a', field: 'status', op: 'is_any_of', value: 'todo,doing' },
      { id: 'b', field: 'prop:p-fx', op: 'contains', value: 'x' },
      { id: 'c', field: 'prop:gone', op: 'is', value: 'x' },
      // No value yet: the client skips these, so the chart does too.
      { id: 'd', field: 'title', op: 'contains', value: '' },
    ],
    props: PROPS,
    zone: 'UTC',
  });
  assert.deepEqual(q.ignored, ['b', 'c']);
  assert.ok(q.values.includes('todo') && q.values.includes('doing'));
});

test('sprint scope narrows the rows like the views do', () => {
  const backlog = chartQuery({ projectId: 'P', chart: cleanChart({}), scope: 'backlog', props: [], zone: 'UTC' });
  assert.match(backlog.text, /t\.sprint_id IS NULL/);
  const sprint = chartQuery({ projectId: 'P', chart: cleanChart({}), scope: 'S1', props: [], zone: 'UTC' });
  assert.ok(sprint.values.includes('S1'));
});

// ── rollUp ────────────────────────────────────────────────────────────────

const row = (x, s, n, total = null, counted = 0) => ({ x, s, n, total, counted });

test('counts by category, largest first, with one series when nothing stacks', () => {
  const out = rollUp(
    [row('todo', '', 3), row('done', '', 5), row('doing', '', 1)],
    cleanChart({ x: 'status' }),
  );
  assert.deepEqual(out.buckets.map((b) => [b.key, b.value]), [['done', 5], ['todo', 3], ['doing', 1]]);
  assert.deepEqual(out.series, [{ key: '', values: [5, 3, 1] }]);
});

test('a stacked chart has one series per stack value, aligned with the buckets', () => {
  const out = rollUp(
    [row('ada', 'todo', 2), row('ada', 'done', 1), row('bob', 'done', 4)],
    cleanChart({ x: 'assignee_id', stack: 'status' }),
  );
  assert.deepEqual(out.buckets.map((b) => [b.key, b.value]), [['bob', 4], ['ada', 3]]);
  assert.deepEqual(out.series, [
    { key: 'done', values: [4, 1] },
    { key: 'todo', values: [0, 2] },
  ]);
});

test('sum and average read the number, and an average ignores rows without one', () => {
  const rows = [row('a', '', 3, 10, 2), row('b', '', 1, 4, 1), row('a', '', 1, null, 0)];
  const sum = rollUp(rows, cleanChart({ x: 'kind', measure: 'sum', of: 'points' }));
  assert.deepEqual(sum.buckets.map((b) => [b.key, b.value]), [['a', 10], ['b', 4]]);
  const avg = rollUp(rows, cleanChart({ x: 'kind', measure: 'avg', of: 'points' }));
  assert.deepEqual(avg.buckets.map((b) => [b.key, b.value]), [['a', 5], ['b', 4]]);
});

test('past the cap the smallest categories fold into Other', () => {
  const many = Array.from({ length: 25 }, (_, i) => row(`k${i}`, '', i + 1));
  const out = rollUp(many, cleanChart({ x: 'prop:p-sel' }));
  assert.equal(out.buckets.length, MAX_BUCKETS);
  const other = out.buckets[out.buckets.length - 1];
  assert.equal(other.key, OTHER);
  // k0..k5 are the six smallest: 1+2+3+4+5+6.
  assert.equal(other.value, 21);
  assert.equal(out.buckets.reduce((s, b) => s + b.value, 0), (25 * 26) / 2);
});

test('an average folded into Other is the average of its rows, not of averages', () => {
  const many = [
    ...Array.from({ length: MAX_BUCKETS - 1 }, (_, i) => row(`big${i}`, '', 1, 100, 1)),
    row('s1', '', 1, 1, 1),
    row('s2', '', 3, 9, 3),
  ];
  const out = rollUp(many, cleanChart({ x: 'kind', measure: 'avg', of: 'points' }));
  const other = out.buckets.find((b) => b.key === OTHER);
  assert.equal(other.value, 2.5); // (1 + 9) / (1 + 3)
});

test('dates bucket by week or month, in order, with the empty weeks drawn', () => {
  const out = rollUp(
    [row('2026-10-28', '', 2), row('2026-11-04', '', 1), row('2026-10-14', '', 3), row('', '', 4)],
    cleanChart({ type: 'line', x: 'created_at', unit: 'week' }),
    { dates: true },
  );
  assert.deepEqual(out.buckets.map((b) => [b.key, b.value]), [
    ['2026-10-12', 3], ['2026-10-19', 0], ['2026-10-26', 2], ['2026-11-02', 1], ['', 4],
  ]);
  const months = rollUp(
    [row('2026-12-30', '', 1), row('2027-02-02', '', 1)],
    cleanChart({ x: 'due_at', unit: 'month' }),
    { dates: true },
  );
  assert.deepEqual(months.buckets.map((b) => b.key), ['2026-12-01', '2027-01-01', '2027-02-01']);
});

test('nothing to chart is an empty answer, not an error', () => {
  assert.deepEqual(rollUp([], cleanChart({})), { buckets: [], series: [] });
});

test('only bars stack: a line or a donut ignores a saved stack-by', () => {
  for (const type of ['line', 'donut']) {
    const q = chartQuery({ projectId: 'P', chart: cleanChart({ type, x: 'assignee_id', stack: 'status' }), props: [], zone: 'UTC' });
    assert.doesNotMatch(q.text, /AS s\(k\)|\) s$/m, type);
    assert.match(q.text, /'' AS s/, type);
  }
  const bar = chartQuery({ projectId: 'P', chart: cleanChart({ type: 'bar', x: 'assignee_id', stack: 'status' }), props: [], zone: 'UTC' });
  assert.match(bar.text, /coalesce\(s\.k, ''\) AS s/);
});

test('a field named after an Object prototype key is not a field', () => {
  const q = chartQuery({
    projectId: 'P',
    chart: cleanChart({ x: 'constructor', of: 'toString', measure: 'sum' }),
    filters: [{ id: 'f', field: 'toString', op: 'is', value: 'x' }],
    props: [],
    zone: 'UTC',
  });
  assert.deepEqual(q.ignored, ['f']);
  assert.match(q.text, /t\.status/); // fell back to the default axis
});

test('a zone Postgres does not know falls back to UTC', () => {
  assert.equal(pgZone('America/New_York', new Set(['America/New_York', 'UTC'])), 'America/New_York');
  assert.equal(pgZone('Etc/Unknown', new Set(['UTC'])), 'UTC');
});

test('chart_tasks refuses a sum or an average with nothing to read', async () => {
  const { createMetanoiaMcpServer } = await import('./mcp-tools.js');
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');
  const server = createMetanoiaMcpServer({ base: 'http://127.0.0.1:1', headers: {} });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 't', version: '1' });
  await Promise.all([server.connect(b), client.connect(a)]);
  const r = await client.callTool({ name: 'chart_tasks', arguments: { board: 'x', measure: 'avg' } });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /needs `of`/);
  await client.close();
});

test('chartDenied: only members of the board space (and admins) may chart it', () => {
  assert.equal(chartDenied({ spaceId: null }), null);
  assert.equal(chartDenied({ spaceId: 's1', spaceName: 'Sales', member: true }), null);
  assert.equal(chartDenied({ spaceId: 's1', spaceName: 'Sales', member: false, admin: true }), null);
  assert.equal(chartDenied({ spaceId: 's1', spaceName: 'Sales', member: false }), 'Join the Sales space to see this chart.');
});
