import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { docFromState, extractTasks, toDateStr, normalizeStatus } from './board-decode.js';
import { toDate, wouldCycle } from './tasks.js';

const DAY = 24 * 60 * 60 * 1000;
const ms = (iso) => Date.parse(`${iso}T00:00:00Z`);

/** Build a Yjs state that looks like a BlockSuite page holding one database. */
function boardState({ columns, rows, title = 'Task Board' }) {
  const doc = new Y.Doc();
  const blocks = doc.getMap('blocks');

  const db = new Y.Map();
  db.set('sys:flavour', 'affine:database');
  db.set('prop:title', title);
  db.set('prop:columns', Y.Array.from(columns));
  const cells = new Y.Map();
  const children = new Y.Array();

  for (const row of rows) {
    const block = new Y.Map();
    block.set('sys:flavour', 'affine:paragraph');
    const text = new Y.Text();
    text.insert(0, row.name);
    block.set('prop:text', text);
    blocks.set(row.id, block);
    children.push([row.id]);

    const rowCells = new Y.Map();
    for (const [colId, value] of Object.entries(row.cells)) rowCells.set(colId, { value });
    cells.set(row.id, rowCells);
  }

  db.set('prop:cells', cells);
  db.set('sys:children', children);
  blocks.set('db-1', db);
  return Y.encodeStateAsUpdate(doc);
}

const COLUMNS = [
  { id: 'c-start', name: 'Start', type: 'date' },
  { id: 'c-due', name: 'Due', type: 'date' },
  {
    id: 'c-status', name: 'Status', type: 'select',
    data: { options: [{ id: 'o-1', value: 'Doing' }, { id: 'o-2', value: 'Done' }] },
  },
  { id: 'c-prog', name: 'Progress', type: 'number' },
  { id: 'c-dep', name: 'Depends on', type: 'rich-text' },
  { id: 'c-ms', name: 'Milestone', type: 'checkbox' },
  { id: 'c-who', name: 'Assignee', type: 'member' },
];

test('extractTasks reads rows, dates, status, progress, milestone, assignee', () => {
  const state = boardState({
    columns: COLUMNS,
    rows: [
      {
        id: 'r-1', name: 'Design schema',
        cells: {
          'c-start': ms('2026-07-01'), 'c-due': ms('2026-07-05'),
          'c-status': 'o-2', 'c-prog': 100, 'c-ms': true, 'c-who': ['affine-user-1'],
        },
      },
      {
        id: 'r-2', name: 'Build API',
        cells: { 'c-start': ms('2026-07-06'), 'c-due': ms('2026-07-12'), 'c-status': 'o-1', 'c-dep': 'Design schema' },
      },
    ],
  });

  const board = extractTasks(docFromState(state));
  assert.equal(board.found, true);
  assert.equal(board.title, 'Task Board');
  assert.equal(board.tasks.length, 2);

  const [a, b] = board.tasks;
  assert.equal(a.title, 'Design schema');
  assert.equal(a.startAt, '2026-07-01');
  assert.equal(a.dueAt, '2026-07-05');
  assert.equal(a.status, 'done');
  assert.equal(a.progress, 100);
  assert.equal(a.milestone, true);
  assert.deepEqual(a.assigneeRefs, ['affine-user-1']);

  assert.equal(b.status, 'doing');
  assert.equal(b.progress, 50, 'no progress cell -> derived from status');
  assert.deepEqual(b.deps, ['r-1'], 'dependency name resolves to the row id');
});

test('extractTasks keeps undated rows (the gantt skipped them, a board must not)', () => {
  const state = boardState({
    columns: COLUMNS,
    rows: [{ id: 'r-1', name: 'Someday task', cells: {} }],
  });
  const board = extractTasks(docFromState(state));
  assert.equal(board.tasks.length, 1);
  assert.equal(board.tasks[0].startAt, null);
  assert.equal(board.tasks[0].dueAt, null);
  assert.equal(board.tasks[0].status, 'todo');
});

test('extractTasks ignores a table with no date column', () => {
  const state = boardState({
    columns: [{ id: 'c-1', name: 'Note', type: 'rich-text' }],
    rows: [{ id: 'r-1', name: 'Not a schedule', cells: { 'c-1': 'hi' } }],
  });
  assert.equal(extractTasks(docFromState(state)).found, false);
});

test('toDateStr handles epoch ms, seconds, ISO strings and junk', () => {
  assert.equal(toDateStr(ms('2026-07-01')), '2026-07-01');
  assert.equal(toDateStr(ms('2026-07-01') / 1000), '2026-07-01');
  assert.equal(toDateStr('2026-07-01T09:00:00Z'), '2026-07-01');
  assert.equal(toDateStr('someday'), null);
  assert.equal(toDateStr(''), null);
  assert.equal(toDateStr(null), null);
});

test('normalizeStatus folds free text onto the four allowed statuses', () => {
  assert.equal(normalizeStatus('In Progress'), 'doing');
  assert.equal(normalizeStatus('QA'), 'review');
  assert.equal(normalizeStatus('Shipped'), 'done');
  assert.equal(normalizeStatus('Backlog'), 'todo');
  assert.equal(normalizeStatus(null), 'todo');
});

test('toDate accepts YYYY-MM-DD and rejects everything else', () => {
  assert.equal(toDate('2026-07-01'), '2026-07-01');
  assert.equal(toDate('2026-07-01T10:00:00Z'), '2026-07-01');
  assert.equal(toDate('2026-13-45'), null);
  assert.equal(toDate('tomorrow'), null);
  assert.equal(toDate(null), null);
});

test('wouldCycle catches direct, self and transitive loops', () => {
  // b depends on a, c depends on b.
  const edges = new Map([['b', ['a']], ['c', ['b']]]);
  assert.equal(wouldCycle(edges, 'a', 'a'), true, 'self');
  assert.equal(wouldCycle(edges, 'a', 'b'), true, 'direct: b already depends on a');
  assert.equal(wouldCycle(edges, 'a', 'c'), true, 'transitive: c -> b -> a');
  assert.equal(wouldCycle(edges, 'c', 'a'), false, 'c depending on a is fine');
  assert.equal(wouldCycle(new Map(), 'x', 'y'), false);
});

test('wouldCycle terminates on an already-cyclic graph', () => {
  const edges = new Map([['a', ['b']], ['b', ['a']]]);
  assert.equal(wouldCycle(edges, 'c', 'a'), false);
});

// Guard the one date assumption the gantt relies on: YYYY-MM-DD sorts
// chronologically, and day arithmetic is plain division.
test('date strings compare and subtract as the gantt expects', () => {
  assert.ok('2026-07-01' < '2026-07-05');
  assert.equal((ms('2026-07-05') - ms('2026-07-01')) / DAY, 4);
});
