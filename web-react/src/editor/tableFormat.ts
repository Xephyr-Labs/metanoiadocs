// Bold, italic, underline, strikethrough and inline code for table cells.
//
// BlockSuite's table gives a cell no formatting at all. Each cell's text box
// stops every keystroke from reaching the editor (so the text format hotkeys,
// which listen there, never hear Ctrl+B), and the hotkeys only act on a text
// selection, which a table never has: clicking a cell, or picking a row, a
// column or a block of cells, sets the table's own selection instead. So a
// word selected in a cell could not be made bold, and a whole column had to be
// done one cell at a time — and even then could not be.
//
// The rule is a word processor's. Text selected inside one cell is formatted
// as itself. A row, a column or a range of cells is formatted whole, every
// cell's full text. Either way the mark toggles as it does in a paragraph: off
// when everything selected already has it, on otherwise.
import { IS_MAC } from '@blocksuite/affine/global/env';

export type Mark = 'bold' | 'italic' | 'underline' | 'strike' | 'code';

/** The table's selection, as BlockSuite's TableSelection stores it. */
export type TableSelectionData =
  | { type: 'area'; rowStartIndex: number; rowEndIndex: number; columnStartIndex: number; columnEndIndex: number }
  | { type: 'row'; rowId: string }
  | { type: 'column'; columnId: string };

interface KeyLike { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }

/** The mark a keystroke asks for, with BlockSuite's own bindings for text. */
export function markForKey(event: KeyLike, mac = IS_MAC): Mark | null {
  const mod = mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  if (!mod || event.altKey) return null;
  const key = event.key.toLowerCase();
  if (event.shiftKey) return key === 's' ? 'strike' : null;
  return ({ b: 'bold', i: 'italic', u: 'underline', e: 'code' } as Record<string, Mark>)[key] ?? null;
}

interface Ordered { order: string }

/**
 * The `row:column` keys of the cells a selection covers, in the table's own
 * order (the same sort BlockSuite's data manager uses for what it draws).
 */
export function selectedCellKeys(
  rows: Record<string, Ordered & { rowId: string }>,
  columns: Record<string, Ordered & { columnId: string }>,
  data: TableSelectionData,
): string[] {
  const byOrder = (a: Ordered, b: Ordered) => (a.order > b.order ? 1 : -1);
  let rowIds = Object.values(rows).sort(byOrder).map((r) => r.rowId);
  let columnIds = Object.values(columns).sort(byOrder).map((c) => c.columnId);
  if (data.type === 'row') rowIds = rowIds.filter((id) => id === data.rowId);
  else if (data.type === 'column') columnIds = columnIds.filter((id) => id === data.columnId);
  else {
    rowIds = rowIds.slice(data.rowStartIndex, data.rowEndIndex + 1);
    columnIds = columnIds.slice(data.columnStartIndex, data.columnEndIndex + 1);
  }
  return rowIds.flatMap((r) => columnIds.map((c) => `${r}:${c}`));
}

type Delta = { insert?: unknown; attributes?: Record<string, unknown> }[];

/** True when every character in these deltas carries the mark. Embeds (a
 *  mention, a page link) are not text and do not count either way; nothing
 *  at all counts as unmarked, so the first press adds. */
export function allMarked(deltas: Delta[], mark: Mark): boolean {
  let seen = false;
  for (const delta of deltas) {
    for (const op of delta) {
      if (typeof op.insert !== 'string' || !op.insert.length) continue;
      seen = true;
      if (!op.attributes?.[mark]) return false;
    }
  }
  return seen;
}

interface TextLike {
  length: number;
  toDelta(): Delta;
  sliceToDelta(begin: number, end?: number): Delta;
  format(index: number, length: number, format: Record<string, unknown>): void;
}
interface TableModelLike {
  flavour: string;
  props: {
    rows: Record<string, Ordered & { rowId: string }>;
    columns: Record<string, Ordered & { columnId: string }>;
    cells: Record<string, { text?: TextLike } | undefined>;
  };
}
interface InlineEditorLike { getInlineRange(): { index: number; length: number } | null }
export interface TableFormatStd {
  store: {
    readonly: boolean;
    getModelById(id: string): unknown;
    transact(fn: () => void): void;
    captureSync(): void;
  };
  selection: { value: { type: string; blockId?: string; data?: unknown }[] };
  view: { getBlock(id: string): Element | null };
}

/** The table selection, when it is what is selected. */
function tableSelection(std: TableFormatStd) {
  const chosen = std.selection.value.find((s) => s.type === 'table');
  if (!chosen?.blockId || !chosen.data) return null;
  const model = std.store.getModelById(chosen.blockId) as TableModelLike | null;
  if (model?.flavour !== 'affine:table') return null;
  return { blockId: chosen.blockId, model, data: chosen.data as TableSelectionData };
}

/** What a mark would apply to: a span inside one cell, or whole cells. */
function targets(std: TableFormatStd) {
  const sel = tableSelection(std);
  if (!sel) return null;
  const keys = selectedCellKeys(sel.model.props.rows, sel.model.props.columns, sel.data);
  const texts = keys.map((k) => sel.model.props.cells[k]?.text).filter((t): t is TextLike => !!t);
  if (keys.length === 1 && texts.length === 1) {
    // One cell with a caret in it: that cell's own text selection decides. A
    // bare caret has nothing to format, so the key does nothing, as it did.
    const [row, column] = keys[0].split(':');
    const cell = std.view.getBlock(sel.blockId)
      ?.querySelector(`td[data-row-id="${row}"][data-column-id="${column}"] rich-text`) as
      (Element & { inlineEditor?: InlineEditorLike | null }) | null;
    const range = cell?.inlineEditor?.getInlineRange();
    if (range) return range.length ? [{ text: texts[0], index: range.index, length: range.length }] : [];
  }
  return texts.map((text) => ({ text, index: 0, length: text.length }));
}

/** Whether the table selection already carries `mark` throughout; null when
 *  no table selection is what is selected. */
export function tableMarkActive(std: TableFormatStd, mark: Mark): boolean | null {
  const spans = targets(std);
  if (!spans) return null;
  return allMarked(spans.map((s) => s.text.sliceToDelta(s.index, s.index + s.length)), mark);
}

/**
 * Toggle `mark` across the table selection, as one undo step. Returns false
 * when there is no table selection, so the caller can leave the key alone.
 */
export function toggleTableMark(std: TableFormatStd, mark: Mark): boolean {
  if (std.store.readonly) return false;
  const spans = targets(std);
  if (!spans) return false;
  const on = !allMarked(spans.map((s) => s.text.sliceToDelta(s.index, s.index + s.length)), mark);
  // Close the undo step typing was building, so Ctrl+Z takes back the
  // formatting alone and not the last words typed with it.
  std.store.captureSync();
  std.store.transact(() => {
    for (const s of spans) s.text.format(s.index, s.length, { [mark]: on ? true : null });
  });
  return true;
}

/** True for a selection of more than one cell. */
const spansCells = (s: { type: string; data?: unknown } | undefined) => {
  const data = s?.type === 'table' ? (s.data as TableSelectionData) : null;
  if (!data) return false;
  return data.type !== 'area' || data.rowStartIndex !== data.rowEndIndex || data.columnStartIndex !== data.columnEndIndex;
};

/** Undo and redo, by BlockSuite's bindings. */
function historyKey(event: KeyLike, mac = IS_MAC): 'undo' | 'redo' | null {
  const mod = mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  if (!mod || event.altKey) return null;
  const key = event.key.toLowerCase();
  if (key === 'z') return event.shiftKey ? 'redo' : 'undo';
  return key === 'y' && !event.shiftKey ? 'redo' : null;
}

type AttachStd = TableFormatStd & {
  selection: { set(v: unknown[]): void };
  store: { undo(): void; redo(): void };
};

export function attachTableFormat(editor: Element & { std?: AttachStd }): () => void {
  const cellsSelected = () => spansCells(editor.std?.selection.value.find((s) => s.type === 'table'));

  // With several cells selected, the caret must leave the cell it was in. A
  // focused cell puts a caret back into itself whenever its text re-renders
  // (formatting it does exactly that), and a caret in a cell tells the table
  // "this one cell": the selection collapsed after the first Ctrl+B.
  const releaseCaret = () => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && active.isContentEditable && active.closest('affine-table')) active.blur();
    getSelection()?.removeAllRanges();
  };

  // A range of cells dragged out with the mouse fell back to the first cell
  // the moment the button came up, so there was never a range to format. The
  // browser keeps a drag's selection inside the text box it started in and
  // puts a caret back there on release. Hold on to the range the drag made
  // and put it back after.
  let dragging = false;
  const onMouseDown = () => { dragging = false; };
  const onMouseMove = (event: MouseEvent) => { if (event.buttons & 1) dragging = true; };
  const onMouseUp = () => {
    const kept = dragging ? editor.std?.selection.value.find((s) => s.type === 'table') : undefined;
    dragging = false;
    if (!kept || !spansCells(kept)) return;
    setTimeout(() => {
      const std = editor.std;
      const now = std?.selection.value.find((s) => s.type === 'table');
      if (!std || !now || now.blockId !== kept.blockId) return;
      releaseCaret();
      if (!spansCells(now)) std.selection.set([kept]);
    }, 0);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const std = editor.std;
    if (!std || event.isComposing) return;
    if (event.target instanceof Node && !editor.contains(event.target) && event.target !== document.body) return;
    // Out of a cell, Ctrl+Z reaches nothing that undoes: BlockSuite's binding
    // listens inside the page, and the caret has just been taken out of it.
    const history = historyKey(event);
    if (history && cellsSelected() && !std.store.readonly) {
      event.preventDefault();
      event.stopPropagation();
      std.store[history]();
      return;
    }
    const mark = markForKey(event);
    if (!mark || !toggleTableMark(std, mark)) return;
    // Taken even when there was nothing to format: Ctrl+U would otherwise open
    // the page source, and the cell would pass Ctrl+I on to nothing.
    event.preventDefault();
    event.stopPropagation();
    if (cellsSelected()) releaseCaret();
  };
  // Capture, because the cell's text box stops the key before it bubbles.
  document.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('mousedown', onMouseDown, true);
  document.addEventListener('mousemove', onMouseMove, true);
  document.addEventListener('mouseup', onMouseUp, true);
  return () => {
    document.removeEventListener('keydown', onKeyDown, true);
    document.removeEventListener('mousedown', onMouseDown, true);
    document.removeEventListener('mousemove', onMouseMove, true);
    document.removeEventListener('mouseup', onMouseUp, true);
  };
}
