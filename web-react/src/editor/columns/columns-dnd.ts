// Notion's "drag a block to the side of another and it becomes a column".
//
// We watch the same drag BlockSuite's drag handle is watching, through the
// public `std.dnd.monitor`, and when the pointer is over the side of a block we
// build columns instead of letting it drop above or below. The one thing that
// cannot be done from outside is stop the built-in handler acting as well — but
// it routes every page drop through `_getDropResult`, and a null from there is
// already its own "nothing to do here". Patching that one function to return
// null for exactly the drops we claim leaves the other 99% of drag and drop
// untouched, and silences its horizontal drop indicator so ours is the only
// line on screen.
//
// BlockSuite's drop payload does carry an `edge`, and it is tempting to use it.
// It is useless here: pragmatic-drag-and-drop picks the nearest edge by
// absolute pixel distance, so on a paragraph — 700px wide and 34px tall —
// 'top'/'bottom' win everywhere except within ~17px of the ends. The side zone
// has to be measured as a share of the block's own width instead.
import {
  COLUMN_FLAVOUR, COLUMNS_FLAVOUR,
} from './columns-model';

export type Side = 'left' | 'right';

/** Widest and narrowest a side zone may get, in pixels. */
const SIDE_ZONE = { share: 0.2, min: 32, max: 96 };

/** Which side of a block the pointer is on, or null for "in the middle" —
 *  which means an ordinary drop above or below it. */
export function sideForDrop(rect: { left: number; width: number }, clientX: number): Side | null {
  if (rect.width <= 0) return null;
  const zone = Math.min(Math.max(rect.width * SIDE_ZONE.share, SIDE_ZONE.min), SIDE_ZONE.max);
  // A block narrower than two zones has no middle left; treat the halves as
  // sides rather than making columns impossible inside an existing column.
  if (clientX <= rect.left + zone) return 'left';
  if (clientX >= rect.left + rect.width - zone) return 'right';
  return null;
}

export type ColumnDropPlan =
  /** The target is loose in the note: wrap it and the dragged blocks in a new row. */
  | { kind: 'wrap'; targetId: string; side: Side }
  /** The target already sits in a row: add one more column next to it. */
  | { kind: 'beside'; columnId: string; side: Side };

export interface ModelLike {
  id: string;
  flavour: string;
  children?: ModelLike[];
}

export interface StoreLike {
  readonly?: boolean;
  getParent(model: ModelLike): ModelLike | null;
  getModelById(id: string): ModelLike | null;
  addBlock(flavour: string, props: object, parent?: ModelLike | string, index?: number): string;
  moveBlocks(
    models: ModelLike[],
    newParent: ModelLike,
    targetSibling?: ModelLike | null,
    insertBeforeSibling?: boolean,
  ): void;
  deleteBlock(model: ModelLike): void;
  captureSync?(): void;
}

/** Is `model` the block being dragged, or inside it? Dropping a block into
 *  itself would detach the subtree from the document. */
function isDragged(store: StoreLike, model: ModelLike | null, draggedIds: readonly string[]): boolean {
  for (let m = model; m; m = store.getParent(m)) {
    if (draggedIds.includes(m.id)) return true;
  }
  return false;
}

/**
 * Decide what a side-edge drop should do — or nothing, and let BlockSuite
 * handle it as it always has. Pure, so the rules are testable without a
 * document, an editor or a pointer.
 */
export function planColumnDrop({
  store, side, target, draggedIds, draggedFlavours, sameDoc,
}: {
  store: StoreLike;
  side: Side | null;
  target: ModelLike | null;
  draggedIds: readonly string[];
  draggedFlavours: readonly string[];
  sameDoc: boolean;
}): ColumnDropPlan | null {
  // A drag from another document arrives as a snapshot, not as models we can
  // move; leave those to BlockSuite's transformer and its before/after drop.
  if (!sameDoc || !side || !target || !draggedIds.length) return null;
  if (store.readonly) return null;
  if (isDragged(store, target, draggedIds)) return null;

  // BlockSuite gives the right edge of a list its own meaning — nesting a
  // dropped list as a sub-list. Keep it: a reader who wants a sub-list has no
  // other gesture, and a reader who wants columns can still use the paragraph
  // above or the slash menu.
  if (target.flavour === 'affine:list' && side === 'right' &&
      draggedFlavours.every(f => f === 'affine:list')) return null;

  // The row itself is not a column target — nesting a row inside a row is
  // rejected by the schema, and it is not what side-dropping on one should do.
  if (target.flavour === COLUMNS_FLAVOUR) return null;

  if (target.flavour === COLUMN_FLAVOUR) return { kind: 'beside', columnId: target.id, side };

  const parent = store.getParent(target);
  if (!parent) return null;
  if (parent.flavour === COLUMN_FLAVOUR) return { kind: 'beside', columnId: parent.id, side };
  // Only blocks sitting directly in the page body can start a row. Inside a
  // callout, a list or a database the container owns its own layout, and
  // wrapping there would be a surprise rather than a shortcut.
  if (parent.flavour === 'affine:note') return { kind: 'wrap', targetId: target.id, side };
  return null;
}

/** Carry out a plan. Returns the row (`metanoia:columns`) that now holds the
 *  dropped blocks, or null if the document moved under us. */
export function applyColumnDrop(
  store: StoreLike,
  plan: ColumnDropPlan,
  dragged: readonly ModelLike[],
): ModelLike | null {
  store.captureSync?.();
  const moved = [...dragged];

  if (plan.kind === 'wrap') {
    const target = store.getModelById(plan.targetId);
    const note = target && store.getParent(target);
    if (!target || !note) return null;
    const at = (note.children ?? []).indexOf(target);
    const row = store.getModelById(store.addBlock(COLUMNS_FLAVOUR, {}, note, at < 0 ? undefined : at));
    if (!row) return null;
    // The target moves into its own column first, so the row is never empty
    // and the two columns come out in the reader's order.
    const keep = store.getModelById(store.addBlock(COLUMN_FLAVOUR, { width: 1 }, row));
    if (!keep) return null;
    store.moveBlocks([target], keep);
    const dropped = store.getModelById(
      store.addBlock(COLUMN_FLAVOUR, { width: 1 }, row, plan.side === 'left' ? 0 : 1),
    );
    if (!dropped) return null;
    store.moveBlocks(moved, dropped);
    return row;
  }

  const column = store.getModelById(plan.columnId);
  const row = column && store.getParent(column);
  if (!column || !row) return null;
  const at = (row.children ?? []).indexOf(column) + (plan.side === 'left' ? 0 : 1);
  // The new column takes an even share of the row rather than of its
  // neighbour: a fresh column that arrives a sliver wide can't be read.
  const dropped = store.getModelById(store.addBlock(COLUMN_FLAVOUR, { width: 1 }, row, at));
  if (!dropped) return null;
  store.moveBlocks(moved, dropped);
  return row;
}

/**
 * Remove columns that nothing is left in, and unwrap a row down to its last
 * column — otherwise dragging the only block out of a two-column row leaves an
 * empty half of the page that cannot be clicked, typed in or deleted.
 *
 * This runs off document changes rather than only after our own drops, because
 * a column can also empty out from a plain backspace or from BlockSuite's own
 * drag handler moving its last block away.
 */
export function tidyColumns(store: StoreLike, root: ModelLike | null | undefined): boolean {
  if (!root || store.readonly) return false;
  let changed = false;
  const walk = (model: ModelLike) => {
    for (const child of [...(model.children ?? [])]) walk(child);
    if (model.flavour !== COLUMNS_FLAVOUR) return;
    for (const column of [...(model.children ?? [])]) {
      if ((column.children ?? []).length === 0) { store.deleteBlock(column); changed = true; }
    }
    const columns = model.children ?? [];
    if (columns.length === 0) { store.deleteBlock(model); changed = true; return; }
    if (columns.length === 1) {
      const note = store.getParent(model);
      if (!note) return;
      // Back where the row was — moving without a sibling appends, which sends
      // the last block of a two-column layout to the bottom of the document.
      store.moveBlocks([...(columns[0].children ?? [])], note, model, true);
      store.deleteBlock(model);
      changed = true;
    }
  };
  walk(root);
  return changed;
}

/** Seed a row of `count` empty columns after `sibling` (slash menu). */
export function insertColumnRow(store: StoreLike, sibling: ModelLike, count: number): string | null {
  const parent = store.getParent(sibling);
  if (!parent) return null;
  const at = (parent.children ?? []).indexOf(sibling) + 1;
  const rowId = store.addBlock(COLUMNS_FLAVOUR, {}, parent, at);
  const row = store.getModelById(rowId);
  if (!row) return null;
  for (let i = 0; i < count; i++) {
    const columnId = store.addBlock(COLUMN_FLAVOUR, { width: 1 }, row);
    // An empty column has nothing to aim at: the drag handle only offers a drop
    // on a block, so a column with no blocks in it can never receive one. The
    // placeholder paragraph is also where the caret lands when it is clicked.
    store.addBlock('affine:paragraph', {}, columnId);
  }
  return rowId;
}
