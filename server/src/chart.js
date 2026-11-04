// The chart view: one saved view of a database drawn as bars, a line or a
// donut, counted (or summed) by the database itself.
//
// Every other view filters in the browser, over the list it already holds.
// A chart is counted here instead, in SQL, so the numbers do not depend on
// how many rows one browser happened to load — and so an agent asking the
// same question over MCP gets the same answer the screen shows. The price is
// a second reading of the view's filters, below, which follows
// web-react/src/lib/taskFilter.ts `matches` op for op. A filter it cannot
// evaluate here (a formula, a rollup — computed in the browser) is not
// guessed at: the route names it, and the chart says it was left out.
import { pool } from './db.js';
import { cleanConfig } from './views.js';
import { bucketOf, nextBucket, zoneOf } from './timezone.js';

export const CHART_TYPES = ['bar', 'hbar', 'line', 'donut'];
export const DATE_UNITS = ['day', 'week', 'month'];
const MEASURES = ['count', 'sum', 'avg'];

/** Categories a chart draws before the rest fold into one "Other". Twenty
 *  bars is already more than a legend can name; past it, the tail is noise. */
export const MAX_BUCKETS = 20;
export const OTHER = '__other__';

/** How far apart the first and last date may be and still have every empty
 *  bucket between them drawn. A line over three years of days is 1,000
 *  points of mostly nothing; past this the dates that have rows are enough. */
const MAX_FILL = 400;

/**
 * The fields a chart or a filter can read, by FilterField key, as SQL.
 *
 * `sql` is one text value (or NULL); `arr` is a text[] for the fields that
 * hold several — a task's assignees, its tags. Every one is read as text so
 * one set of comparisons serves them all, the way `matches` compares strings.
 * `ts` marks a timestamp: a chart buckets it in the reader's zone.
 */
const COLUMNS = {
  title: { kind: 'text', sql: 't.title' },
  status: { kind: 'select', sql: 't.status' },
  kind: { kind: 'select', sql: 't.kind' },
  sprint_id: { kind: 'select', sql: 't.sprint_id' },
  start_at: { kind: 'date', sql: 't.start_at::text' },
  due_at: { kind: 'date', sql: 't.due_at::text' },
  // The browser compares the ISO string the API sent, which is UTC — so a
  // filter does too. Only the chart's axis reads these in the reader's zone.
  created_at: { kind: 'date', ts: 't.created_at' },
  updated_at: { kind: 'date', ts: 't.updated_at' },
  done_at: { kind: 'date', ts: 't.done_at' },
  priority: { kind: 'number', sql: 't.priority::text', num: 't.priority' },
  progress: { kind: 'number', sql: 't.progress::text', num: 't.progress' },
  points: { kind: 'number', sql: 't.points::text', num: 't.points' },
  estimate_h: { kind: 'number', sql: 't.estimate_h::text', num: 't.estimate_h' },
  milestone: { kind: 'checkbox', sql: 't.milestone::text' },
  created_by_name: { kind: 'text', sql: '(SELECT name FROM users WHERE id = t.created_by)' },
  updated_by_name: { kind: 'text', sql: '(SELECT name FROM users WHERE id = t.updated_by)' },
  // Many people, and a row that predates the assignees table has only the
  // single column — the same fallback `valueOf` makes in the browser.
  assignee_id: {
    kind: 'person',
    arr: `coalesce((SELECT array_agg(ta.user_id ORDER BY ta.position) FROM task_assignees ta WHERE ta.task_id = t.id),
                   array_remove(ARRAY[t.assignee_id], NULL))`,
  },
  // A task's focus areas are its page's tags, by name.
  tags: {
    kind: 'multi_select',
    arr: `coalesce((SELECT array_agg(tag.name) FROM doc_tags dt JOIN tags tag ON tag.id = dt.tag_id WHERE dt.doc_id = t.doc_id),
                   '{}'::text[])`,
  },
};

/** How a property type filters — PROP_KIND in taskFilter.ts, minus the
 *  computed types, which have no stored value for SQL to read. */
const PROP_KIND = {
  text: 'text', email: 'text', phone: 'text', url: 'text',
  number: 'number', select: 'select', multi_select: 'multi_select',
  date: 'date', checkbox: 'checkbox', person: 'person',
};

const CATEGORY_KINDS = new Set(['select', 'multi_select', 'person', 'checkbox']);

/**
 * A field key resolved to SQL, or null when this database has no such field
 * or SQL cannot read it. `param` binds a value and returns its placeholder, so
 * a property id is never spliced into the query text.
 */
function resolve(key, props, param) {
  if (typeof key !== 'string') return null;
  if (key.startsWith('prop:')) {
    const prop = props.find((p) => p.id === key.slice(5));
    const kind = prop && PROP_KIND[prop.type];
    if (!kind) return null;
    const ref = `t.props -> ${param(prop.id)}::text`;
    // A person value was a bare id before it was a list, and a stored
    // multi_select is always a list; read either shape as an array.
    const arr = `(CASE jsonb_typeof(${ref}) WHEN 'array' THEN ARRAY(SELECT jsonb_array_elements_text(${ref}))
                  ELSE array_remove(ARRAY[nullif(${ref} #>> '{}', '')], NULL) END)`;
    return {
      kind,
      arr,
      num: kind === 'number' ? `(CASE WHEN jsonb_typeof(${ref}) = 'number' THEN (${ref} #>> '{}')::float8 END)` : null,
      day: kind === 'date' ? `(CASE WHEN (${ref} #>> '{}') ~ '^\\d{4}-\\d{2}-\\d{2}' THEN left(${ref} #>> '{}', 10) END)` : null,
    };
  }
  const col = COLUMNS[key];
  if (!col) return null;
  const sql = col.ts ? `to_char(${col.ts} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS')` : col.sql;
  return {
    kind: col.kind,
    arr: col.arr ?? `array_remove(ARRAY[nullif(${sql}, '')], NULL)`,
    num: col.num ? `${col.num}::float8` : null,
    ts: col.ts ?? null,
    day: col.kind === 'date' && !col.ts ? col.sql : null,
  };
}

const NUMERIC = "'^-?[0-9]+(\\.[0-9]+)?$'";
/** A text value as a number, or NULL — CASE, because Postgres does not
 *  promise to test the pattern before it attempts the cast. */
const asNum = (x) => `(CASE WHEN ${x} ~ ${NUMERIC} THEN (${x})::float8 END)`;

/**
 * One filter as a WHERE clause: '' for "matches everything" (an unknown op,
 * an empty value — what `matches` and `applyFilters` do), null when the field
 * cannot be read here.
 */
function filterSql(f, props, param) {
  const field = resolve(f.field, props, param);
  if (!field) return null;
  const { kind, arr } = field;
  const want = String(f.value ?? '');
  const valueless = f.op === 'is_empty' || f.op === 'is_not_empty';
  if (!valueless && want === '') return '';

  const eq = (one) => {
    if (kind === 'checkbox') return `(coalesce((${arr})[1], 'false') = 'true') = ${one === 'true'}`;
    if (kind === 'number') {
      if (!Number.isFinite(Number(one))) return 'false';
      // Number(null) is 0 in the browser, so "is 0" matches an empty cell.
      const empty = Number(one) === 0 ? `cardinality(${arr}) = 0 OR ` : '';
      return `(${empty}EXISTS (SELECT 1 FROM unnest(${arr}) v WHERE ${asNum('v')} = ${param(Number(one))}))`;
    }
    return `EXISTS (SELECT 1 FROM unnest(${arr}) v WHERE lower(v) = lower(${param(one)}))`;
  };
  const list = () => want.split(',').map((v) => v.trim()).filter(Boolean);
  const any = () => `(${list().map(eq).join(' OR ') || 'false'})`;
  const first = `(${arr})[1]`;
  const compare = (op) => {
    if (kind === 'number' || f.op === 'gt' || f.op === 'lt') {
      if (!Number.isFinite(Number(want))) return 'false';
      return `coalesce(${asNum(first)} ${op} ${param(Number(want))}, false)`;
    }
    return `coalesce(left(${first}, 10) ${op} ${param(want)}, false)`;
  };

  switch (f.op) {
    case 'is_any_of': return any();
    case 'is_none_of': return `NOT ${any()}`;
    case 'is_empty': return `cardinality(${arr}) = 0`;
    case 'is_not_empty': return `cardinality(${arr}) > 0`;
    case 'is': return eq(want);
    case 'is_not': return `NOT (${eq(want)})`;
    case 'contains': return `EXISTS (SELECT 1 FROM unnest(${arr}) v WHERE strpos(lower(v), lower(${param(want)})) > 0)`;
    case 'on': return compare('=');
    case 'before': return compare('<');
    case 'after': return compare('>');
    case 'gt': return compare('>');
    case 'lt': return compare('<');
    default: return '';
  }
}

/** A chart's settings, with anything unrecognised replaced by its default.
 *  Part of a view's config, so the same trust boundary as `cleanConfig`. */
export function cleanChart(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const key = (v) => (typeof v === 'string' && v ? v.slice(0, 80) : null);
  const of = key(value.of);
  const measure = MEASURES.includes(value.measure) && of ? value.measure : 'count';
  return {
    type: CHART_TYPES.includes(value.type) ? value.type : 'bar',
    x: key(value.x) ?? 'status',
    unit: DATE_UNITS.includes(value.unit) ? value.unit : 'week',
    measure,
    of: measure === 'count' ? null : of,
    stack: key(value.stack),
  };
}

/** The axis a chart groups by, as a lateral join yielding one `k` per value
 *  a row has ('' for none). A row on two people counts once for each. */
function groupJoin(alias, field, param, zone) {
  if (field.kind === 'date') {
    const day = field.ts ? `to_char(${field.ts} AT TIME ZONE ${param(zone)}, 'YYYY-MM-DD')` : field.day;
    return `CROSS JOIN LATERAL (SELECT coalesce(${day}, '') AS k) ${alias}`;
  }
  if (field.kind === 'checkbox') {
    return `CROSS JOIN LATERAL (SELECT CASE WHEN (${field.arr})[1] = 'true' THEN 'true' ELSE 'false' END AS k) ${alias}`;
  }
  return `LEFT JOIN LATERAL unnest(${field.arr}) AS ${alias}(k) ON true`;
}

/**
 * The SQL for one chart over one database, and the filters it had to leave
 * out. Pure — the route runs it — so the query can be read in a test.
 *
 * Rows come back per (x, stack) pair at day resolution for a date axis;
 * `rollUp` turns them into weeks or months, so the bucketing rule lives in one
 * tested function (timezone.js) rather than in two dialects.
 */
export function chartQuery({ projectId, chart, filters = [], scope = 'all', props = [], zone = 'UTC' }) {
  const values = [projectId];
  const param = (v) => { values.push(v); return `$${values.length}`; };
  const where = ['t.project_id = $1', 't.deleted_at IS NULL'];
  if (scope === 'backlog') where.push('t.sprint_id IS NULL');
  else if (scope && scope !== 'all') where.push(`t.sprint_id = ${param(String(scope))}`);

  const ignored = [];
  for (const f of filters) {
    const sql = filterSql(f, props, param);
    if (sql === null) ignored.push(f.id);
    else if (sql) where.push(`(${sql})`);
  }
  // The count query shares this WHERE, so it takes only the values bound so far.
  const countValues = [...values];
  const whereSql = where.join('\n     AND ');

  const x = resolve(chart.x, props, param);
  const xField = x && (x.kind === 'date' || CATEGORY_KINDS.has(x.kind)) ? x : resolve('status', props, param);
  const s = chart.stack ? resolve(chart.stack, props, param) : null;
  // A donut has one ring, and stacked averages would add up to nothing.
  const sField = s && CATEGORY_KINDS.has(s.kind) && chart.type !== 'donut' && chart.measure !== 'avg' ? s : null;
  const m = chart.measure !== 'count' ? resolve(chart.of, props, param) : null;

  const text = `
    SELECT coalesce(x.k, '') AS x, ${sField ? "coalesce(s.k, '')" : "''"} AS s,
           count(*)::int AS n, sum(m.v)::float8 AS total, count(m.v)::int AS counted
      FROM tasks t
      ${groupJoin('x', xField, param, zone)}
      ${sField ? groupJoin('s', sField, param, zone) : ''}
      CROSS JOIN LATERAL (SELECT ${m?.num ?? 'NULL::float8'} AS v) m
     WHERE ${whereSql}
     GROUP BY 1, 2`;
  return {
    text,
    values,
    countText: `SELECT count(*)::int AS n FROM tasks t WHERE ${whereSql}`,
    countValues,
    ignored,
    dates: xField.kind === 'date',
  };
}

/** Fold the smallest of `keys` into OTHER once there are more than the cap. */
function capped(keys, size) {
  const ranked = [...keys].sort((a, b) => size(b) - size(a));
  if (ranked.length <= MAX_BUCKETS) return { kept: ranked, fold: () => null };
  const kept = new Set(ranked.slice(0, MAX_BUCKETS - 1));
  return { kept: [...kept, OTHER], fold: (k) => (kept.has(k) ? null : OTHER) };
}

/**
 * The query's rows as what the chart draws: `buckets` along the axis, each
 * with its total, and one `series` per stack value whose `values` line up
 * with them. Unstacked charts have the one series, keyed ''.
 *
 * Sum and count are carried separately until the end so an average over a
 * week, or over "Other", is the average of its rows rather than the average
 * of the days' averages.
 */
export function rollUp(rows, chart, { dates = false } = {}) {
  const value = (c) => (!c ? 0
    : chart.measure === 'count' ? c.n
    : chart.measure === 'sum' ? c.total
    : c.counted ? c.total / c.counted : 0);
  const add = (into, r) => {
    into.n += r.n;
    into.total += r.total ?? 0;
    into.counted += r.counted ?? 0;
  };
  const cell = () => ({ n: 0, total: 0, counted: 0 });

  // Day rows into weeks or months.
  const keyed = rows.map((r) => ({ ...r, x: dates ? bucketOf(r.x, chart.unit) : String(r.x ?? '') }));

  // The stack's values, capped across the whole chart.
  const byStack = new Map();
  for (const r of keyed) add(byStack.get(r.s) ?? byStack.set(r.s, cell()).get(r.s), r);
  const stacks = capped(byStack.keys(), (k) => value(byStack.get(k)));

  const byX = new Map();
  for (const r of keyed) add(byX.get(r.x) ?? byX.set(r.x, cell()).get(r.x), r);

  let xs;
  let foldX = () => null;
  if (dates) {
    const days = [...byX.keys()].filter(Boolean).sort();
    xs = days;
    if (days.length > 1) {
      const filled = [];
      for (let d = days[0]; d <= days[days.length - 1] && filled.length <= MAX_FILL; d = nextBucket(d, chart.unit)) filled.push(d);
      if (filled.length <= MAX_FILL) xs = filled;
    }
    if (byX.has('')) xs = [...xs, ''];
  } else {
    const c = capped(byX.keys(), (k) => value(byX.get(k)));
    xs = c.kept;
    foldX = c.fold;
  }

  const cells = new Map(); // `${x}\u0000${s}` → cell
  const totals = new Map();
  for (const r of keyed) {
    const x = foldX(r.x) ?? r.x;
    const s = stacks.fold(r.s) ?? r.s;
    const k = `${x}\u0000${s}`;
    add(cells.get(k) ?? cells.set(k, cell()).get(k), r);
    add(totals.get(x) ?? totals.set(x, cell()).get(x), r);
  }

  return {
    buckets: xs.map((x) => ({ key: x, value: value(totals.get(x)) })),
    series: stacks.kept.map((s) => ({ key: s, values: xs.map((x) => value(cells.get(`${x}\u0000${s}`))) })),
  };
}

/**
 * POST /api/projects/:id/chart — a chart over one database.
 *
 * POST, not GET, because it is handed the view's settings rather than the
 * view's id: the toolbar saves a filter and redraws at the same moment, and a
 * route that read the saved row would race the save it is meant to reflect.
 * Readable by whoever can read the task list, which is exactly the rows it counts.
 */
export function registerChartRoutes(app, { requireUser, wrap }) {
  app.post('/api/projects/:id/chart', requireUser, wrap(async (req, res) => {
    const chart = cleanChart(req.body?.chart ?? {});
    const config = cleanConfig({ filters: req.body?.filters ?? [], scope: req.body?.scope ?? 'all' });
    if (!config) return res.status(400).json({ error: 'bad config' });
    const { rows: project } = await pool.query('SELECT id FROM projects WHERE id = $1', [req.params.id]);
    if (!project[0]) return res.status(404).json({ error: 'not found' });
    const { rows: props } = await pool.query('SELECT id, type FROM db_props WHERE project_id = $1', [req.params.id]);
    const q = chartQuery({
      projectId: req.params.id, chart, filters: config.filters, scope: config.scope, props, zone: zoneOf(req.user),
    });
    const [grouped, counted] = await Promise.all([
      pool.query(q.text, q.values),
      pool.query(q.countText, q.countValues),
    ]);
    res.json({ ...rollUp(grouped.rows, chart, { dates: q.dates }), tasks: counted.rows[0].n, ignored: q.ignored });
  }));
}
