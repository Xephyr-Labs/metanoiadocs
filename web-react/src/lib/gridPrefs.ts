/**
 * Column widths and footer aggregates, per view, per person.
 *
 * Deliberately not in the view's saved config beside filters and sort. Those
 * describe *which rows* a view shows, which is a shared decision — two people
 * opening "Open bugs" should see the same bugs. How wide someone drags a column
 * on a 13-inch laptop is not that: it is a fact about their screen, and pushing
 * it into the shared row would mean one person's drag re-laying-out everybody
 * else's grid.
 *
 * Column *order* is the opposite and lives in the view config already — see
 * `ViewConfig.props`, an ordered id array the server persists.
 *
 * Every accessor is wrapped: localStorage throws in a private window, and a
 * grid that cannot render because it could not read a width is a worse bug than
 * a grid with default widths.
 */

const KEY = 'mn.grid.v1';

export type Aggregate = 'none' | 'count' | 'filled' | 'empty' | 'sum' | 'avg' | 'min' | 'max';

interface GridPref {
  /** Pixel widths by property id. Absent = the column sizes itself. */
  widths?: Record<string, number>;
  /** The reducer shown under each column. Absent = none. */
  aggregates?: Record<string, Aggregate>;
}

type Store = Record<string, GridPref>;

/** Narrow enough to still read a date, wide enough to be worth dragging to. */
export const MIN_COL = 72;
export const MAX_COL = 960;

function read(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? parsed as Store : {};
  } catch {
    return {};
  }
}

function write(next: Store) {
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* private window, or the quota is full. The grid still works. */
  }
}

export function gridPrefFor(viewId: string): GridPref {
  return read()[viewId] ?? {};
}

export function setColumnWidth(viewId: string, propId: string, width: number | null) {
  const store = read();
  const pref = store[viewId] ?? {};
  const widths = { ...(pref.widths ?? {}) };
  // null is "forget this one", which is how a double-click resets a column to
  // sizing itself rather than to some arbitrary number we picked.
  if (width === null) delete widths[propId];
  else widths[propId] = Math.round(Math.min(MAX_COL, Math.max(MIN_COL, width)));
  store[viewId] = { ...pref, widths };
  write(store);
}

export function setColumnAggregate(viewId: string, propId: string, agg: Aggregate) {
  const store = read();
  const pref = store[viewId] ?? {};
  const aggregates = { ...(pref.aggregates ?? {}) };
  if (agg === 'none') delete aggregates[propId];
  else aggregates[propId] = agg;
  store[viewId] = { ...pref, aggregates };
  write(store);
}

/** Which reducers make sense under a column of this type. Offering `sum` on a
 *  column of names is how a footer ends up reading 0. */
export function aggregatesFor(type: string): Aggregate[] {
  const counting: Aggregate[] = ['count', 'filled', 'empty'];
  if (['number', 'formula', 'rollup'].includes(type)) {
    return ['none', 'sum', 'avg', 'min', 'max', ...counting];
  }
  if (type === 'checkbox') return ['none', 'filled', 'empty', 'count'];
  return ['none', ...counting];
}

export const AGGREGATE_LABEL: Record<Aggregate, string> = {
  none: '—',
  count: 'Count',
  filled: 'Filled',
  empty: 'Empty',
  sum: 'Sum',
  avg: 'Average',
  min: 'Min',
  max: 'Max',
};

const isEmpty = (v: unknown) =>
  v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);

/**
 * Run one reducer down a column.
 *
 * Returns a formatted string, or '' when there is nothing to say — an average
 * over a column with no numbers in it is not 0, it is nothing, and printing 0
 * would be a claim about the data that is not true.
 */
export function reduceColumn(values: unknown[], agg: Aggregate): string {
  if (agg === 'none') return '';
  if (agg === 'count') return String(values.length);
  if (agg === 'filled') return String(values.filter((v) => !isEmpty(v)).length);
  if (agg === 'empty') return String(values.filter(isEmpty).length);

  const nums = values
    .filter((v) => !isEmpty(v))
    .map((v) => (typeof v === 'boolean' ? (v ? 1 : 0) : Number(v)))
    .filter((n) => Number.isFinite(n));
  if (!nums.length) return '';

  const round = (n: number) => String(Math.round(n * 100) / 100);
  switch (agg) {
    case 'sum': return round(nums.reduce((a, b) => a + b, 0));
    case 'avg': return round(nums.reduce((a, b) => a + b, 0) / nums.length);
    case 'min': return round(Math.min(...nums));
    case 'max': return round(Math.max(...nums));
    default:    return '';
  }
}
