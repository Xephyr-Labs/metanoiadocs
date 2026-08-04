// Typed, stable schema for the `metanoia:chart` block. This module is pure data
// + types with NO BlockSuite or ECharts runtime dependency, so it can be unit
// tested and reused by both the renderer and the config UI.

export const CHART_SCHEMA_VERSION = 1;

export type ChartType = 'bar' | 'line' | 'pie' | 'scatter';

export type Aggregation = 'none' | 'sum' | 'avg' | 'min' | 'max' | 'count';

export type CellValue = string | number | null;

export interface InlineChartData {
  sourceType: 'inline';
  columns: string[];
  rows: Array<Record<string, CellValue>>;
}

export interface DatabaseChartData {
  sourceType: 'database';
  databaseBlockId: string;
  viewId?: string;
}

export type ChartDataSource = InlineChartData | DatabaseChartData;

export interface ChartBlockProps {
  /** Bumped when the persisted shape changes; drives migration. */
  version: number;
  chartType: ChartType;
  title?: string;
  dataSource: ChartDataSource;
  xField?: string;
  yFields: string[];
  groupField?: string;
  aggregation: Aggregation;
  showLegend: boolean;
  showTooltip: boolean;
  enableZoom: boolean;
  height: number;
  /** Serializable-JSON-only extra ECharts options merged last, guarded so it
   *  cannot clobber lifecycle-critical config. Never contains functions. */
  advancedOptions?: Record<string, unknown>;
}

export const CHART_TYPES: ChartType[] = ['bar', 'line', 'pie', 'scatter'];
export const AGGREGATIONS: Aggregation[] = ['none', 'sum', 'avg', 'min', 'max', 'count'];

export const MIN_CHART_HEIGHT = 120;
export const MAX_CHART_HEIGHT = 2000;
export const DEFAULT_CHART_HEIGHT = 320;

/** A small, valid inline dataset used when a chart is first inserted. */
export function sampleInlineData(): InlineChartData {
  return {
    sourceType: 'inline',
    columns: ['month', 'revenue', 'cost'],
    rows: [
      { month: 'Jan', revenue: 120, cost: 80 },
      { month: 'Feb', revenue: 200, cost: 120 },
      { month: 'Mar', revenue: 150, cost: 110 },
      { month: 'Apr', revenue: 280, cost: 160 },
      { month: 'May', revenue: 240, cost: 150 },
    ],
  };
}

/** Safe defaults for a freshly inserted chart block. */
export function defaultChartProps(): ChartBlockProps {
  return {
    version: CHART_SCHEMA_VERSION,
    chartType: 'bar',
    title: '',
    dataSource: sampleInlineData(),
    xField: 'month',
    yFields: ['revenue', 'cost'],
    groupField: undefined,
    aggregation: 'none',
    showLegend: true,
    showTooltip: true,
    enableZoom: false,
    height: DEFAULT_CHART_HEIGHT,
    advancedOptions: undefined,
  };
}
