// Formula and rollup values.
//
// Neither is stored: both are derived from other cells every time they are
// read, which is why `coercePropValue` refuses to write them. They are
// materialised into a shallow copy of each row's `props` before anything else
// looks at the list — so filtering, sorting, grouping, the table, the cards and
// the peek all see them as ordinary values, with no further teaching.
import { evaluate, type Value } from './formula';
import type { PropRow, TaskRow } from './tasksApi';
import { selectedOptions } from './props';

/** What a rollup does with the values it gathers. Mirrors ROLLUP_FUNCTIONS in
 *  server/src/props.js. */
export type RollupFn =
  | 'count' | 'count_values' | 'count_unique' | 'sum' | 'average' | 'min' | 'max'
  | 'earliest' | 'latest' | 'percent_checked' | 'show_original';

export const ROLLUP_LABEL: Record<RollupFn, string> = {
  count: 'Count of linked rows',
  count_values: 'Count of values',
  count_unique: 'Count of unique values',
  sum: 'Sum',
  average: 'Average',
  min: 'Minimum',
  max: 'Maximum',
  earliest: 'Earliest date',
  latest: 'Latest date',
  percent_checked: 'Percent checked',
  show_original: 'Show the values',
};

const isSet = (v: unknown) => v !== null && v !== undefined && v !== '';
const nums = (vs: unknown[]) => vs.map(Number).filter((n) => Number.isFinite(n));

/** Reduce the values gathered from the linked rows. */
export function reduceRollup(fn: RollupFn, values: unknown[], linked: number): Value {
  const present = values.filter(isSet);
  switch (fn) {
    // Deliberately the number of linked ROWS, not of values: "how many tasks
    // does this epic have" is the question, and a row with the target cell
    // blank is still one of them.
    case 'count': return linked;
    case 'count_values': return present.length;
    case 'count_unique': return new Set(present.map((v) => String(v))).size;
    case 'sum': return nums(present).reduce((a, b) => a + b, 0);
    case 'average': {
      const n = nums(present);
      return n.length ? n.reduce((a, b) => a + b, 0) / n.length : null;
    }
    case 'min': { const n = nums(present); return n.length ? Math.min(...n) : null; }
    case 'max': { const n = nums(present); return n.length ? Math.max(...n) : null; }
    // Dates are ISO, so string order is date order.
    case 'earliest': { const d = present.map(String).sort(); return d[0] ?? null; }
    case 'latest': { const d = present.map(String).sort(); return d[d.length - 1] ?? null; }
    case 'percent_checked': {
      if (!values.length) return null;
      return Math.round((values.filter(Boolean).length / values.length) * 100);
    }
    case 'show_original': return present.map((v) => String(v)).join(', ') || null;
    default: return null;
  }
}

/** A property's value on a row, reduced to something a formula can work with. */
function plainValue(task: TaskRow, prop: PropRow, users: { id: string; name: string }[]): Value {
  const raw = task.props?.[prop.id] ?? null;
  switch (prop.type) {
    case 'select':
    case 'multi_select':
      // The label, not the id: a formula is written against what a person can
      // see in the cell, and an option id is a uuid.
      return selectedOptions(prop, raw).map((o) => o.label).join(', ') || null;
    case 'person':
      return users.find((u) => u.id === raw)?.name ?? null;
    case 'file':
      return Array.isArray(raw) ? raw.length : 0;
    case 'checkbox':
      return !!raw;
    case 'number':
      return typeof raw === 'number' ? raw : null;
    default:
      return typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean' ? raw : null;
  }
}

/** The built-in columns a formula can name, by the label they show under. */
function builtinValue(task: TaskRow, label: string): Value | undefined {
  switch (label.toLowerCase()) {
    case 'name': case 'task': case 'title': return task.title;
    case 'status': return task.status;
    case 'type': return task.kind;
    case 'start': return task.start_at;
    case 'due': return task.due_at;
    case 'points': return task.points;
    case 'progress': return task.progress;
    case 'milestone': return task.milestone;
    case 'assignees': case 'assignee': return task.assignees?.map((a) => a.name).join(', ') || null;
    case 'focus area': return task.tags?.join(', ') || null;
    default: return undefined;
  }
}

export interface ComputeContext {
  props: PropRow[];
  users: { id: string; name: string }[];
  /** Rows of the databases this one links to, by task id — for rollups. */
  linkedRows: Map<string, TaskRow>;
  /** Properties of those databases, by id — for reading a rollup's target. */
  linkedProps: Map<string, PropRow>;
  now?: () => Date;
}

/**
 * Every row with its formula and rollup cells filled in.
 *
 * Returns the same array when the database has no computed property, so the
 * common case costs nothing and the caller's identity checks still hold.
 *
 * A formula cannot read another formula: one pass, in definition order, and a
 * reference to a computed cell reads as empty. That is a real limit and a
 * deliberate one — the alternative is a dependency graph and cycle detection
 * for a feature whose first use is `prop("Points") * 2`.
 */
export function withComputed(tasks: TaskRow[], ctx: ComputeContext): TaskRow[] {
  const computed = ctx.props.filter((p) => p.type === 'formula' || p.type === 'rollup');
  if (!computed.length) return tasks;

  const byLabel = new Map(ctx.props.map((p) => [p.label.toLowerCase(), p]));

  return tasks.map((task) => {
    const extra: Record<string, unknown> = {};
    for (const prop of computed) {
      if (prop.type === 'formula') {
        const expression = String((prop.config as { expression?: string } | undefined)?.expression ?? '');
        if (!expression.trim()) { extra[prop.id] = null; continue; }
        const { value, error } = evaluate(expression, {
          prop: (label) => {
            const named = byLabel.get(label.toLowerCase());
            if (named && named.type !== 'formula' && named.type !== 'rollup') return plainValue(task, named, ctx.users);
            const built = builtinValue(task, label);
            return built === undefined ? null : built;
          },
          now: ctx.now ?? (() => new Date()),
        });
        // The message goes in the cell, where whoever wrote the formula can
        // see it — a table of two hundred rows must not blank over one typo.
        extra[prop.id] = error ? `⚠ ${error}` : value;
        continue;
      }
      const config = (prop.config ?? {}) as { relation?: string; target?: string; fn?: RollupFn };
      const ids = (task.relationIds?.[config.relation ?? ''] ?? []) as string[];
      const target = config.target ? ctx.linkedProps.get(config.target) : null;
      const values = ids.map((id) => {
        const row = ctx.linkedRows.get(id);
        if (!row) return null;
        return target ? plainValue(row, target, ctx.users) : row.title;
      });
      extra[prop.id] = reduceRollup(config.fn ?? 'count', values, ids.length);
    }
    return { ...task, props: { ...task.props, ...extra } };
  });
}
