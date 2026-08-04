// BlockSuite model + schema for `metanoia:chart`. Mirrors the built-in image
// block: a gfx-compatible model so ONE flavour renders in both Page and
// Edgeless. The chart config (ChartBlockProps) is stored as plain block props;
// the gfx props (xywh/index/rotate) make it an edgeless element.

import type { GfxCommonBlockProps, GfxElementGeometry } from '@blocksuite/std/gfx';
import { GfxCompatible } from '@blocksuite/std/gfx';
import { BlockModel, BlockSchemaExtension, defineBlockSchema } from '@blocksuite/store';

import { CHART_SCHEMA_VERSION, defaultChartProps, type ChartBlockProps } from './chart-types';

export const CHART_FLAVOUR = 'metanoia:chart';

// Chart config + the gfx geometry props required to live on the edgeless surface
// (xywh, index, lockedBySelf, rotate). `scale` is intentionally omitted, like image.
export type MetanoiaChartProps = ChartBlockProps & Omit<GfxCommonBlockProps, 'scale'>;

function defaultProps(): MetanoiaChartProps {
  return {
    ...defaultChartProps(),
    index: 'a0',
    xywh: '[0,0,520,380]',
    lockedBySelf: false,
    rotate: 0,
  };
}

export const MetanoiaChartBlockSchema = defineBlockSchema({
  flavour: CHART_FLAVOUR,
  props: () => defaultProps(),
  metadata: {
    version: CHART_SCHEMA_VERSION,
    role: 'content',
  },
  toModel: () => new MetanoiaChartBlockModel(),
});

export const MetanoiaChartBlockSchemaExtension = BlockSchemaExtension(MetanoiaChartBlockSchema);

export class MetanoiaChartBlockModel
  extends GfxCompatible<MetanoiaChartProps>(BlockModel)
  implements GfxElementGeometry {}

declare global {
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
  interface BlockSuiteModelMap {
    [CHART_FLAVOUR]: MetanoiaChartBlockModel;
  }
}
