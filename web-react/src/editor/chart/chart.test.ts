import { describe, expect, it } from 'vitest';
import { buildEChartsOption } from './buildEChartsOption';
import {
  migrateChartProps, mergeAdvancedOptions, normalizeChartProps, sanitizeAdvancedOptions,
} from './chart-schema';
import { CHART_SCHEMA_VERSION, defaultChartProps, type ChartBlockProps } from './chart-types';

const rows = [
  { month: 'Jan', revenue: 120, cost: 80, region: 'US' },
  { month: 'Feb', revenue: 200, cost: 120, region: 'US' },
  { month: 'Jan', revenue: 50, cost: 30, region: 'EU' },
];

const props = (over: Partial<ChartBlockProps> = {}): ChartBlockProps => ({ ...defaultChartProps(), xField: 'month', yFields: ['revenue', 'cost'], ...over });

const seriesArr = (o: unknown) => (o as { series?: unknown[] }).series ?? [];
const dataOf = (o: unknown, i: number) => (seriesArr(o)[i] as { data: unknown[] }).data;

describe('schema defaults + normalization', () => {
  it('defaults are valid and versioned', () => {
    const d = defaultChartProps();
    expect(d.version).toBe(CHART_SCHEMA_VERSION);
    expect(d.chartType).toBe('bar');
    expect(d.dataSource.sourceType).toBe('inline');
    expect(d.showLegend).toBe(true);
    expect(d.height).toBeGreaterThan(0);
  });

  it('coerces garbage input into a valid shape', () => {
    const n = normalizeChartProps({ chartType: 'donut', aggregation: 'median', height: 999999, yFields: 'nope', showLegend: 'yes' });
    expect(n.chartType).toBe('bar');        // invalid enum -> default
    expect(n.aggregation).toBe('none');     // invalid enum -> default
    expect(n.height).toBeLessThanOrEqual(2000); // clamped
    expect(Array.isArray(n.yFields)).toBe(true);
    expect(n.yFields).toEqual([]);          // non-array -> []
    expect(typeof n.showLegend).toBe('boolean');
  });

  it('missing/invalid data source falls back to inline', () => {
    expect(normalizeChartProps({}).dataSource.sourceType).toBe('inline');
    expect(normalizeChartProps({ dataSource: { sourceType: 'database' } }).dataSource.sourceType).toBe('inline'); // no id
    const db = normalizeChartProps({ dataSource: { sourceType: 'database', databaseBlockId: 'abc', viewId: 'v1' } }).dataSource;
    expect(db).toEqual({ sourceType: 'database', databaseBlockId: 'abc', viewId: 'v1' });
  });

  it('migrate stamps the current version', () => {
    expect(migrateChartProps({ version: 0, chartType: 'line' }).version).toBe(CHART_SCHEMA_VERSION);
  });
});

describe('buildEChartsOption — cartesian', () => {
  it('bar: categories from xField, one series per yField', () => {
    const o = buildEChartsOption(props({ chartType: 'bar', aggregation: 'sum' }), rows);
    expect((o.xAxis as { data: string[] }).data).toEqual(['Jan', 'Feb']);
    expect(seriesArr(o)).toHaveLength(2);
    expect((seriesArr(o)[0] as { type: string }).type).toBe('bar');
    expect(dataOf(o, 0)).toEqual([170, 200]); // revenue sum: Jan 120+50, Feb 200
    expect(dataOf(o, 1)).toEqual([110, 120]); // cost sum: Jan 80+30, Feb 120
  });

  it('line: series type is line', () => {
    const o = buildEChartsOption(props({ chartType: 'line' }), rows);
    expect((seriesArr(o)[0] as { type: string }).type).toBe('line');
  });

  it("aggregation 'none' keeps last value per category", () => {
    const o = buildEChartsOption(props({ yFields: ['revenue'], aggregation: 'none' }), rows);
    expect(dataOf(o, 0)).toEqual([50, 200]); // Jan last = 50, Feb = 200
  });

  it.each([
    ['sum', [170, 200]],
    ['avg', [85, 200]],
    ['min', [50, 200]],
    ['max', [120, 200]],
    ['count', [2, 1]],
  ] as const)('aggregation %s', (agg, expected) => {
    const o = buildEChartsOption(props({ yFields: ['revenue'], aggregation: agg }), rows);
    expect(dataOf(o, 0)).toEqual(expected);
  });

  it('group-by yields one series per group value', () => {
    const o = buildEChartsOption(props({ yFields: ['revenue'], groupField: 'region', aggregation: 'sum' }), rows);
    const names = seriesArr(o).map((s) => (s as { name: string }).name).sort();
    expect(names).toEqual(['EU', 'US']);
    const us = seriesArr(o).find((s) => (s as { name: string }).name === 'US') as { data: unknown[] };
    const eu = seriesArr(o).find((s) => (s as { name: string }).name === 'EU') as { data: unknown[] };
    expect(us.data).toEqual([120, 200]);   // Jan, Feb
    expect(eu.data).toEqual([50, null]);    // EU has no Feb row
  });

  it('data zoom only when enabled', () => {
    expect(buildEChartsOption(props(), rows).dataZoom).toBeUndefined();
    expect(buildEChartsOption(props({ enableZoom: true }), rows).dataZoom).toBeTruthy();
  });
});

describe('buildEChartsOption — pie + scatter', () => {
  it('pie collapses to one slice per category (none -> sum)', () => {
    const o = buildEChartsOption(props({ chartType: 'pie', yFields: ['revenue'], aggregation: 'none' }), rows);
    const data = dataOf(o, 0) as Array<{ name: string; value: number }>;
    expect(data).toEqual([{ name: 'Jan', value: 170 }, { name: 'Feb', value: 200 }]);
  });

  it('scatter builds [x,y] points and drops invalid ones', () => {
    const bad = [...rows, { month: 'Mar', revenue: 'nope', cost: 10 }];
    const o = buildEChartsOption(props({ chartType: 'scatter', xField: 'revenue', yFields: ['cost'] }), bad);
    expect((seriesArr(o)[0] as { type: string }).type).toBe('scatter');
    expect(dataOf(o, 0)).toEqual([[120, 80], [200, 120], [50, 30]]); // Mar dropped (x not numeric)
  });
});

describe('invalid / empty data', () => {
  it('missing xField or yFields -> empty series', () => {
    expect(seriesArr(buildEChartsOption(props({ xField: undefined }), rows))).toEqual([]);
    expect(seriesArr(buildEChartsOption(props({ yFields: [] }), rows))).toEqual([]);
  });

  it('non-numeric y cells become null (not NaN)', () => {
    const dirty = [{ month: 'Jan', revenue: 'x' }, { month: 'Feb', revenue: 5 }];
    const o = buildEChartsOption(props({ yFields: ['revenue'], aggregation: 'sum' }), dirty);
    expect(dataOf(o, 0)).toEqual([null, 5]);
  });

  it('empty rows -> valid option with empty series', () => {
    const o = buildEChartsOption(props(), []);
    expect(Array.isArray(seriesArr(o))).toBe(true);
    seriesArr(o).forEach((s) => expect((s as { data: unknown[] }).data).toEqual([]));
  });
});

describe('security — sanitize + safe merge', () => {
  it('strips functions and undefined; blocks prototype-pollution keys', () => {
    const dirty = { color: '#fff', evil: () => 1, gone: undefined, ['__proto__']: { polluted: true }, nested: { fn() {}, ok: 2 } };
    const clean = sanitizeAdvancedOptions(dirty)!;
    expect(clean.color).toBe('#fff');
    expect('evil' in clean).toBe(false);
    expect('gone' in clean).toBe(false);
    expect((clean as Record<string, unknown>).nested).toEqual({ ok: 2 });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined(); // Object.prototype untouched
  });

  it('advancedOptions cannot overwrite series/dataset', () => {
    const base = { series: [{ type: 'bar', data: [1] }], color: ['#000'] };
    const merged = mergeAdvancedOptions(base, { series: [{ type: 'evil' }], dataset: { source: [] }, color: ['#f00'] });
    expect(merged.series).toEqual([{ type: 'bar', data: [1] }]); // protected
    expect((merged as { dataset?: unknown }).dataset).toBeUndefined();
    expect(merged.color).toEqual(['#f00']); // styling merges
  });

  it('deep merge is prototype-pollution safe', () => {
    const merged = mergeAdvancedOptions({ grid: { left: 1 } }, JSON.parse('{"grid":{"__proto__":{"x":1},"right":2}}'));
    expect((merged.grid as Record<string, unknown>).right).toBe(2);
    expect(({} as Record<string, unknown>).x).toBeUndefined();
  });

  it('normalizeChartProps sanitizes advancedOptions', () => {
    const n = normalizeChartProps({ advancedOptions: { animation: false, bad: () => 1 } });
    expect(n.advancedOptions).toEqual({ animation: false });
  });
});
