// Sorting for the project views. Pure, like taskFilter beside it, so every tab
// draws the same already-ordered list and the rule can be tested without a DOM.
import type { FilterField } from './taskFilter';
import type { TaskRow } from './tasksApi';

export interface SortRule {
  id: string;
  /** The same key space FilterField uses — a column, or `prop:<id>`. */
  field: string;
  dir: 'asc' | 'desc';
}

/** The cell a rule reads, before it is reduced to something orderable. */
function rawValue(task: TaskRow, field: FilterField): unknown {
  if (field.key.startsWith('prop:')) return task.props?.[field.key.slice(5)] ?? null;
  // People and focus areas are lists; sort by the first, which is the one the
  // card shows first. Sorting by a set has no single right answer, and this is
  // the one a reader can predict from what is in front of them.
  if (field.key === 'assignee_id') return task.assignees?.[0]?.name ?? null;
  if (field.key === 'tags') return task.tags ?? null;
  return (task as unknown as Record<string, unknown>)[field.key] ?? null;
}

/**
 * The value a rule compares, reduced to something orderable.
 *
 * Select fields sort by their option *order*, not alphabetically: "To do, In
 * progress, Review, Done" is the sequence people mean by "sort by status", and
 * sorting those four labels by name gives "Done, In progress, Review, To do" —
 * which is not a thing anyone wants. The option list is already in the right
 * order, so its index is the key.
 */
function sortKey(task: TaskRow, field: FilterField): string | number | null {
  let raw = rawValue(task, field);
  if (Array.isArray(raw)) raw = raw.length ? raw[0] : null;
  if (raw === null || raw === undefined || raw === '') return null;
  if (field.kind === 'checkbox') return raw ? 1 : 0;
  if (field.kind === 'number') return Number(raw);
  if (field.options?.length) {
    const i = field.options.findIndex((o) => o.value === String(raw));
    if (i >= 0) return i;
  }
  // Dates are ISO, so string order is date order — no parsing needed.
  return String(raw).toLowerCase();
}

/** `null` last in both directions: an unset cell is not "smallest", it is
 *  missing, and burying the blanks is what both directions actually want. */
function compare(a: string | number | null, b: string | number | null, dir: 'asc' | 'desc'): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  const cmp = typeof a === 'number' && typeof b === 'number'
    ? a - b
    : String(a).localeCompare(String(b));
  return dir === 'desc' ? -cmp : cmp;
}

/**
 * Order by each rule in turn, the first that disagrees deciding.
 *
 * Returns the same array when there is nothing to do, so an unsorted view
 * keeps the server's order — which is the manual one a drag on the board
 * writes, and re-sorting it by nothing would quietly throw that away.
 */
export function applySort<T extends TaskRow>(tasks: T[], sort: SortRule[], fields: FilterField[]): T[] {
  const rules = sort
    .map((s) => [s, fields.find((f) => f.key === s.field)] as const)
    .filter((pair): pair is readonly [SortRule, FilterField] => !!pair[1]);
  if (!rules.length) return tasks;
  // Sort a copy: the caller's list is React state elsewhere.
  return [...tasks].sort((x, y) => {
    for (const [rule, field] of rules) {
      const c = compare(sortKey(x, field), sortKey(y, field), rule.dir);
      if (c !== 0) return c;
    }
    return 0;
  });
}

/** Drop rules naming a field this database no longer has — the same care
 *  `pruneUnresolvable` takes with filters, for the same reason. */
export function pruneSort(sort: SortRule[], fields: FilterField[]): SortRule[] {
  const known = new Set(fields.map((f) => f.key));
  return sort.filter((s) => known.has(s.field));
}

export const newSortRule = (field: FilterField): SortRule => ({
  id: crypto.randomUUID(),
  field: field.key,
  dir: 'asc',
});
