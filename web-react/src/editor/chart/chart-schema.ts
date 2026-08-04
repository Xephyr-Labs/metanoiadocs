// Validation, safe defaults, migration and JSON sanitization for chart props.
// Pure — no BlockSuite/ECharts runtime. Everything here must tolerate arbitrary
// untrusted input (persisted docs, imported JSON, collaboration) and always
// return a well-formed value.

import {
  AGGREGATIONS, CHART_SCHEMA_VERSION, CHART_TYPES, DEFAULT_CHART_HEIGHT,
  MAX_CHART_HEIGHT, MIN_CHART_HEIGHT, defaultChartProps, sampleInlineData,
  type Aggregation, type ChartBlockProps, type ChartDataSource, type ChartType,
  type CellValue, type InlineChartData,
} from './chart-types';

const clampHeight = (h: unknown): number => {
  const n = typeof h === 'number' && Number.isFinite(h) ? h : DEFAULT_CHART_HEIGHT;
  return Math.min(MAX_CHART_HEIGHT, Math.max(MIN_CHART_HEIGHT, Math.round(n)));
};

const asStringArray = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  (typeof v === 'string' && (allowed as readonly string[]).includes(v)) ? (v as T) : fallback;

// Keys that must never appear in any object we build from untrusted input —
// blocks prototype pollution when this data is later merged/spread.
const POLLUTION_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function normalizeInline(v: unknown): InlineChartData {
  const o = (v && typeof v === 'object') ? v as Record<string, unknown> : {};
  let columns = asStringArray(o.columns).filter((c) => !POLLUTION_KEYS.has(c));
  const rawRows = Array.isArray(o.rows) ? o.rows : [];
  const rows: Array<Record<string, CellValue>> = [];
  for (const r of rawRows) {
    if (!r || typeof r !== 'object') continue;
    const row: Record<string, CellValue> = Object.create(null) as Record<string, CellValue>;
    for (const [k, val] of Object.entries(r as Record<string, unknown>)) {
      if (POLLUTION_KEYS.has(k)) continue;
      row[k] = (typeof val === 'number' || typeof val === 'string' || val === null) ? val : null;
    }
    rows.push({ ...row });
  }
  // Derive columns from row keys if none were declared.
  if (!columns.length && rows.length) {
    const seen = new Set<string>();
    for (const r of rows) for (const k of Object.keys(r)) if (!seen.has(k)) { seen.add(k); columns.push(k); }
  }
  if (!columns.length && !rows.length) return sampleInlineData();
  return { sourceType: 'inline', columns, rows };
}

function normalizeDataSource(v: unknown): ChartDataSource {
  const o = (v && typeof v === 'object') ? v as Record<string, unknown> : {};
  if (o.sourceType === 'database') {
    const id = typeof o.databaseBlockId === 'string' ? o.databaseBlockId : '';
    const viewId = typeof o.viewId === 'string' ? o.viewId : undefined;
    if (id) return { sourceType: 'database', databaseBlockId: id, viewId };
    // Missing reference → fall back to a valid inline source rather than crash.
    return sampleInlineData();
  }
  return normalizeInline(o);
}

/**
 * Coerce any (possibly partial / corrupt / untrusted) value into a fully valid
 * ChartBlockProps. Never throws; unknown fields are dropped, invalid enums fall
 * back to defaults, height is clamped.
 */
export function normalizeChartProps(raw: unknown): ChartBlockProps {
  const d = defaultChartProps();
  const o = (raw && typeof raw === 'object') ? raw as Record<string, unknown> : {};
  const chartType: ChartType = oneOf(o.chartType, CHART_TYPES, d.chartType);
  const aggregation: Aggregation = oneOf(o.aggregation, AGGREGATIONS, d.aggregation);
  const dataSource = normalizeDataSource(o.dataSource);
  const yFields = asStringArray(o.yFields);
  return {
    version: typeof o.version === 'number' ? o.version : CHART_SCHEMA_VERSION,
    chartType,
    title: typeof o.title === 'string' ? o.title.slice(0, 300) : d.title,
    dataSource,
    xField: typeof o.xField === 'string' ? o.xField : undefined,
    yFields,
    groupField: typeof o.groupField === 'string' && o.groupField ? o.groupField : undefined,
    aggregation,
    showLegend: typeof o.showLegend === 'boolean' ? o.showLegend : d.showLegend,
    showTooltip: typeof o.showTooltip === 'boolean' ? o.showTooltip : d.showTooltip,
    enableZoom: typeof o.enableZoom === 'boolean' ? o.enableZoom : d.enableZoom,
    height: clampHeight(o.height),
    advancedOptions: sanitizeAdvancedOptions(o.advancedOptions),
  };
}

/**
 * Deep-clone an untrusted value into strictly-serializable JSON: drops
 * functions, symbols, undefined; blocks prototype-pollution keys; caps depth and
 * breadth so a hostile doc can't blow up memory. Returns undefined when empty.
 */
export function sanitizeAdvancedOptions(input: unknown, maxDepth = 12): Record<string, unknown> | undefined {
  const out = sanitizeJson(input, maxDepth);
  return (out && typeof out === 'object' && !Array.isArray(out) && Object.keys(out).length)
    ? out as Record<string, unknown>
    : undefined;
}

function sanitizeJson(value: unknown, depth: number): unknown {
  if (depth < 0) return undefined;
  if (value === null) return null;
  const t = typeof value;
  if (t === 'number') return Number.isFinite(value as number) ? value : undefined;
  if (t === 'string' || t === 'boolean') return value;
  if (t === 'function' || t === 'symbol' || t === 'undefined' || t === 'bigint') return undefined; // no callbacks
  if (Array.isArray(value)) {
    const arr: unknown[] = [];
    for (const item of value.slice(0, 5000)) { const s = sanitizeJson(item, depth - 1); if (s !== undefined) arr.push(s); }
    return arr;
  }
  const obj: Record<string, unknown> = {};
  let count = 0;
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (POLLUTION_KEYS.has(k)) continue;
    if (++count > 2000) break;
    const s = sanitizeJson(v, depth - 1);
    if (s !== undefined) obj[k] = s;
  }
  return obj;
}

export { POLLUTION_KEYS };

// Top-level ECharts keys the adapter owns; advancedOptions may NOT replace them
// (they carry the data pipeline + lifecycle-critical config). advancedOptions is
// for styling — colors, axis labels, grid, animation, etc.
const PROTECTED_TOP_KEYS = new Set(['dataset', 'series']);

/**
 * Deep-merge already-sanitized advancedOptions onto a base ECharts option.
 * Protected top-level keys are ignored from the override; prototype-pollution
 * keys are blocked at every level. `base` is treated as owned/trusted.
 */
export function mergeAdvancedOptions<T extends Record<string, unknown>>(
  base: T, advanced: Record<string, unknown> | undefined,
): T {
  if (!advanced) return base;
  const clean = sanitizeAdvancedOptions(advanced);
  if (!clean) return base;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(clean)) {
    if (POLLUTION_KEYS.has(k) || PROTECTED_TOP_KEYS.has(k)) continue;
    out[k] = deepMerge(out[k], v);
  }
  return out as T;
}

function deepMerge(base: unknown, override: unknown): unknown {
  if (Array.isArray(override)) return override.slice();
  if (override && typeof override === 'object') {
    const target: Record<string, unknown> =
      (base && typeof base === 'object' && !Array.isArray(base)) ? { ...(base as Record<string, unknown>) } : {};
    for (const [k, v] of Object.entries(override as Record<string, unknown>)) {
      if (POLLUTION_KEYS.has(k)) continue;
      target[k] = deepMerge(target[k], v);
    }
    return target;
  }
  return override;
}

/** Migrate a persisted props object across schema versions. Currently v1 only. */
export function migrateChartProps(raw: unknown): ChartBlockProps {
  const props = normalizeChartProps(raw);
  // Future migrations: `if (props.version < 2) { …; props.version = 2; }`
  props.version = CHART_SCHEMA_VERSION;
  return props;
}
