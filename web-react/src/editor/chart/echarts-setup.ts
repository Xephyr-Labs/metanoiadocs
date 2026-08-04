// Modular ECharts registration — only the chart types + components this block
// needs, on the canvas renderer, to keep the bundle small. This module is
// dynamically imported by the renderer so ECharts stays out of the main bundle
// and only loads for docs that contain a chart.

import * as echarts from 'echarts/core';
import { BarChart, LineChart, PieChart, ScatterChart } from 'echarts/charts';
import {
  DataZoomComponent, DatasetComponent, GridComponent, LegendComponent,
  TitleComponent, TooltipComponent, TransformComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([
  BarChart, LineChart, PieChart, ScatterChart,
  TooltipComponent, LegendComponent, GridComponent, DatasetComponent,
  DataZoomComponent, TitleComponent, TransformComponent,
  CanvasRenderer,
]);

export { echarts };
export type EChartsInstance = echarts.ECharts;
