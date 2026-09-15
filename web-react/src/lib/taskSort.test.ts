import { describe, expect, it } from 'vitest';
import { applySort, pruneSort, type SortRule } from './taskSort';
import type { FilterField } from './taskFilter';
import type { TaskRow } from './tasksApi';

const task = (over: Partial<TaskRow>): TaskRow => ({
  id: over.id ?? crypto.randomUUID(),
  project_id: 'p',
  title: '',
  status: 'todo',
  assignee_id: null,
  assignee_name: null,
  assignees: [],
  start_at: null,
  due_at: null,
  priority: 0,
  progress: 0,
  points: null,
  milestone: false,
  doc_id: null,
  parent_id: null,
  kind: 'task',
  sprint_id: null,
  position: 0,
  props: {},
  deps: [],
  ...over,
} as TaskRow);

const NUM: FilterField = { key: 'points', label: 'Points', kind: 'number' };
const STATUS: FilterField = {
  key: 'status',
  label: 'Status',
  kind: 'select',
  options: [
    { value: 'todo', label: 'To do' },
    { value: 'doing', label: 'In progress' },
    { value: 'review', label: 'Review' },
    { value: 'done', label: 'Done' },
  ],
};
const rule = (field: string, dir: 'asc' | 'desc'): SortRule => ({ id: field, field, dir });

const titles = (rows: TaskRow[]) => rows.map((t) => t.title);

describe('applySort', () => {
  it('leaves the list alone when nothing is sorted', () => {
    // The unsorted order is the manual one a board drag writes; re-sorting by
    // nothing would quietly throw that away.
    const rows = [task({ title: 'b' }), task({ title: 'a' })];
    expect(applySort(rows, [], [NUM])).toBe(rows);
  });

  it('sorts a select by the option order, not the label', () => {
    const rows = [task({ title: 'done', status: 'done' }), task({ title: 'todo', status: 'todo' })];
    expect(titles(applySort(rows, [rule('status', 'asc')], [STATUS]))).toEqual(['todo', 'done']);
  });

  it('sorts numbers as numbers', () => {
    const rows = [task({ title: '9', points: 9 }), task({ title: '10', points: 10 })];
    expect(titles(applySort(rows, [rule('points', 'asc')], [NUM]))).toEqual(['9', '10']);
  });

  it('puts empty cells last in BOTH directions', () => {
    // An unset cell is missing, not smallest — burying the blanks is what
    // either direction actually wants.
    const rows = [task({ title: 'none' }), task({ title: 'five', points: 5 })];
    expect(titles(applySort(rows, [rule('points', 'asc')], [NUM]))).toEqual(['five', 'none']);
    expect(titles(applySort(rows, [rule('points', 'desc')], [NUM]))).toEqual(['five', 'none']);
  });

  it('falls through to the next rule when the first ties', () => {
    const rows = [
      task({ title: 'b', status: 'todo', points: 2 }),
      task({ title: 'a', status: 'todo', points: 1 }),
    ];
    const out = applySort(rows, [rule('status', 'asc'), rule('points', 'asc')], [STATUS, NUM]);
    expect(titles(out)).toEqual(['a', 'b']);
  });

  it('does not mutate the array it was given', () => {
    const rows = [task({ title: 'b', points: 2 }), task({ title: 'a', points: 1 })];
    applySort(rows, [rule('points', 'asc')], [NUM]);
    expect(titles(rows)).toEqual(['b', 'a']);
  });

  it('ignores a rule naming a field this database no longer has', () => {
    const rows = [task({ title: 'b' }), task({ title: 'a' })];
    expect(applySort(rows, [rule('gone', 'asc')], [NUM])).toBe(rows);
  });
});

describe('pruneSort', () => {
  it('drops rules whose field is gone and keeps the rest', () => {
    expect(pruneSort([rule('points', 'asc'), rule('gone', 'asc')], [NUM])).toEqual([rule('points', 'asc')]);
  });
});
