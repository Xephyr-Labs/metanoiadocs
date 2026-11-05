import { describe, expect, it } from 'vitest';
import { bucketLabel, chartFields, colorOf, formatValue, niceScale, ordered, OTHER } from './chartView';
import type { FilterField } from './taskFilter';
import type { PropRow } from './tasksApi';

const status: FilterField = {
  key: 'status', label: 'Status', kind: 'select',
  options: [{ value: 'todo', label: 'To do' }, { value: 'doing', label: 'Doing' }, { value: 'done', label: 'Done' }],
};
const who: FilterField = { key: 'assignee_id', label: 'Assignee', kind: 'person', options: [{ value: 'u1', label: 'Ada' }] };
const ctx = { statusColors: { doing: 'purple' }, kindColors: {}, props: [] as PropRow[] };

describe('chart view helpers', () => {
  it('puts a status axis in board order, with Other last', () => {
    const out = ordered({
      buckets: [{ key: 'done', value: 5 }, { key: OTHER, value: 1 }, { key: 'todo', value: 3 }],
      series: [{ key: '', values: [5, 1, 3] }],
      tasks: 9, ignored: [],
    }, status, undefined);
    expect(out.buckets.map((b) => b.key)).toEqual(['todo', 'done', OTHER]);
    expect(out.series[0].values).toEqual([3, 5, 1]);
  });

  it('keeps the largest-first order for people, but "nobody" goes last', () => {
    const out = ordered({
      buckets: [{ key: '', value: 9 }, { key: 'u2', value: 4 }, { key: 'u1', value: 2 }],
      series: [{ key: '', values: [9, 4, 2] }],
      tasks: 15, ignored: [],
    }, who, undefined);
    expect(out.buckets.map((b) => b.key)).toEqual(['u2', 'u1', '']);
  });

  it('names buckets the way the rest of the app does', () => {
    expect(bucketLabel('todo', status, 'week')).toBe('To do');
    expect(bucketLabel('', who, 'week')).toBe('No assignee');
    expect(bucketLabel(OTHER, who, 'week')).toBe('Other');
    expect(bucketLabel('false', { key: 'milestone', label: 'Milestone', kind: 'checkbox' }, 'week')).toBe('Not milestone');
    expect(bucketLabel('', { key: 'due_at', label: 'Due', kind: 'date' }, 'week')).toBe('No date');
    // A month bucket is read in UTC, so it is never the month before.
    expect(bucketLabel('2026-11-01', { key: 'due_at', label: 'Due', kind: 'date' }, 'month')).toMatch(/Nov/);
  });

  it('paints a status in the project\'s own colour', () => {
    expect(colorOf('doing', status, 0, ctx)).toBe('purple');
    expect(colorOf('done', status, 0, ctx)).toBe('green');
    expect(colorOf('', who, 3, ctx)).toBe('gray');
    expect(colorOf('u1', who, 0, ctx)).not.toBe(colorOf('u2', who, 1, ctx));
  });

  it('rounds the value axis to numbers people say', () => {
    expect(niceScale(7)).toEqual({ top: 8, step: 2 });
    expect(niceScale(37)).toEqual({ top: 40, step: 10 });
    expect(niceScale(0)).toEqual({ top: 1, step: 1 });
    expect(formatValue(2.5)).toBe('2.5');
    expect(formatValue(1 / 3)).toBe('0.33');
  });

  it('offers no computed property, which the server cannot count', () => {
    const props = [{ id: 'fx', type: 'rollup', options: [] }] as unknown as PropRow[];
    const f = chartFields([status, { key: 'prop:fx', label: 'Sum', kind: 'number' }, { key: 'due_at', label: 'Due', kind: 'date' }], props, 'tasks');
    expect(f.numbers).toEqual([]);
    expect(f.dates.map((d) => d.key)).toEqual(['due_at', 'done_at']);
  });
});
