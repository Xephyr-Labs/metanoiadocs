// Editing a row of columns after it exists: add one, remove one, change the
// count, even out the widths, and step back out of a column into the page.
//
// Pure functions over a store, like columns-dnd.ts — the hover menu in
// columns-block.ts and the keymap both call these, and the tests drive them
// with the same fake store the drop rules use.
import { ensureTrailingParagraph, tidyColumns, type ModelLike, type StoreLike } from './columns-dnd';
import { COLUMN_FLAVOUR, COLUMNS_FLAVOUR } from './columns-model';

// Re-exported so everything that edits a row is reachable from one module.
export { ensureTrailingParagraph };

/** Adding and resizing need one more method than a drop does. */
export interface OpsStore extends StoreLike {
  updateBlock(model: ModelLike, props: Record<string, unknown>): void;
}

/** A paragraph carries its text; an empty one is what Enter steps out of. */
export interface TextModelLike extends ModelLike {
  text?: { length: number } | null;
  props?: { width?: number } | null;
}

/** Notion caps a row at four columns — past that a column is too narrow to
 *  read, and the gutters eat more width than the text. */
export const MAX_COLUMNS = 4;

const shareOf = (model: TextModelLike): number => {
  const width = model.props?.width;
  return typeof width === 'number' && width > 0 ? width : 1;
};

const columnsOf = (row: ModelLike): TextModelLike[] => (row.children ?? []) as TextModelLike[];

/** The row a column, or a block inside one, belongs to — null for anything
 *  that is not in a row at all. */
export function rowOf(store: StoreLike, model: ModelLike | null): ModelLike | null {
  for (let m = model; m; m = store.getParent(m)) {
    if (m.flavour === COLUMNS_FLAVOUR) return m;
  }
  return null;
}

/** The column a block sits in, or null. */
export function columnOf(store: StoreLike, model: ModelLike | null): ModelLike | null {
  for (let m = model; m; m = store.getParent(m)) {
    if (m.flavour === COLUMN_FLAVOUR) return m;
  }
  return null;
}

/** Every row `model` sits inside, innermost first. */
function rowChain(store: StoreLike, model: ModelLike | null): ModelLike[] {
  const rows: ModelLike[] = [];
  for (let m = model; m; m = store.getParent(m)) {
    if (m.flavour === COLUMNS_FLAVOUR) rows.push(m);
  }
  return rows;
}

/** The column of `row` that `model` is in, or null. */
function columnUnder(store: StoreLike, model: ModelLike, row: ModelLike): ModelLike | null {
  let last: ModelLike | null = null;
  for (let m: ModelLike | null = model; m; m = store.getParent(m)) {
    if (m.flavour === COLUMN_FLAVOUR) last = m;
    if (m.id === row.id) return last && store.getParent(last)?.id === row.id ? last : null;
  }
  return null;
}

/**
 * The row a selection runs across, when its two ends sit in different columns
 * of the same row — the case where a dragged text selection paints across the
 * gutter but means nothing to the editor, because no text range can span two
 * columns. The caller turns that into a block selection of the whole row.
 *
 * Null for a selection inside one column, or one that has nothing to do with
 * columns at all: those are ordinary text selections and must be left alone.
 */
export function crossColumnRow(
  store: StoreLike, start: ModelLike | null, end: ModelLike | null,
): ModelLike | null {
  if (!start || !end) return null;
  const ends = rowChain(store, end);
  for (const row of rowChain(store, start)) {
    if (!ends.some((r) => r.id === row.id)) continue;
    const a = columnUnder(store, start, row);
    const b = columnUnder(store, end, row);
    return a && b && a.id !== b.id ? row : null;
  }
  return null;
}

/** A new column beside `column`, sized like the ones already there so it does
 *  not arrive as a sliver next to a widened neighbour. Returns its id, or null
 *  when the row is already full. */
export function addColumn(store: OpsStore, column: ModelLike, side: 'left' | 'right'): string | null {
  const row = store.getParent(column);
  if (!row || store.readonly) return null;
  const siblings = columnsOf(row);
  if (siblings.length >= MAX_COLUMNS) return null;
  const at = siblings.indexOf(column as TextModelLike) + (side === 'left' ? 0 : 1);
  const mean = siblings.reduce((sum, c) => sum + shareOf(c), 0) / (siblings.length || 1);
  store.captureSync?.();
  const id = store.addBlock(COLUMN_FLAVOUR, { width: mean }, row, at < 0 ? undefined : at);
  const added = store.getModelById(id);
  // Same reason as insertColumnRow: an empty column has nothing to click, to
  // type in, or to drop onto.
  if (added) store.addBlock('affine:paragraph', {}, added);
  return id;
}

/**
 * Delete a column and everything in it. The row unwraps itself when only one
 * column is left, so removing a column can never strand a half-page nobody can
 * reach — the same rule the drop sweep applies.
 */
export function deleteColumn(store: OpsStore, column: ModelLike): boolean {
  const row = store.getParent(column);
  if (!row || store.readonly) return false;
  store.captureSync?.();
  store.deleteBlock(column);
  tidyColumns(store, row);
  return true;
}

/**
 * Grow or shrink a row to `count` columns.
 *
 * Shrinking never deletes what people wrote: the blocks in the columns being
 * dropped move into the last column that survives. Widths are evened out
 * afterwards, because a share that made sense across three columns does not
 * across two.
 */
export function setColumnCount(store: OpsStore, row: ModelLike, count: number): boolean {
  if (store.readonly || row.flavour !== COLUMNS_FLAVOUR) return false;
  const wanted = Math.max(1, Math.min(MAX_COLUMNS, Math.floor(count)));
  const columns = columnsOf(row);
  if (!columns.length || wanted === columns.length) return false;
  store.captureSync?.();

  if (wanted > columns.length) {
    for (let i = columns.length; i < wanted; i++) {
      const id = store.addBlock(COLUMN_FLAVOUR, { width: 1 }, row);
      const added = store.getModelById(id);
      if (added) store.addBlock('affine:paragraph', {}, added);
    }
  } else {
    const keep = columns[wanted - 1];
    for (const column of columns.slice(wanted)) {
      const children = [...(column.children ?? [])];
      if (children.length) store.moveBlocks(children, keep);
      store.deleteBlock(column);
    }
  }
  evenWidths(store, row);
  // wanted === 1 leaves a single column, which is not a row at all.
  if (wanted === 1) tidyColumns(store, row);
  return true;
}

/** Reset every column in the row to an equal share. */
export function evenWidths(store: OpsStore, row: ModelLike): boolean {
  if (store.readonly) return false;
  const columns = columnsOf(row);
  if (!columns.length) return false;
  for (const column of columns) store.updateBlock(column, { width: 1 });
  return true;
}

/**
 * Enter on the empty last line of a column puts the caret back in the page,
 * under the row — otherwise a row that is the last block in the document traps
 * the caret in a half-width column with no way out but the mouse.
 *
 * Returns the id of the paragraph now sitting under the row, or null when the
 * caret is somewhere this does not apply to (mid-column, or with text on the
 * line, where Enter must keep its ordinary meaning).
 */
export function exitColumn(store: OpsStore, block: TextModelLike | null): string | null {
  if (!block || store.readonly) return null;
  if (block.text?.length) return null;
  const column = store.getParent(block);
  if (!column || column.flavour !== COLUMN_FLAVOUR) return null;
  const siblings = column.children ?? [];
  // Only from the last line: Enter in the middle of a column still splits it.
  if (siblings[siblings.length - 1]?.id !== block.id) return null;
  // Never from a column's only line: moving that out empties the column, and an
  // empty column takes the whole row down with it (tidyColumns). Enter there
  // adds a second line, and Enter on THAT one steps out — the way leaving a
  // nested list works.
  if (siblings.length < 2) return null;
  const row = store.getParent(column);
  const note = row && store.getParent(row);
  if (!row || !note) return null;

  store.captureSync?.();
  // insertBeforeSibling false — the paragraph lands directly after the row.
  store.moveBlocks([block], note, row, false);
  // A column emptied by the move would leave an unclickable gap; the sweep in
  // columns-attach.ts also does this, but doing it here keeps the keystroke
  // self-contained for the tests and for a store with no editor attached.
  tidyColumns(store, row);
  return block.id;
}
