/**
 * The Tasks view's first question — open, overdue, done or everything — kept
 * apart from the filter chips. "Overdue" is relative to today, which a chip's
 * fixed date cannot say, and "not done" was a chip people had to build by hand.
 */
export type TaskScope = 'open' | 'overdue' | 'done' | 'all';

export const TASK_SCOPES: TaskScope[] = ['open', 'overdue', 'done', 'all'];

interface Scoped { status: string; due_at?: string | null }

/** Same rule the list uses to paint a date red: due before today, not done. */
export const isOverdue = (t: Scoped, today: string) =>
  !!t.due_at && t.status !== 'done' && t.due_at.slice(0, 10) < today;

export function inScope(t: Scoped, scope: TaskScope, today: string): boolean {
  if (scope === 'open') return t.status !== 'done';
  if (scope === 'done') return t.status === 'done';
  if (scope === 'overdue') return isOverdue(t, today);
  return true;
}

export function scopeCounts(tasks: Scoped[], today: string): Record<TaskScope, number> {
  const out = { open: 0, overdue: 0, done: 0, all: tasks.length };
  for (const t of tasks) {
    if (t.status === 'done') out.done++;
    else out.open++;
    if (isOverdue(t, today)) out.overdue++;
  }
  return out;
}

/**
 * The first-visit starting set used to include a `status is none of done`
 * chip. The scope switch owns that question now, and the old chip left behind
 * in a browser would make "Done" show nothing, so it is dropped on read.
 */
export function dropLegacyOpenChip<F extends { field: string; op: string; value: unknown }>(filters: F[]): F[] {
  return filters.filter((f) => !(
    f.field === 'status' && f.op === 'is_none_of'
    && (f.value === 'done' || (Array.isArray(f.value) && f.value.length === 1 && f.value[0] === 'done'))
  ));
}
