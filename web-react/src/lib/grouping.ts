// Which columns a board draws, and what dropping a card into one means.
//
// The board grouped by status and only by status: `STATUSES.map(...)`, four
// columns, hard-coded. Notion groups by any select, person or checkbox, and
// "show me this sprint's work by assignee" is an ordinary question the board
// simply could not answer.
import { swatch } from './tagColors';
import type { FilterField } from './taskFilter';
import type { TaskRow } from './tasksApi';

export interface BoardGroup {
  /** '' is the "not set" column — every board needs somewhere to put the rows
   *  that have no value for what it is grouped by, or they vanish. */
  value: string;
  label: string;
  /** A tailwind class for the header dot. */
  dot: string;
}

/**
 * The status palette the board has always drawn, kept so a board nobody has
 * repainted looks exactly as it did.
 *
 * Exported because `TasksView` draws the same four states across projects, and
 * this used to be two identical private copies — one here, one in Board.tsx,
 * whose own comment predicted they would drift within a week.
 */
export const STATUS_DOT: Record<string, string> = {
  todo: 'bg-line-strong',
  doing: 'bg-accent',
  review: 'bg-amber-400',
  done: 'bg-emerald-500',
};

/** Fields a board can be grouped by. A date has no natural set of columns
 *  without bucketing it first (by day? week? month?), and a free-text field
 *  would give one column per row — neither is a grouping, it is a listing. */
export const canGroupBy = (field: FilterField) =>
  field.kind === 'select' || field.kind === 'multi_select'
  || field.kind === 'person' || field.kind === 'checkbox';

/**
 * The columns for a field, in the field's own option order.
 *
 * `colors` maps an option value to a palette name where the caller knows one —
 * statuses and select options carry colours the rest of the app already paints
 * them in, and a board whose columns disagree with the chips inside them reads
 * as two different vocabularies.
 */
export function groupsFor(field: FilterField, colors: Record<string, string> = {}): BoardGroup[] {
  if (field.kind === 'checkbox') {
    return [
      { value: 'true', label: `${field.label}`, dot: 'bg-emerald-500' },
      { value: 'false', label: `Not ${field.label.toLowerCase()}`, dot: 'bg-line-strong' },
    ];
  }
  const groups = (field.options ?? []).map((o) => ({
    value: o.value,
    label: o.label,
    // The project's own choice first, the built-in palette only as the fallback.
    // These were the other way round, so a project that repainted Review to
    // purple got purple in its status property and in the peek — and a yellow
    // dot on the board column, because the hard-coded map short-circuited the
    // `??` before the repaint was ever consulted.
    dot: colors[o.value] ? swatch(colors[o.value]).dot : (STATUS_DOT[o.value] ?? 'bg-line-strong'),
  }));
  // Status is the one field where "not set" cannot happen — every task has one
  // of the four — so it alone gets no empty column.
  if (field.key === 'status') return groups;
  return [...groups, { value: '', label: `No ${field.label.toLowerCase()}`, dot: 'bg-line' }];
}

/**
 * What dropping a card into a column writes to a property. A person or
 * multi-select property holds a list, so the column's one value goes in as a
 * list of one — a bare string there is not a valid value for either.
 */
export function groupValue(field: FilterField, value: string): unknown {
  if (!value) return null;
  return field.kind === 'person' || field.kind === 'multi_select' ? [value] : value;
}

/**
 * What moving `task` into the column for `value` writes. For a single-value
 * field that is just the column's value. A person or multi-select field holds
 * a list, and the card sits in its first entry's column — so the move swaps
 * that entry for the new one and keeps the rest. Writing the column's value
 * alone (what this did) dropped every other reviewer the card had.
 * Dropping into the empty column clears the field.
 */
export function movedValue(field: FilterField, task: TaskRow | undefined, value: string): unknown {
  if (!value || !(field.kind === 'person' || field.kind === 'multi_select')) return groupValue(field, value);
  const raw: unknown = field.key.startsWith('prop:')
    ? task?.props?.[field.key.slice(5)] ?? null
    : field.key === 'assignee_id'
      ? (task?.assignees?.map((a) => a.id) ?? [])
      : null;
  const current = (Array.isArray(raw) ? raw : raw ? [raw] : []).map(String);
  const from = current[0];
  return [value, ...current.filter((v) => v !== value && v !== from)];
}

/** The column a task belongs in. A multi-value cell lands in its first value's
 *  column, the same choice the sort makes for the same reason. */
export function groupOf(task: TaskRow, field: FilterField): string {
  let raw: unknown = field.key.startsWith('prop:')
    ? task.props?.[field.key.slice(5)] ?? null
    : field.key === 'assignee_id'
      ? (task.assignees?.map((a) => a.id) ?? [])
      : (task as unknown as Record<string, unknown>)[field.key] ?? null;
  if (Array.isArray(raw)) raw = raw.length ? raw[0] : null;
  if (raw === null || raw === undefined || raw === '') return '';
  if (field.kind === 'checkbox') return raw ? 'true' : 'false';
  return String(raw);
}

/**
 * Grouping by epic. Not a column on the task — a row's epic is whichever
 * container it sits under, however deep — so it is a field made here rather
 * than one of the filter fields, and `EPIC_KEY` is what a view saves as its
 * `groupBy`.
 */
export const EPIC_KEY = 'epic';

/** The container rows a list is grouped into, in the order their groups are
 *  drawn: by their own manual position, then by key number. */
export function epicsOf(tasks: TaskRow[], isGroup: (t: TaskRow) => boolean): TaskRow[] {
  return tasks
    .filter(isGroup)
    .sort((a, b) => a.position - b.position || (a.num ?? 0) - (b.num ?? 0));
}

/** The grouping field for a list's epics; `groupsFor` adds "No epic". */
export function epicField(epics: TaskRow[]): FilterField {
  return {
    key: EPIC_KEY,
    label: 'Epic',
    kind: 'select',
    options: epics.map((t) => ({ value: t.id, label: t.title || 'Untitled' })),
  };
}

/**
 * The epic a row belongs to: itself when it is one, else its nearest
 * container ancestor, else '' — the "No epic" group. A task under a story
 * under an epic is that epic's work, so it walks past the story.
 */
export function epicOf(task: TaskRow, byId: Map<string, TaskRow>, isGroup: (t: TaskRow) => boolean): string {
  const seen = new Set<string>();
  let cursor: TaskRow | undefined = task;
  while (cursor && !seen.has(cursor.id)) {
    if (isGroup(cursor)) return cursor.id;
    seen.add(cursor.id);
    cursor = cursor.parent_id ? byId.get(cursor.parent_id) : undefined;
  }
  return '';
}

/** A group's header line in a grouped list, carried among the rows. */
export interface GroupLine {
  group: BoardGroup;
  count: number;
}

/**
 * A list's rows with a header line before each group, in the groups' order.
 * Empty groups are left out: a table is read top to bottom, and a heading
 * with nothing under it is a gap the eye has to cross for nothing.
 * Rows within a group keep the order they came in, so the view's sort holds.
 */
export function withGroupLines<T>(rows: T[], groups: BoardGroup[], groupOf: (row: T) => string): (T | GroupLine)[] {
  const out: (T | GroupLine)[] = [];
  for (const group of groups) {
    const inGroup = rows.filter((r) => groupOf(r) === group.value);
    if (!inGroup.length) continue;
    out.push({ group, count: inGroup.length }, ...inGroup);
  }
  return out;
}

export const isGroupLine = (line: unknown): line is GroupLine =>
  typeof line === 'object' && line !== null && 'group' in line && 'count' in line;
