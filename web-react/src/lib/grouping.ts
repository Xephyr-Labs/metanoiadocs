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
