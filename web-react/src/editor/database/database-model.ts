import type { GfxCommonBlockProps, GfxElementGeometry } from '@blocksuite/std/gfx';
import { GfxCompatible } from '@blocksuite/std/gfx';
import { BlockModel, BlockSchemaExtension, defineBlockSchema } from '@blocksuite/store';

export const DATABASE_FLAVOUR = 'metanoia:database';

export interface DatabaseBlockProps {
  /** The project (database) this view reads. Empty until one is picked. */
  projectId: string;
  view: 'board' | 'table';
  height: number;
}

export type MetanoiaDatabaseProps = DatabaseBlockProps & Omit<GfxCommonBlockProps, 'scale'>;

export function defaultDatabaseProps(): DatabaseBlockProps {
  return { projectId: '', view: 'table', height: 360 };
}

export const MetanoiaDatabaseBlockSchema = defineBlockSchema({
  flavour: DATABASE_FLAVOUR,
  props: (): MetanoiaDatabaseProps => ({
    ...defaultDatabaseProps(),
    index: 'a0',
    xywh: '[0,0,640,360]',
    lockedBySelf: false,
    rotate: 0,
  }),
  metadata: { version: 1, role: 'content' },
  toModel: () => new MetanoiaDatabaseBlockModel(),
});

export const MetanoiaDatabaseBlockSchemaExtension = BlockSchemaExtension(MetanoiaDatabaseBlockSchema);

export class MetanoiaDatabaseBlockModel
  extends GfxCompatible<MetanoiaDatabaseProps>(BlockModel)
  implements GfxElementGeometry {}

declare global {
  interface BlockSuiteModelMap {
    [DATABASE_FLAVOUR]: MetanoiaDatabaseBlockModel;
  }
}
