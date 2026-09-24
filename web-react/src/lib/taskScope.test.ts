import { describe, expect, it } from 'vitest';
import { dropLegacyOpenChip, inScope, scopeCounts } from './taskScope';

const today = '2026-09-24';
const tasks = [
  { status: 'todo', due_at: '2026-09-20T00:00:00Z' }, // overdue
  { status: 'doing', due_at: '2026-09-24' },          // due today: not overdue
  { status: 'review', due_at: null },
  { status: 'done', due_at: '2026-09-01' },           // late but done: not overdue
];

describe('taskScope', () => {
  it('splits open, overdue, done and all', () => {
    const pick = (s: Parameters<typeof inScope>[1]) => tasks.filter((t) => inScope(t, s, today)).length;
    expect(pick('open')).toBe(3);
    expect(pick('overdue')).toBe(1);
    expect(pick('done')).toBe(1);
    expect(pick('all')).toBe(4);
    expect(scopeCounts(tasks, today)).toEqual({ open: 3, overdue: 1, done: 1, all: 4 });
  });

  it('drops only the old seeded "not done" chip', () => {
    const f = [
      { field: 'status', op: 'is_none_of', value: 'done' },
      { field: 'status', op: 'is_none_of', value: ['done'] },
      { field: 'status', op: 'is_any_of', value: 'review' },
      { field: 'assignee_id', op: 'is', value: 'u1' },
    ];
    expect(dropLegacyOpenChip(f).map((x) => x.field + x.op)).toEqual(['statusis_any_of', 'assignee_idis']);
  });
});
