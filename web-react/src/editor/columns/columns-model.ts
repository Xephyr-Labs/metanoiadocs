// Two blocks, not one: `metanoia:columns` is the row, `metanoia:column` is a
// cell in it. The split is what makes the whole thing work with the rest of
// BlockSuite for free — a column is an ordinary container block, so the drag
// handle registers it as a drop target, the slash menu works inside it, and
// `renderChildren` paints whatever lands there.
import { BlockModel, BlockSchemaExtension, defineBlockSchema } from '@blocksuite/store';

export const COLUMNS_FLAVOUR = 'metanoia:columns';
export const COLUMN_FLAVOUR = 'metanoia:column';

export interface ColumnProps {
  /** Flex-grow share of the row. Equal columns are all 1; dragging a gutter
   *  moves share between two neighbours and always keeps their sum. */
  width: number;
}

export const MetanoiaColumnsBlockSchema = defineBlockSchema({
  flavour: COLUMNS_FLAVOUR,
  props: () => ({}),
  metadata: {
    version: 1,
    // 'content' rather than 'hub', because a note's children list is
    // `['@content', …]` — a hub here would be rejected by the note itself.
    role: 'content',
    parent: ['affine:note'],
    children: [COLUMN_FLAVOUR],
  },
  toModel: () => new MetanoiaColumnsBlockModel(),
});

export const MetanoiaColumnBlockSchema = defineBlockSchema({
  flavour: COLUMN_FLAVOUR,
  props: (): ColumnProps => ({ width: 1 }),
  metadata: { version: 1, role: 'hub', parent: [COLUMNS_FLAVOUR] },
  toModel: () => new MetanoiaColumnBlockModel(),
});

export const MetanoiaColumnsBlockSchemaExtension = BlockSchemaExtension(MetanoiaColumnsBlockSchema);
export const MetanoiaColumnBlockSchemaExtension = BlockSchemaExtension(MetanoiaColumnBlockSchema);

export class MetanoiaColumnsBlockModel extends BlockModel {}
export class MetanoiaColumnBlockModel extends BlockModel<ColumnProps> {}

declare global {
  interface BlockSuiteModelMap {
    [COLUMNS_FLAVOUR]: MetanoiaColumnsBlockModel;
    [COLUMN_FLAVOUR]: MetanoiaColumnBlockModel;
  }
}

/** The minimum share a column may be squeezed to, as a fraction of the pair
 *  being resized. Below this a column is too narrow to drop anything into. */
export const MIN_COLUMN_SHARE = 0.15;

interface SchemaLike { model?: { parent?: unknown } }

/**
 * Teach the built-in blocks that a column is a place they may live.
 *
 * BlockSuite validates a parent/child pair from BOTH sides: the parent's
 * `children` list and the child's own `parent` list. A column can declare
 * `children: ['*']`, but `affine:paragraph` names its permitted parents
 * explicitly (note, database, list, callout, …) and a flavour missing from that
 * list is rejected however permissive the container is. So the list has to be
 * extended, in place, on the shared schema objects — the same move
 * `database/effects.ts` makes on the surface schema.
 *
 * The rule is deliberately derived rather than hand-written: whatever a note
 * accepts, a column accepts. Blocks with no `parent` list at all (image,
 * divider, our chart/database) are already unrestricted and need nothing.
 */
export function allowColumnChildren(schemas: readonly SchemaLike[]): void {
  for (const schema of schemas) {
    const parents = schema?.model?.parent;
    if (!Array.isArray(parents)) continue;
    if (!parents.includes('affine:note') || parents.includes(COLUMN_FLAVOUR)) continue;
    try {
      parents.push(COLUMN_FLAVOUR);
    } catch {
      /* frozen: that flavour just can't be dropped into a column */
    }
  }
}
