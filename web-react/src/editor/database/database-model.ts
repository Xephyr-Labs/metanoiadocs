import type { GfxCommonBlockProps, GfxElementGeometry } from '@blocksuite/std/gfx';
import { GfxCompatible } from '@blocksuite/std/gfx';
import { BlockModel, BlockSchemaExtension, defineBlockSchema } from '@blocksuite/store';

export const DATABASE_FLAVOUR = 'metanoia:database';

/** Every view the project screen offers, offered here too. */
export type EmbeddedView = 'backlog' | 'board' | 'table' | 'gantt' | 'calendar' | 'gallery';

export const EMBEDDED_VIEWS: EmbeddedView[] = ['backlog', 'board', 'table', 'gantt', 'calendar', 'gallery'];

export interface DatabaseBlockProps {
  /** The project (database) this view reads. Empty until one is picked. */
  projectId: string;
  view: EmbeddedView;
  /** 'full' breaks the block out of the page's reading measure, out to the
   *  editor's own column — what a fifteen-column table needs and a paragraph
   *  does not. Stored on the block, so two databases on one page can differ. */
  width: 'column' | 'full';
  /** Draw the database's icon and name above the view. */
  header: boolean;
  /** Height of the views that are a viewport by nature (board, gantt,
   *  calendar, gallery, backlog). The table ignores it and grows. */
  height: number;
}

export type MetanoiaDatabaseProps = DatabaseBlockProps & Omit<GfxCommonBlockProps, 'scale'>;

export function defaultDatabaseProps(): DatabaseBlockProps {
  return { projectId: '', view: 'table', width: 'column', header: true, height: 360 };
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
