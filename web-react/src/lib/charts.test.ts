import { describe, expect, it } from 'vitest';
import { burndown, linePoints, mondayOf, statusMix, throughput, velocity } from './charts';
import type { SprintRow, TaskRow } from './tasksApi';

const task = (t: Partial<TaskRow>): TaskRow => ({
  id: Math.random().toString(36), project_id: 'p', title: 't', status: 'todo',
  assignee_id: null, assignee_name: null, assignees: [], start_at: null, due_at: null,
  priority: 0, progress: 0, points: null, milestone: false, doc_id: null, parent_id: null,
  kind: 'task', sprint_id: null, position: 0, done_at: null, deps: [], props: {}, ...t,
} as TaskRow);

const sprint = (s: Partial<SprintRow>): SprintRow => ({
  id: 's', project_id: 'p', name: 'Sprint 1', start_at: '2026-03-02', end_at: '2026-03-06',
  state: 'active', total: '0', done: '0', points: '0', points_done: '0', ...s,
} as SprintRow);

describe('burndown', () => {
  const s = sprint({});

  it('draws the ideal line from the whole scope to zero', () => {
    const b = burndown([task({ points: 5 }), task({ points: 3 })], s, '2026-03-06')!;
    expect(b.total).toBe(8);
    expect(b.days).toHaveLength(5);
    expect(b.ideal[0]).toBe(8);
    expect(b.ideal[4]).toBe(0);
  });

  it('burns a task down on the day it was finished', () => {
    const b = burndown([
      task({ points: 5, done_at: '2026-03-03' }),
      task({ points: 3 }),
    ], s, '2026-03-06')!;
    expect(b.actual).toEqual([8, 3, 3, 3, 3]);
  });

  it('stops the actual line at today rather than flattening into the future', () => {
    // A flat line to the end of the sprint reads as four days of no progress,
    // which is a claim about days that have not happened.
    const b = burndown([task({ points: 5 })], s, '2026-03-03')!;
    expect(b.actual).toHaveLength(2);
    expect(b.days).toHaveLength(5);
  });

  it('counts work finished before the sprint started as already burned', () => {
    const b = burndown([
      task({ points: 4, done_at: '2026-02-20' }),
      task({ points: 6 }),
    ], s, '2026-03-06')!;
    expect(b.actual[0]).toBe(6);
  });

  it('counts unsized tasks as one each rather than as nothing', () => {
    const b = burndown([task({}), task({}), task({ done_at: '2026-03-02' })], s, '2026-03-06')!;
    expect(b.total).toBe(3);
    expect(b.pointed).toBe(false);
    expect(b.actual[0]).toBe(2);
  });

  it('refuses to draw a sprint with no dates', () => {
    expect(burndown([task({})], sprint({ start_at: null }))).toBeNull();
    expect(burndown([task({})], null)).toBeNull();
  });
});

describe('velocity', () => {
  it('reports only finished sprints', () => {
    // A sprint two days in has finished almost nothing; a short bar beside the
    // finished ones reads as a collapse in output.
    const bars = velocity([
      sprint({ id: 'a', state: 'done', points: '20', points_done: '18' }),
      sprint({ id: 'b', state: 'active', points: '20', points_done: '2' }),
    ]);
    expect(bars.map((b) => b.id)).toEqual(['a']);
    expect(bars[0].done).toBe(18);
  });

  it('falls back to task counts where nothing is sized', () => {
    const bars = velocity([sprint({ state: 'done', points: '0', total: '9', done: '7' })]);
    expect(bars[0].done).toBe(7);
  });
});

describe('throughput', () => {
  it('keeps empty weeks, because the gaps are the information', () => {
    const weeks = throughput([task({ done_at: '2026-03-04' })], 4, '2026-03-05');
    expect(weeks).toHaveLength(4);
    expect(weeks.map((w) => w.count)).toEqual([0, 0, 0, 1]);
    expect(weeks[3].week).toBe('2026-03-02');
  });

  it('ignores work finished outside the window, and work not finished at all', () => {
    const weeks = throughput([
      task({ done_at: '2025-01-01' }),
      task({ status: 'doing' }),
    ], 4, '2026-03-05');
    expect(weeks.every((w) => w.count === 0)).toBe(true);
  });
});

describe('mondayOf', () => {
  it('walks back to Monday, and treats Sunday as the end of its week', () => {
    expect(mondayOf('2026-03-04')).toBe('2026-03-02'); // Wednesday
    expect(mondayOf('2026-03-02')).toBe('2026-03-02'); // Monday itself
    expect(mondayOf('2026-03-08')).toBe('2026-03-02'); // Sunday
  });
});

describe('statusMix', () => {
  it('counts every status, including the ones at zero', () => {
    const mix = statusMix([task({ status: 'todo' }), task({ status: 'done' })]);
    expect(mix).toEqual([
      { status: 'todo', count: 1 }, { status: 'doing', count: 0 },
      { status: 'review', count: 0 }, { status: 'done', count: 1 },
    ]);
  });
});

describe('linePoints', () => {
  it('scales to the max it is given, not to its own values', () => {
    // Both lines of a burndown share one scale; a per-line max would land the
    // ideal and the actual on the same pixel whatever happened.
    expect(linePoints([10, 5, 0], 10, 100, 50, 3)).toBe('0,0 50,25 100,50');
    expect(linePoints([5], 10, 100, 50, 3)).toBe('0,25');
  });

  it('survives an empty chart without dividing by zero', () => {
    expect(linePoints([0, 0], 0, 100, 50, 2)).toBe('0,50 100,50');
    expect(linePoints([1], 1, 100, 50, 1)).toBe('0,0');
  });
});
