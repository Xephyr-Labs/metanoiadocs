import { describe, expect, it } from 'vitest';
import { applyFilters, fieldsFor, newFilter, needsValue, type Filter } from './taskFilter';
import type { PropRow, TaskRow } from './tasksApi';

const task = (over: Partial<TaskRow>): TaskRow => ({
  id: 't1', project_id: 'A', title: 'Task', status: 'todo',
  assignee_id: null, assignee_name: null, start_at: null, due_at: null,
  priority: 0, progress: 0, points: null, milestone: false, doc_id: null,
  parent_id: null, kind: 'task', sprint_id: null, position: 0, done_at: null,
  deps: [], props: {}, preview: null, ...over,
});

const prop = (over: Partial<PropRow>): PropRow => ({
  id: 'p1', project_id: 'A', key: 'k', label: 'L', type: 'text',
  options: [], target_project_id: null, position: 0, ...over,
});

const fields = (props: PropRow[] = []) =>
  fieldsFor({
    mode: 'tasks',
    props,
    users: [{ id: 'u1', name: 'Shafin', username: 'shafin' }],
    kinds: [{ id: 'k1', project_id: 'A', key: 'bug', label: 'Bug', color: 'red', is_group: false, position: 0 }],
    sprints: [],
  });

const filter = (over: Partial<Filter>): Filter =>
  ({ id: 'f1', field: 'title', op: 'contains', value: '', ...over });

const run = (tasks: TaskRow[], f: Filter[], props: PropRow[] = []) =>
  applyFilters(tasks, f, fields(props)).map((t) => t.id);

describe('fieldsFor', () => {
  it('drops the work fields for a data database', () => {
    const keys = fieldsFor({ mode: 'data', props: [], users: [], kinds: [], sprints: [] }).map((f) => f.key);
    expect(keys).toEqual(['title']);
  });

  it('offers no filter on a relation, which is not stored on the row', () => {
    const keys = fields([prop({ type: 'relation' })]).map((f) => f.key);
    expect(keys).not.toContain('prop:p1');
  });

  it('carries a select property’s options through', () => {
    const f = fields([prop({ type: 'select', options: [{ id: 'o1', label: 'High', color: 'red' }] })]);
    expect(f.find((x) => x.key === 'prop:p1')?.options).toEqual([{ value: 'o1', label: 'High' }]);
  });
});

describe('applyFilters', () => {
  const a = task({ id: 'a', title: 'Ship the deck', status: 'todo', assignee_id: 'u1', due_at: '2026-09-10T00:00:00Z' });
  const b = task({ id: 'b', title: 'Fix login', status: 'done', assignee_id: null, due_at: '2026-09-20' });
  const all = [a, b];

  it('returns everything when nothing is set', () => {
    expect(run(all, [])).toEqual(['a', 'b']);
  });

  it('ignores a filter whose value is still blank', () => {
    expect(run(all, [filter({ field: 'title', op: 'contains', value: '' })])).toEqual(['a', 'b']);
  });

  it('ignores a filter on a field that no longer exists', () => {
    expect(run(all, [filter({ field: 'prop:gone', op: 'is', value: 'x' })])).toEqual(['a', 'b']);
  });

  it('matches text case-insensitively', () => {
    expect(run(all, [filter({ op: 'contains', value: 'LOGIN' })])).toEqual(['b']);
  });

  it('ANDs multiple filters', () => {
    expect(run(all, [
      filter({ id: 'f1', field: 'status', op: 'is', value: 'todo' }),
      filter({ id: 'f2', field: 'assignee_id', op: 'is', value: 'u1' }),
    ])).toEqual(['a']);
  });

  it('counts an unset cell as "is not"', () => {
    expect(run(all, [filter({ field: 'assignee_id', op: 'is_not', value: 'u1' })])).toEqual(['b']);
  });

  it('compares dates by day, ignoring any time part', () => {
    expect(run(all, [filter({ field: 'due_at', op: 'on', value: '2026-09-10' })])).toEqual(['a']);
    expect(run(all, [filter({ field: 'due_at', op: 'before', value: '2026-09-15' })])).toEqual(['a']);
    expect(run(all, [filter({ field: 'due_at', op: 'after', value: '2026-09-15' })])).toEqual(['b']);
  });

  it('never matches a date comparison against an empty cell', () => {
    const none = task({ id: 'c', due_at: null });
    expect(run([none], [filter({ field: 'due_at', op: 'before', value: '2100-01-01' })])).toEqual([]);
  });

  it('finds empty and non-empty cells', () => {
    expect(run(all, [filter({ field: 'assignee_id', op: 'is_empty', value: '' })])).toEqual(['b']);
    expect(run(all, [filter({ field: 'assignee_id', op: 'is_not_empty', value: '' })])).toEqual(['a']);
  });

  it('compares numbers numerically, not as strings', () => {
    const rows = [task({ id: 'x', progress: 9 }), task({ id: 'y', progress: 100 })];
    expect(run(rows, [filter({ field: 'progress', op: 'gt', value: '10' })])).toEqual(['y']);
  });

  it('matches a multi-select when the value is one of several', () => {
    const p = prop({ type: 'multi_select', options: [{ id: 'o1', label: 'A', color: 'red' }] });
    const rows = [task({ id: 'x', props: { p1: ['o1', 'o2'] } }), task({ id: 'y', props: { p1: ['o2'] } })];
    expect(run(rows, [filter({ field: 'prop:p1', op: 'is', value: 'o1' })], [p])).toEqual(['x']);
  });

  it('treats an unchecked checkbox as false rather than empty', () => {
    const p = prop({ type: 'checkbox' });
    const rows = [task({ id: 'x', props: { p1: true } }), task({ id: 'y', props: {} })];
    expect(run(rows, [filter({ field: 'prop:p1', op: 'is', value: 'false' })], [p])).toEqual(['y']);
  });
});

describe('newFilter', () => {
  it('starts on the field’s first operator', () => {
    const due = fields().find((f) => f.key === 'due_at')!;
    expect(newFilter(due).op).toBe('on');
  });

  it('defaults a checkbox to checked, since it has no empty state', () => {
    const p = prop({ type: 'checkbox' });
    const f = fields([p]).find((x) => x.key === 'prop:p1')!;
    expect(newFilter(f).value).toBe('true');
  });
});

describe('needsValue', () => {
  it('is false only for the two emptiness operators', () => {
    expect(needsValue('is_empty')).toBe(false);
    expect(needsValue('is_not_empty')).toBe(false);
    expect(needsValue('is')).toBe(true);
  });
});
