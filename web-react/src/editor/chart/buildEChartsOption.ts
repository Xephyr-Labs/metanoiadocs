// Pure adapter: chart props + data rows -> ECharts option object. No BlockSuite
// and no ECharts *runtime* dependency (only the option type), so it is trivially
// unit-testable. The renderer feeds the result to `chart.setOption(...)`.

import type { EChartsOption } from 'echarts';
import { mergeAdvancedOptions } from './chart-schema';
import type { Aggregation, ChartBlockProps } from './chart-types';

type Row = Record<string, unknown>;

function toNum(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const t = v.trim();
    if (t === '') return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function aggregate(vals: number[], agg: Aggregation): number | null {
  if (agg === 'count') return vals.length;
  if (!vals.length) return null;
  switch (agg) {
    case 'sum': return vals.reduce((a, b) => a + b, 0);
    case 'avg': return vals.reduce((a, b) => a + b, 0) / vals.length;
    case 'min': return Math.min(...vals);
    case 'max': return Math.max(...vals);
    case 'none': default: return vals[vals.length - 1]; // no aggregation: last wins per category
  }
}

function uniqueInOrder(rows: Row[], field: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of rows) {
    const c = r[field] == null ? '' : String(r[field]);
    if (!seen.has(c)) { seen.add(c); out.push(c); }
  }
  return out;
}

// value per category, bucketed then aggregated
function seriesValues(rows: Row[], catField: string, valField: string, categories: string[], agg: Aggregation): (number | null)[] {
  const buckets = new Map<string, number[]>();
  for (const r of rows) {
    const c = r[catField] == null ? '' : String(r[catField]);
    const v = toNum(r[valField]);
    if (v === null && agg !== 'count') continue;
    const arr = buckets.get(c) ?? [];
    if (v !== null) arr.push(v);
    buckets.set(c, arr);
  }
  return categories.map((c) => aggregate(buckets.get(c) ?? [], agg));
}

function baseOption(props: ChartBlockProps): EChartsOption {
  const isCat = props.chartType === 'bar' || props.chartType === 'line';
  const opt: EChartsOption = { animationDuration: 300 };
  if (props.title) opt.title = { text: props.title, left: 'center', textStyle: { fontSize: 14, fontWeight: 600 } };
  if (props.showTooltip) {
    opt.tooltip = { trigger: isCat ? 'axis' : 'item', confine: true, ...(isCat ? { axisPointer: { type: props.chartType === 'bar' ? 'shadow' : 'line' } } : {}) };
  }
  if (props.showLegend) opt.legend = { type: 'scroll', top: props.title ? 26 : 6 };
  if (props.chartType !== 'pie') {
    opt.grid = {
      left: 12, right: 16,
      top: (props.showLegend ? 44 : props.title ? 34 : 16),
      bottom: props.enableZoom ? 54 : 12,
      containLabel: true,
    };
  }
  return opt;
}

function withZoom(opt: EChartsOption, enable: boolean): EChartsOption {
  if (!enable) return opt;
  return { ...opt, dataZoom: [{ type: 'inside' }, { type: 'slider', bottom: 8, height: 18 }] };
}

function buildCartesian(props: ChartBlockProps, rows: Row[]): EChartsOption {
  const x = props.xField;
  const ys = props.yFields.filter(Boolean);
  if (!x || !ys.length) return { series: [] };
  const categories = uniqueInOrder(rows, x);
  const type = props.chartType === 'line' ? 'line' : 'bar';

  let series: EChartsOption['series'];
  if (props.groupField) {
    const y = ys[0];
    const groups = uniqueInOrder(rows, props.groupField);
    series = groups.map((g) => ({
      name: g, type,
      data: seriesValues(rows.filter((r) => String(r[props.groupField!] ?? '') === g), x, y, categories, props.aggregation),
    }));
  } else {
    series = ys.map((y) => ({ name: y, type, data: seriesValues(rows, x, y, categories, props.aggregation) }));
  }

  return withZoom({
    xAxis: { type: 'category', data: categories, name: x, nameLocation: 'middle', nameGap: 28, boundaryGap: type === 'bar' },
    yAxis: { type: 'value' },
    series,
  }, props.enableZoom);
}

function buildScatter(props: ChartBlockProps, rows: Row[]): EChartsOption {
  const x = props.xField;
  const ys = props.yFields.filter(Boolean);
  if (!x || !ys.length) return { series: [] };
  const point = (r: Row, y: string): [number, number] | null => {
    const xv = toNum(r[x]); const yv = toNum(r[y]);
    return xv === null || yv === null ? null : [xv, yv];
  };
  let series: EChartsOption['series'];
  if (props.groupField) {
    const y = ys[0];
    const groups = uniqueInOrder(rows, props.groupField);
    series = groups.map((g) => ({
      name: g, type: 'scatter',
      data: rows.filter((r) => String(r[props.groupField!] ?? '') === g).map((r) => point(r, y)).filter((p): p is [number, number] => p !== null),
    }));
  } else {
    series = ys.map((y) => ({
      name: y, type: 'scatter',
      data: rows.map((r) => point(r, y)).filter((p): p is [number, number] => p !== null),
    }));
  }
  return withZoom({
    xAxis: { type: 'value', name: x, nameLocation: 'middle', nameGap: 28 },
    yAxis: { type: 'value' },
    series,
  }, props.enableZoom);
}

function buildPie(props: ChartBlockProps, rows: Row[]): EChartsOption {
  const name = props.xField;
  const y = props.yFields.filter(Boolean)[0];
  if (!name || !y) return { series: [] };
  const categories = uniqueInOrder(rows, name);
  // Pie must collapse to one value per slice, so 'none' behaves as 'sum'.
  const agg: Aggregation = props.aggregation === 'none' ? 'sum' : props.aggregation;
  const values = seriesValues(rows, name, y, categories, agg);
  const data = categories.map((c, i) => ({ name: c, value: values[i] ?? 0 }));
  return {
    series: [{
      type: 'pie', name: y, radius: ['38%', '68%'], center: ['50%', '54%'],
      avoidLabelOverlap: true, itemStyle: { borderRadius: 4, borderWidth: 1 },
      label: { show: true }, data,
    }],
  };
}

/**
 * Build a complete ECharts option from typed chart props + data rows.
 * Supports bar/line/pie/scatter, multiple Y fields, optional group-by,
 * aggregation, legend/tooltip/data-zoom, and merges sanitized advancedOptions
 * last (styling only — cannot overwrite the data pipeline).
 */
export function buildEChartsOption(props: ChartBlockProps, rows: Row[]): EChartsOption {
  const base = baseOption(props);
  let body: EChartsOption;
  switch (props.chartType) {
    case 'pie': body = buildPie(props, rows); break;
    case 'scatter': body = buildScatter(props, rows); break;
    case 'line':
    case 'bar':
    default: body = buildCartesian(props, rows); break;
  }
  return mergeAdvancedOptions({ ...base, ...body }, props.advancedOptions);
}
