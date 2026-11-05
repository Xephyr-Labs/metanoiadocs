// What a chart view draws, around the numbers the server counts.
//
// The server (server/src/chart.js) answers with raw keys — a status, a user
// id, a select option's id — because labels and colours are the client's
// vocabulary: the same option lists the filter bar and the board already read.
// Everything here is pure so it can be tested without a DOM.
import { STATUS_COLOR } from './builtinProps';
import { canGroupBy } from './grouping';
import type { FilterField } from './taskFilter';
import type { ChartConfig, ChartData, ProjectMode, PropRow } from './tasksApi';

/** The server's name for everything folded together past the cap. */
export const OTHER = '__other__';

/** When work was finished. Not a filter field — nobody filters on it — but it
 *  is the axis "how much did we finish each week" is drawn along. */
const DONE_FIELD: FilterField = { key: 'done_at', label: 'Done', kind: 'date' };

/** The fields a chart can be built from, by role. */
export function chartFields(fields: FilterField[], props: PropRow[], mode: ProjectMode) {
  // Computed properties are evaluated in the browser; the server cannot count them.
  const computed = new Set(props.filter((p) => p.type === 'formula' || p.type === 'rollup').map((p) => `prop:${p.id}`));
  const usable = fields.filter((f) => !computed.has(f.key) && f.key !== 'project_id');
  const categories = usable.filter(canGroupBy);
  const dates = usable.filter((f) => f.kind === 'date');
  if (mode !== 'data') dates.splice(dates.findIndex((f) => f.key === 'due_at') + 1, 0, DONE_FIELD);
  return { categories, dates, numbers: usable.filter((f) => f.kind === 'number'), all: [...categories, ...dates] };
}

/** A database's first chart: its work by status, or a data table's rows by week. */
export const defaultChart = (mode: ProjectMode): ChartConfig => ({
  type: mode === 'data' ? 'line' : 'bar',
  x: mode === 'data' ? 'created_at' : 'status',
  unit: 'week',
  measure: 'count',
  of: null,
  stack: null,
});

const fmt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(undefined, { timeZone: 'UTC', ...opts });
const DAY = fmt({ month: 'short', day: 'numeric' });
const MONTH = fmt({ month: 'short', year: 'numeric' });

/** What a bucket is called on the axis, in the legend and in the tooltip. */
export function bucketLabel(key: string, field: FilterField | undefined, unit: ChartConfig['unit']): string {
  if (key === OTHER) return 'Other';
  const name = field?.label ?? '';
  if (field?.kind === 'checkbox') return key === 'true' ? name : `Not ${name.toLowerCase()}`;
  if (!key) return field?.kind === 'date' ? 'No date' : `No ${name.toLowerCase()}`;
  if (field?.kind === 'date') {
    const at = new Date(`${key}T00:00:00Z`);
    if (Number.isNaN(at.getTime())) return key;
    return unit === 'month' ? MONTH.format(at) : unit === 'week' ? `Wk of ${DAY.format(at)}` : DAY.format(at);
  }
  return field?.options?.find((o) => o.value === key)?.label ?? key;
}

/**
 * The buckets in the order a reader expects them: a status or select in its
 * own option order — the order its board columns are in — and "not set" and
 * "Other" at the end. People and tags have no order of their own, so the
 * server's largest-first stands. Series are reordered the same way, and each
 * series' values move with their bucket.
 */
export function ordered(data: ChartData, x: FilterField | undefined, stack: FilterField | undefined): ChartData {
  const rank = (field: FilterField | undefined) => {
    const opts = field?.kind === 'checkbox' ? ['true', 'false'] : field?.options?.map((o) => o.value) ?? [];
    const keep = field?.kind === 'select' || field?.kind === 'multi_select' || field?.kind === 'checkbox';
    return (key: string, i: number) => {
      if (key === OTHER) return 1e9;
      if (key === '') return 1e9 - 1;
      const at = opts.indexOf(key);
      return keep && at >= 0 ? at : 1e6 + i;
    };
  };
  if (x?.kind === 'date') return { ...data, series: sortBy(data.series, rank(stack), (s) => s.key) };
  const rx = rank(x);
  const order = data.buckets.map((b, i) => [rx(b.key, i), i] as const).sort((a, b) => a[0] - b[0]).map(([, i]) => i);
  return {
    ...data,
    buckets: order.map((i) => data.buckets[i]),
    series: sortBy(data.series, rank(stack), (s) => s.key).map((s) => ({ ...s, values: order.map((i) => s.values[i]) })),
  };
}

function sortBy<T>(list: T[], rank: (key: string, i: number) => number, key: (t: T) => string): T[] {
  return list.map((t, i) => [rank(key(t), i), t] as const).sort((a, b) => a[0] - b[0]).map(([, t]) => t);
}

/** Colours for things with none of their own — people, tags, sprints —
 *  in an order where neighbours differ. Gray is kept for "not set". */
const CYCLE = ['blue', 'teal', 'purple', 'orange', 'pink', 'green', 'yellow', 'red'];

/**
 * The palette name a bucket is painted in: the colour its status, type or
 * option already wears on the board, so a chart and the board beside it speak
 * the same colours. `index` picks from the cycle for everything else.
 */
export function colorOf(
  key: string,
  field: FilterField | undefined,
  index: number,
  ctx: { statusColors: Record<string, string>; kindColors: Record<string, string>; props: PropRow[] },
): string {
  if (key === '' || key === OTHER) return 'gray';
  if (!field) return CYCLE[index % CYCLE.length];
  if (field.key === 'status') return ctx.statusColors[key] || STATUS_COLOR[key] || 'gray';
  if (field.key === 'kind') return ctx.kindColors[key] || CYCLE[index % CYCLE.length];
  if (field.kind === 'checkbox') return key === 'true' ? 'green' : 'gray';
  if (field.key.startsWith('prop:')) {
    const opt = ctx.props.find((p) => p.id === field.key.slice(5))?.options.find((o) => o.id === key);
    if (opt?.color) return opt.color;
  }
  return CYCLE[index % CYCLE.length];
}

/** A round top for the value axis, and its step: 0–4 ticks that read as
 *  numbers people say (5, 10, 25), not 0, 3.25, 6.5. */
export function niceScale(max: number): { top: number; step: number } {
  if (!(max > 0)) return { top: 1, step: 1 };
  const raw = max / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  return { top: Math.ceil(max / step) * step, step };
}

/** A value as the tooltip prints it: whole numbers bare, others to two places. */
export const formatValue = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/\.?0+$/, ''));
