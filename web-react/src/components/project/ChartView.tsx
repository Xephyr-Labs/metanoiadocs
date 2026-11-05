/* Hallmark · component: chart view of a database · genre: modern-minimal
 * theme: project tokens (index.css)
 * states: loading · error · empty (no rows) · empty (no values to sum) ·
 *         filters left out · bar · horizontal bar · line · donut · stacked ·
 *         hover (tooltip) · picked (task list) · read-only
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { BarChart3, BarChartHorizontal, ChevronDown, LineChart, PieChart, X } from 'lucide-react';
import {
  bucketLabel, chartFields, colorOf, defaultChart, formatValue, niceScale, ordered, OTHER,
} from '../../lib/chartView';
import { cn } from '../../lib/cn';
import { swatch } from '../../lib/tagColors';
import { applyFilters, type Filter, type FilterField } from '../../lib/taskFilter';
import {
  tasksApi, type ChartConfig, type ChartData, type ProjectMode, type PropRow, type TaskKindRow, type TaskRow,
} from '../../lib/tasksApi';
import { EmptyState } from '../ui/EmptyState';
import { Menu, type MenuItem } from '../ui/Menu';
import { Skeleton } from '../ui/Skeleton';

const TYPES: { type: ChartConfig['type']; label: string; icon: typeof BarChart3 }[] = [
  { type: 'bar', label: 'Bar', icon: BarChart3 },
  { type: 'hbar', label: 'Horizontal bar', icon: BarChartHorizontal },
  { type: 'line', label: 'Line', icon: LineChart },
  { type: 'donut', label: 'Donut', icon: PieChart },
];
const UNITS: { unit: ChartConfig['unit']; label: string }[] = [
  { unit: 'day', label: 'Day' }, { unit: 'week', label: 'Week' }, { unit: 'month', label: 'Month' },
];

interface Props {
  projectId: string;
  mode: ProjectMode;
  chart: ChartConfig | undefined;
  /** The view's own filters and sprint scope, already pruned by useDatabaseView. */
  filters: Filter[];
  scope: string;
  fields: FilterField[];
  props: PropRow[];
  kinds: TaskKindRow[];
  statusColors: Record<string, string>;
  /** The filtered rows the other views draw, for the list a click opens. */
  tasks: TaskRow[];
  /** Changes whenever the database's rows do — the loaded list itself — which
   *  is what tells the chart to count again. Not `tasks`: that is a fresh
   *  filter result on every render and would refetch in a loop. */
  version: unknown;
  onSave?: (chart: ChartConfig) => void;
  onOpen: (task: TaskRow) => void;
  readonly?: boolean;
}

/**
 * A saved view drawn as a chart.
 *
 * The counting happens on the server (server/src/chart.js) and this only
 * draws what comes back — so a chart over ten thousand rows is as cheap to
 * show as one over ten, and an agent asking the same question gets the same
 * numbers. The filter bar above it is the view's own: narrowing the view
 * narrows the chart.
 */
export function ChartView({
  projectId, mode, chart: saved, filters, scope, fields, props, kinds, statusColors, tasks, version, onSave, onOpen, readonly,
}: Props) {
  const axes = useMemo(() => chartFields(fields, props, mode), [fields, props, mode]);
  const chart = saved ?? defaultChart(mode);
  const x = axes.all.find((f) => f.key === chart.x) ?? axes.all[0];
  const stackable = (chart.type === 'bar' || chart.type === 'hbar') && chart.measure !== 'avg';
  const stack = stackable ? axes.categories.find((f) => f.key === chart.stack) : undefined;
  const of = axes.numbers.find((f) => f.key === chart.of);

  const [data, setData] = useState<ChartData | null>(null);
  const [error, setError] = useState<string | null>(null);
  // One string, so the effect re-runs when what is asked changes and not
  // whenever a parent re-renders with an equal but new filters array.
  // The stack goes only where it is drawn. A stacked bar switched to a line
  // keeps its saved stack-by (switching back restores it), but the line must
  // not be asked for one series per status.
  const ask = JSON.stringify({ chart: { ...chart, x: x?.key ?? chart.x, stack: stack?.key ?? null }, filters, scope });
  useEffect(() => {
    let live = true;
    setError(null);
    tasksApi.chart(projectId, JSON.parse(ask))
      .then((d) => { if (live) setData(d); })
      .catch((e: Error) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [projectId, ask, version]);

  const save = (patch: Partial<ChartConfig>) => onSave?.({ ...chart, ...patch });
  const view = useMemo(() => (data ? ordered(data, x, stack) : null), [data, x, stack]);

  const ctx = useMemo(() => ({
    statusColors,
    kindColors: Object.fromEntries(kinds.map((k) => [k.key, k.color])),
    props,
  }), [statusColors, kinds, props]);

  // A single series is painted per bucket — the board's colours for a status
  // or an option. A stacked one is painted per series. A line, and bars over
  // time, are one accent colour: a date has no colour of its own.
  const paint = (bucket: number, series: number): string => {
    if (!view) return 'gray';
    if (stack) return colorOf(view.series[series].key, stack, series, ctx);
    if (x?.kind === 'date' || chart.type === 'line') return 'accent';
    return colorOf(view.buckets[bucket].key, x, bucket, ctx);
  };
  const labelOf = (key: string) => bucketLabel(key, x, chart.unit);
  const seriesLabel = (key: string) => (stack ? bucketLabel(key, stack, chart.unit) : measureLabel(chart, of));

  // Clicking a bar or a slice lists its rows. Only for categories: a date
  // bucket is read in the reader's zone here and in UTC by the filter engine,
  // and a list that disagreed with the bar it came from would be worse than none.
  const [picked, setPicked] = useState<{ title: string; rows: TaskRow[]; at: { x: number; y: number } } | null>(null);
  const pick = (bucket: string, series: string | null, at: { x: number; y: number }) => {
    if (!x || x.kind === 'date' || bucket === OTHER || series === OTHER) return;
    const narrow: Filter[] = [match(x, bucket)];
    if (stack && series !== null) narrow.push(match(stack, series));
    const rows = applyFilters(tasks, narrow, fields);
    setPicked({ title: [labelOf(bucket), stack && series !== null ? seriesLabel(series) : null].filter(Boolean).join(' · '), rows, at });
  };

  const ignored = data?.ignored.length ?? 0;

  return (
    <div className="flex h-full min-h-[260px] flex-col">
      {!readonly && (
        <div className="flex flex-wrap items-center gap-1 px-4 pt-3">
          <Pick
            icon={TYPES.find((t) => t.type === chart.type)?.icon}
            label={TYPES.find((t) => t.type === chart.type)?.label ?? 'Bar'}
            items={TYPES.map((t) => ({ icon: t.icon, label: t.label, checked: t.type === chart.type, onSelect: () => save({ type: t.type }) }))}
          />
          <Pick
            label={`By ${x?.label ?? '…'}`}
            items={[
              ...axes.categories.map((f) => ({ label: f.label, checked: f.key === x?.key, onSelect: () => save({ x: f.key }) })),
              ...axes.dates.map((f, i) => ({ label: f.label, checked: f.key === x?.key, onSelect: () => save({ x: f.key }), separatorBefore: i === 0 })),
            ]}
          />
          {x?.kind === 'date' && (
            <Pick
              label={`Per ${chart.unit}`}
              items={UNITS.map((u) => ({ label: u.label, checked: u.unit === chart.unit, onSelect: () => save({ unit: u.unit }) }))}
            />
          )}
          <Pick
            label={measureLabel(chart, of)}
            items={[
              { label: 'Count of rows', checked: chart.measure === 'count', onSelect: () => save({ measure: 'count', of: null }) },
              ...(axes.numbers.length ? [
                { label: 'Sum of', separatorBefore: true, items: axes.numbers.map((f) => ({ label: f.label, checked: chart.measure === 'sum' && f.key === of?.key, onSelect: () => save({ measure: 'sum', of: f.key }) })) },
                { label: 'Average of', items: axes.numbers.map((f) => ({ label: f.label, checked: chart.measure === 'avg' && f.key === of?.key, onSelect: () => save({ measure: 'avg', of: f.key }) })) },
              ] : []),
            ]}
          />
          {stackable && (
            <Pick
              label={stack ? `Stacked by ${stack.label}` : 'Stack'}
              items={[
                { label: 'No stacking', checked: !stack, onSelect: () => save({ stack: null }) },
                ...axes.categories.filter((f) => f.key !== x?.key).map((f, i) => ({
                  label: f.label, checked: f.key === stack?.key, onSelect: () => save({ stack: f.key }), separatorBefore: i === 0,
                })),
              ]}
            />
          )}
        </div>
      )}

      {ignored > 0 && (
        <p className="px-4 pt-2 text-2xs text-muted">
          {ignored === 1 ? 'One filter is' : `${ignored} filters are`} on a formula or rollup, which a chart can&apos;t count yet — left out here.
        </p>
      )}

      <div className="relative min-h-0 flex-1 px-4 pb-3 pt-2">
        {error ? (
          <p className="py-6 text-center text-sm text-danger-strong">{error}</p>
        ) : !view ? (
          <Skeleton className="h-full min-h-[200px] w-full" />
        ) : !data?.tasks ? (
          <EmptyState compact icon={BarChart3} title="Nothing to chart" hint="No rows match this view's filters." />
        ) : !view.buckets.some((b) => b.value) ? (
          <EmptyState compact icon={BarChart3} title="Nothing to chart" hint={`None of these ${data.tasks} rows has a ${of?.label.toLowerCase() ?? 'value'} yet.`} />
        ) : (
          <Plot
            data={view}
            type={chart.type}
            paint={paint}
            labelOf={labelOf}
            seriesLabel={seriesLabel}
            total={data.tasks}
            onPick={pick}
          />
        )}
        {picked && <Picked {...picked} onClose={() => setPicked(null)} onOpen={(t) => { setPicked(null); onOpen(t); }} />}
      </div>
    </div>
  );
}

/** A filter that matches one bucket — `is` reads a multi-valued cell the way
 *  the server's unnest does: a row on two people is in both their bars. */
const match = (field: FilterField, key: string): Filter => ({
  id: 'chart', field: field.key, op: key ? 'is' : 'is_empty', value: key || '',
});

const measureLabel = (chart: ChartConfig, of: FilterField | undefined) =>
  chart.measure === 'count' || !of ? 'Count' : `${chart.measure === 'sum' ? 'Sum' : 'Average'} of ${of.label}`;

function Pick({ icon: Icon, label, items }: { icon?: typeof BarChart3; label: string; items: MenuItem[] }) {
  return (
    <Menu
      align="start"
      trigger={
        <button type="button" className="mn-hit flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-xs text-muted transition-colors hover:bg-hover hover:text-ink">
          {Icon && <Icon size={14} />}
          <span className="max-w-[12rem] truncate">{label}</span>
          <ChevronDown size={12} className="text-faint" />
        </button>
      }
      items={items}
    />
  );
}

/** The box's own size, so the SVG is drawn in real pixels: text in a
 *  stretched viewBox stretches with it. */
function useSize() {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: Math.floor(e.contentRect.width), h: Math.floor(e.contentRect.height) }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [setEl, size] as const;
}

interface Tip { x: number; y: number; title: string; rows: { label: string; value: number; color: string }[] }

const fillOf = (color: string) => (color === 'accent' ? 'fill-accent' : swatch(color).fill);
const dotOf = (color: string) => (color === 'accent' ? 'bg-accent' : swatch(color).bar);

/** Shorten a label to roughly what fits in `px` of 12px text. */
const fit = (text: string, px: number) => {
  const n = Math.max(3, Math.floor(px / 6.5));
  return text.length > n ? `${text.slice(0, n - 1)}…` : text;
};

function Plot({ data, type, paint, labelOf, seriesLabel, total, onPick }: {
  data: ChartData;
  type: ChartConfig['type'];
  paint: (bucket: number, series: number) => string;
  labelOf: (key: string) => string;
  seriesLabel: (key: string) => string;
  total: number;
  onPick: (bucket: string, series: string | null, at: { x: number; y: number }) => void;
}) {
  const [ref, { w, h }] = useSize();
  const [tip, setTip] = useState<Tip | null>(null);
  const box = useRef<HTMLDivElement>(null);

  // A line has no "No date" point to put anywhere on a time axis.
  const shown: ChartData = type === 'line' && data.buckets.at(-1)?.key === ''
    ? { ...data, buckets: data.buckets.slice(0, -1), series: data.series.map((s) => ({ ...s, values: s.values.slice(0, -1) })) }
    : data;
  const stacked = shown.series.length > 1;

  const at = (e: { clientX: number; clientY: number }) => {
    const r = box.current?.getBoundingClientRect();
    return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) };
  };
  const hover = (e: React.MouseEvent, i: number, only?: number) => setTip({
    ...at(e),
    title: labelOf(shown.buckets[i].key),
    rows: shown.series
      .map((s, j) => ({ label: seriesLabel(s.key), value: s.values[i], color: paint(i, j), j }))
      .filter((r) => (only === undefined ? r.value !== 0 || !stacked : r.j === only)),
  });
  const handlers = (i: number, j: number | null) => ({
    onMouseMove: (e: React.MouseEvent) => hover(e, i, j ?? undefined),
    onMouseLeave: () => setTip(null),
    onClick: (e: React.MouseEvent) => onPick(shown.buckets[i].key, j === null ? null : shown.series[j].key, at(e)),
    className: 'cursor-pointer',
  });

  let drawing: ReactNode = null;
  if (w > 0 && h > 0) {
    if (type === 'donut') drawing = <Donut data={shown} w={w} h={h} paint={paint} labelOf={labelOf} total={total} handlers={handlers} />;
    else if (type === 'line') drawing = <Line data={shown} w={w} h={h} labelOf={labelOf} handlers={handlers} />;
    else drawing = <Bars data={shown} w={w} h={h} horizontal={type === 'hbar'} paint={paint} labelOf={labelOf} handlers={handlers} />;
  }

  return (
    <div ref={box} className="relative flex h-full min-h-[200px] flex-col">
      {stacked && (
        <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1">
          {shown.series.map((s, j) => (
            <li key={s.key} className="flex items-center gap-1.5 text-2xs text-muted">
              <span className={cn('h-2 w-2 rounded-full', dotOf(paint(0, j)))} />
              {seriesLabel(s.key)}
            </li>
          ))}
        </ul>
      )}
      <div ref={ref} className="min-h-0 flex-1">
        {drawing && (
          <svg width={w} height={h} role="img" aria-label={shown.buckets.map((b) => `${labelOf(b.key)}: ${formatValue(b.value)}`).join(', ')} className="block overflow-visible">
            {drawing}
          </svg>
        )}
      </div>
      {tip && (
        <div
          role="tooltip"
          className="pointer-events-none absolute z-20 min-w-[8rem] rounded-md bg-tooltip px-2.5 py-1.5 text-2xs text-white shadow-subtle"
          style={{ left: Math.min(tip.x + 12, (box.current?.clientWidth ?? 0) - 160), top: tip.y + 12 }}
        >
          <p className="mb-0.5 font-medium">{tip.title}</p>
          {tip.rows.map((r) => (
            <p key={r.label} className="flex items-center gap-1.5 tabular-nums">
              {tip.rows.length > 1 && <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', dotOf(r.color))} />}
              <span className="min-w-0 flex-1 truncate opacity-80">{r.label}</span>
              <span className="font-medium">{formatValue(r.value)}</span>
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

type Handlers = (i: number, j: number | null) => Record<string, unknown>;

/** The value axis's gridlines and their numbers. */
function Grid({ top, step, from, to, at, horizontal, edge }: {
  top: number; step: number; from: number; to: number; at: (v: number) => number; horizontal: boolean; edge: number;
}) {
  const ticks: number[] = [];
  for (let v = 0; v <= top + step / 2; v += step) ticks.push(v);
  return (
    <g className="text-3xs">
      {ticks.map((v) => (horizontal ? (
        <g key={v}>
          <line x1={at(v)} x2={at(v)} y1={from} y2={to} className="stroke-line" />
          <text x={at(v)} y={edge} textAnchor="middle" className="fill-muted">{formatValue(v)}</text>
        </g>
      ) : (
        <g key={v}>
          <line x1={from} x2={to} y1={at(v)} y2={at(v)} className="stroke-line" />
          <text x={edge} y={at(v) + 4} textAnchor="end" className="fill-muted">{formatValue(v)}</text>
        </g>
      )))}
    </g>
  );
}

function Bars({ data, w, h, horizontal, paint, labelOf, handlers }: {
  data: ChartData; w: number; h: number; horizontal: boolean;
  paint: (i: number, j: number) => string; labelOf: (k: string) => string; handlers: Handlers;
}) {
  const n = data.buckets.length;
  const sums = data.buckets.map((_, i) => data.series.reduce((s, x) => s + Math.max(0, x.values[i]), 0));
  const { top, step } = niceScale(Math.max(...sums));
  const pad = horizontal
    ? { l: Math.min(140, Math.round(w * 0.3)), r: 16, t: 4, b: 20 }
    : { l: 36, r: 8, t: 8, b: 24 };
  const pw = Math.max(1, w - pad.l - pad.r);
  const ph = Math.max(1, h - pad.t - pad.b);
  const band = (horizontal ? ph : pw) / n;
  const thick = Math.min(horizontal ? 24 : 48, band * 0.72);
  const len = (v: number) => (v / top) * (horizontal ? pw : ph);
  // Thin the axis labels when the bands are narrower than a label is.
  const every = horizontal ? Math.ceil(16 / band) : Math.ceil(56 / band);

  return (
    <>
      <Grid
        top={top} step={step} horizontal={horizontal}
        from={horizontal ? pad.t : pad.l} to={horizontal ? pad.t + ph : pad.l + pw}
        at={horizontal ? (v) => pad.l + len(v) : (v) => pad.t + ph - len(v)}
        edge={horizontal ? h - 4 : pad.l - 6}
      />
      {data.buckets.map((b, i) => {
        const mid = (horizontal ? pad.t : pad.l) + band * (i + 0.5);
        let acc = 0;
        return (
          <g key={b.key}>
            {data.series.map((s, j) => {
              const v = Math.max(0, s.values[i]);
              if (!v) return null;
              const from = acc;
              acc += v;
              const props = horizontal
                ? { x: pad.l + len(from), y: mid - thick / 2, width: Math.max(1, len(v)), height: thick }
                : { x: mid - thick / 2, y: pad.t + ph - len(acc), width: thick, height: Math.max(1, len(v)) };
              return (
                <rect key={s.key} {...props} rx={2} {...handlers(i, data.series.length > 1 ? j : null)} className={cn('cursor-pointer transition-opacity hover:opacity-80', fillOf(paint(i, j)))} />
              );
            })}
            {i % every === 0 && (horizontal ? (
              <text x={pad.l - 6} y={mid + 4} textAnchor="end" className="fill-muted text-2xs">{fit(labelOf(b.key), pad.l - 10)}</text>
            ) : (
              <text x={mid} y={h - 6} textAnchor="middle" className="fill-muted text-2xs">{fit(labelOf(b.key), band * every - 4)}</text>
            ))}
          </g>
        );
      })}
    </>
  );
}

function Line({ data, w, h, labelOf, handlers }: {
  data: ChartData; w: number; h: number; labelOf: (k: string) => string; handlers: Handlers;
}) {
  const n = data.buckets.length;
  const { top, step } = niceScale(Math.max(...data.series.flatMap((s) => s.values)));
  const pad = { l: 36, r: 12, t: 8, b: 24 };
  const pw = Math.max(1, w - pad.l - pad.r);
  const ph = Math.max(1, h - pad.t - pad.b);
  const xAt = (i: number) => pad.l + (n === 1 ? pw / 2 : (pw * i) / (n - 1));
  const yAt = (v: number) => pad.t + ph - (v / top) * ph;
  const every = Math.ceil(72 / (pw / Math.max(1, n - 1)));
  const band = pw / Math.max(1, n - 1);

  return (
    <>
      <Grid top={top} step={step} horizontal={false} from={pad.l} to={pad.l + pw} at={yAt} edge={pad.l - 6} />
      {/* One series always: the chart never sends a stack for a line (see `stackable` and `ask`), and the server ignores one. */}
      {data.series.map((s) => (
        <g key={s.key} className="text-accent">
          <polyline
            points={s.values.map((v, i) => `${xAt(i)},${yAt(v)}`).join(' ')}
            fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round"
          />
          {n <= 60 && s.values.map((v, i) => <circle key={i} cx={xAt(i)} cy={yAt(v)} r={2.5} fill="currentColor" />)}
        </g>
      ))}
      {/* One invisible column per point, so hovering anywhere over a date
          reads every series at it — a 5px dot is too small a target. */}
      {data.buckets.map((b, i) => (
        <rect key={b.key} x={xAt(i) - band / 2} y={pad.t} width={band} height={ph} fill="transparent" {...handlers(i, null)} className="cursor-default" />
      ))}
      {data.buckets.map((b, i) => (i % every === 0 || i === n - 1) && (i === n - 1 || n - 1 - i >= every / 2) && (
        <text key={b.key} x={xAt(i)} y={h - 6} textAnchor="middle" className="fill-muted text-2xs">{labelOf(b.key)}</text>
      ))}
    </>
  );
}

function Donut({ data, w, h, paint, labelOf, total, handlers }: {
  data: ChartData; w: number; h: number; paint: (i: number, j: number) => string; labelOf: (k: string) => string; total: number; handlers: Handlers;
}) {
  const values = data.buckets.map((b) => Math.max(0, b.value));
  const sum = values.reduce((a, b) => a + b, 0) || 1;
  // The legend takes the right-hand side when there is room for it, else
  // it goes under the ring.
  const side = w >= 420;
  const r = Math.max(40, Math.min(side ? h / 2 - 8 : Math.min(w, h * 0.6) / 2 - 8, 140));
  const cx = side ? r + 8 : w / 2;
  const cy = r + 8;
  const inner = r * 0.62;
  let angle = -Math.PI / 2;
  const arc = (from: number, to: number) => {
    const large = to - from > Math.PI ? 1 : 0;
    const p = (a: number, rad: number) => `${cx + rad * Math.cos(a)} ${cy + rad * Math.sin(a)}`;
    return `M ${p(from, r)} A ${r} ${r} 0 ${large} 1 ${p(to, r)} L ${p(to, inner)} A ${inner} ${inner} 0 ${large} 0 ${p(from, inner)} Z`;
  };
  const legendX = side ? cx + r + 24 : 8;
  const legendW = Math.max(120, Math.min(260, w - legendX - 8));
  const legendY = side ? Math.max(8, cy - (data.buckets.length * 18) / 2) : cy + r + 16;

  return (
    <>
      {values.map((v, i) => {
        if (!v) return null;
        const from = angle;
        // A full ring cannot be one arc — its ends coincide and it draws nothing.
        const to = angle + Math.min((v / sum) * Math.PI * 2, Math.PI * 2 - 1e-4);
        angle += (v / sum) * Math.PI * 2;
        return <path key={data.buckets[i].key} d={arc(from, to)} {...handlers(i, null)} className={cn('cursor-pointer transition-opacity hover:opacity-80', fillOf(paint(i, 0)))} />;
      })}
      <text x={cx} y={cy - 2} textAnchor="middle" className="fill-ink text-lg font-semibold tabular-nums">{formatValue(data.buckets.reduce((s, b) => s + b.value, 0))}</text>
      <text x={cx} y={cy + 16} textAnchor="middle" className="fill-muted text-2xs">{total === 1 ? '1 row' : `${total} rows`}</text>
      {data.buckets.map((b, i) => (
        <g key={b.key} transform={`translate(${legendX} ${legendY + i * 18})`} {...handlers(i, null)}>
          <rect width={8} height={8} y={-8} rx={4} className={fillOf(paint(i, 0))} />
          <text x={14} className="fill-ink text-2xs">{fit(labelOf(b.key), legendW - 80)}</text>
          {/* Kept beside its label rather than at the far edge of a wide
              card, where the eye loses which row it belongs to. */}
          <text x={legendW} textAnchor="end" className="fill-muted text-2xs tabular-nums">
            {formatValue(b.value)} · {Math.round((values[i] / sum) * 100)}%
          </text>
        </g>
      ))}
    </>
  );
}

/** The rows behind one bar or slice, opened from it. */
function Picked({ title, rows, at, onClose, onOpen }: {
  title: string; rows: TaskRow[]; at: { x: number; y: number }; onClose: () => void; onOpen: (t: TaskRow) => void;
}) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const away = (e: MouseEvent) => { if (!el.current?.contains(e.target as Node)) onClose(); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    // Next tick: the click that opened this is still bubbling.
    const id = setTimeout(() => document.addEventListener('mousedown', away));
    document.addEventListener('keydown', esc);
    return () => { clearTimeout(id); document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [onClose]);
  return (
    <div
      ref={el}
      role="dialog"
      aria-label={title}
      className="absolute z-30 flex max-h-72 w-72 flex-col rounded-lg border border-line bg-canvas shadow-subtle"
      style={{ left: Math.max(8, at.x - 144), top: at.y + 16 }}
    >
      <header className="flex items-center gap-2 border-b border-line px-3 py-2">
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-ink">{title}</span>
        <span className="text-2xs tabular-nums text-faint">{rows.length}</span>
        <button type="button" aria-label="Close" onClick={onClose} className="rounded p-0.5 text-faint hover:bg-hover hover:text-ink">
          <X size={14} />
        </button>
      </header>
      <ul className="min-h-0 flex-1 overflow-y-auto py-1">
        {rows.length ? rows.slice(0, 100).map((t) => (
          <li key={t.id}>
            <button type="button" onClick={() => onOpen(t)} className="block w-full truncate px-3 py-1 text-left text-xs text-ink hover:bg-hover">
              {t.title || 'Untitled'}
            </button>
          </li>
        )) : <li className="px-3 py-2 text-xs text-faint">No rows.</li>}
      </ul>
    </div>
  );
}
