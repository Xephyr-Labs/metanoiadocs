import { describe, expect, it } from 'vitest';
import { reduceRollup, withComputed, type ComputeContext } from './computed';
import type { PropRow, TaskRow } from './tasksApi';

const prop = (over: Partial<PropRow>): PropRow => ({
  id: over.id ?? 'p',
  project_id: 'proj',
  key: over.key ?? 'k',
  label: over.label ?? 'Prop',
  type: over.type ?? 'text',
  options: over.options ?? [],
  target_project_id: null,
  position: 0,
  ...over,
});

const task = (over: Partial<TaskRow>): TaskRow => ({
  id: over.id ?? 't',
  project_id: 'proj',
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

const ctx = (over: Partial<ComputeContext> = {}): ComputeContext => ({
  props: [],
  users: [],
  linkedRows: new Map(),
  linkedProps: new Map(),
  // Local midnight — `now()` reads as the reader's calendar day (see formula.test).
  now: () => new Date(2026, 8, 15),
  ...over,
});

describe('withComputed', () => {
  it('returns the same array when nothing is computed', () => {
    // The common case must cost nothing, and the caller's identity checks
    // have to keep holding.
    const rows = [task({})];
    expect(withComputed(rows, ctx({ props: [prop({ type: 'text' })] }))).toBe(rows);
  });

  it('fills a formula from another property', () => {
    const points = prop({ id: 'pt', label: 'Estimate', type: 'number' });
    const doubled = prop({ id: 'f', label: 'Doubled', type: 'formula', config: { expression: 'prop("Estimate") * 2' } });
    const [row] = withComputed(
      [task({ props: { pt: 7 } })],
      ctx({ props: [points, doubled] }),
    );
    expect(row.props.f).toBe(14);
  });

  it('reads a built-in column by the label it shows under', () => {
    const f = prop({ id: 'f', type: 'formula', config: { expression: 'dateDiff(now(), prop("Due"))' } });
    const [row] = withComputed([task({ due_at: '2026-09-20' })], ctx({ props: [f] }));
    expect(row.props.f).toBe(5);
  });

  it('puts a broken formula in the cell rather than blanking the table', () => {
    const f = prop({ id: 'f', type: 'formula', config: { expression: 'prop("A" * 2' } });
    const [row] = withComputed([task({})], ctx({ props: [f] }));
    expect(String(row.props.f)).toMatch(/^⚠/);
  });

  it('does not let one formula read another', () => {
    // One pass, in definition order — a dependency graph is a much larger
    // feature than the first use of this one warrants.
    const a = prop({ id: 'a', label: 'A', type: 'formula', config: { expression: '2' } });
    const b = prop({ id: 'b', label: 'B', type: 'formula', config: { expression: 'prop("A") + 1' } });
    const [row] = withComputed([task({})], ctx({ props: [a, b] }));
    expect(row.props.b).toBe(1);
  });

  it('rolls up a value from the linked rows', () => {
    const relation = prop({ id: 'rel', label: 'Tasks', type: 'relation' });
    const targetPoints = prop({ id: 'tp', label: 'Points', type: 'number' });
    const roll = prop({
      id: 'r', label: 'Total', type: 'rollup',
      config: { relation: 'rel', target: 'tp', fn: 'sum' },
    });
    const [row] = withComputed(
      [task({ relationIds: { rel: ['x', 'y'] } })],
      ctx({
        props: [relation, roll],
        linkedRows: new Map([
          ['x', task({ id: 'x', props: { tp: 3 } })],
          ['y', task({ id: 'y', props: { tp: 4 } })],
        ]),
        linkedProps: new Map([['tp', targetPoints]]),
      }),
    );
    expect(row.props.r).toBe(7);
  });

  it('leaves the original rows untouched', () => {
    const f = prop({ id: 'f', type: 'formula', config: { expression: '1' } });
    const rows = [task({})];
    withComputed(rows, ctx({ props: [f] }));
    expect(rows[0].props.f).toBeUndefined();
  });
});

describe('reduceRollup', () => {
  it('counts linked rows, not values', () => {
    // "How many tasks does this epic have" — a row whose target cell is blank
    // is still one of them.
    expect(reduceRollup('count', [1, null, null], 3)).toBe(3);
    expect(reduceRollup('count_values', [1, null, null], 3)).toBe(1);
  });

  it('aggregates numbers, ignoring the blanks', () => {
    expect(reduceRollup('sum', [1, null, 2], 3)).toBe(3);
    expect(reduceRollup('average', [2, null, 4], 3)).toBe(3);
    expect(reduceRollup('min', [5, 2], 2)).toBe(2);
    expect(reduceRollup('max', [5, 2], 2)).toBe(5);
  });

  it('answers nothing rather than zero when there is nothing to average', () => {
    expect(reduceRollup('average', [], 0)).toBe(null);
    expect(reduceRollup('min', [null], 1)).toBe(null);
  });

  it('orders dates as strings, which for ISO is date order', () => {
    expect(reduceRollup('earliest', ['2026-03-01', '2026-01-09'], 2)).toBe('2026-01-09');
    expect(reduceRollup('latest', ['2026-03-01', '2026-01-09'], 2)).toBe('2026-03-01');
  });

  it('reports percent checked over every linked row', () => {
    expect(reduceRollup('percent_checked', [true, false, true, true], 4)).toBe(75);
    expect(reduceRollup('percent_checked', [], 0)).toBe(null);
  });
});
