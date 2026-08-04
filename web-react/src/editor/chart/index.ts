// Public surface for wiring the chart block into the editor (see mountEditor.ts):
//   - chartEffects()                    -> register custom elements once
//   - MetanoiaChartBlockSchema          -> schema.register([...])
//   - MetanoiaChartBlockSchemaExtension -> collection.storeExtensions
//   - chartViewExtensions               -> spread into pageSpecs + edgelessSpecs
export { chartEffects } from './effects';
export { chartViewExtensions } from './spec';
export {
  CHART_FLAVOUR, MetanoiaChartBlockSchema, MetanoiaChartBlockSchemaExtension,
  MetanoiaChartBlockModel, type MetanoiaChartProps,
} from './chart-model';
export { buildEChartsOption } from './buildEChartsOption';
export { normalizeChartProps, migrateChartProps, mergeAdvancedOptions, sanitizeAdvancedOptions } from './chart-schema';
export { resolveChartData } from './data-source';
export * from './chart-types';
