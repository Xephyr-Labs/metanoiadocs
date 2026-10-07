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
//
// Ctrl/Cmd+K links the same selection: one cell's selected words through the
// editor's own link popup, several cells through that same popup acting on
// every cell's full text. Unlinking follows the paragraph rule too: when all of
// it is already a link, the key takes the link off instead of asking for one.
import { IS_MAC } from '@blocksuite/affine/global/env';
import { docUrl } from '../lib/route';

export type Mark = 'bold' | 'italic' | 'underline' | 'strike' | 'code';

/** The table's selection, as BlockSuite's TableSelection stores it. */
export type TableSelectionData =
  | { type: 'area'; rowStartIndex: number; rowEndIndex: number; columnStartIndex: number; columnEndIndex: number }
  | { type: 'row'; rowId: string }
  | { type: 'column'; columnId: string };

interface KeyLike { key: string; code?: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }

/**
 * The letter a shortcut was pressed on, for any keyboard layout.
 *
 * `key` is the character the layout makes, so on a Russian or Greek layout
 * Ctrl+B arrives as "и" or "β" and no binding would ever match. BlockSuite's
 * keymap falls back to the physical key for exactly this, so the cells do the
 * same with `code` ("KeyB"), which every current browser fills in. Shift turns
 * `key` upper case on every platform, and on a Mac Option would turn it into a
 * symbol; neither matters here, because the letter is lower-cased and Alt
 * never makes a shortcut.
 */
export function shortcutLetter(event: Pick<KeyLike, 'key' | 'code'>): string {
  if (/^[a-z]$/i.test(event.key)) return event.key.toLowerCase();
  const physical = /^Key([A-Z])$/.exec(event.code ?? '');
  return physical ? physical[1].toLowerCase() : event.key.toLowerCase();
}

/**
 * Whether the platform's own shortcut modifier, and only it, is held: Cmd on
 * a Mac, Ctrl everywhere else. Ctrl+B on a Mac is a cursor key in text fields
 * (back one character), and Cmd on Windows is the Start key, so neither is
 * taken for the other.
 */
const modHeld = (event: KeyLike, mac: boolean) =>
  (mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey) && !event.altKey;

/** The mark a keystroke asks for, with BlockSuite's own bindings for text. */
export function markForKey(event: KeyLike, mac = IS_MAC): Mark | null {
  if (!modHeld(event, mac)) return null;
  const key = shortcutLetter(event);
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
export function allMarked(deltas: Delta[], mark: Mark | 'link'): boolean {
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

interface Span {
  text: TextLike;
  index: number;
  length: number;
  /** The cell on screen, for placing the link popup over the selection. */
  td: Element | null;
  /** Set when the span is words selected inside one cell's own text box. */
  inline?: InlineEditorLike;
}

/** What a mark would apply to: a span inside one cell, or whole cells. */
function targets(std: TableFormatStd): Span[] | null {
  const sel = tableSelection(std);
  if (!sel) return null;
  const table = std.view.getBlock(sel.blockId);
  const keys = selectedCellKeys(sel.model.props.rows, sel.model.props.columns, sel.data);
  const cells = keys.flatMap((key) => {
    const text = sel.model.props.cells[key]?.text;
    const [row, column] = key.split(':');
    return text ? [{ text, td: table?.querySelector(`td[data-row-id="${row}"][data-column-id="${column}"]`) ?? null }] : [];
  });
  if (keys.length === 1 && cells.length === 1) {
    // One cell with a caret in it: that cell's own text selection decides. A
    // bare caret has nothing to format, so the key does nothing, as it did.
    const inline = (cells[0].td?.querySelector('rich-text') as
      (Element & { inlineEditor?: InlineEditorLike | null }) | null)?.inlineEditor ?? undefined;
    const range = inline?.getInlineRange();
    if (range) return range.length ? [{ ...cells[0], index: range.index, length: range.length, inline }] : [];
  }
  return cells.map((c) => ({ ...c, index: 0, length: c.text.length }));
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

type Attrs = Record<string, unknown>;

/**
 * Several cells dressed as the one inline editor the link popup expects.
 *
 * BlockSuite's popup is written for a span of one paragraph: it asks that span
 * where it is on screen, and on confirm calls `formatText` with the link. Over
 * a range of cells, "where" is the cells and "format" is every cell's full
 * text, so the same popup — its URL check, its Enter and Escape, and the page
 * search linkSearch.ts adds to it — links a whole row or column at once.
 */
function cellsAsOneText(std: TableFormatStd, spans: Span[]) {
  const apply = (attrs: Attrs) => {
    std.store.captureSync();
    std.store.transact(() => {
      for (const s of spans) s.text.format(s.index, s.length, attrs);
    });
  };
  const rects = () => spans.flatMap((s) => (s.td ? [s.td.getBoundingClientRect()] : []));
  return {
    rootElement: spans.find((s) => s.td)?.td ?? null,
    yTextString: '',
    getFormat: () => ({}),
    isValidInlineRange: () => true,
    setInlineRange: () => {},
    formatText: (_range: unknown, attrs: Attrs) => apply(attrs),
    // Picking a page in the popup's search writes a page reference over the
    // selected words, which in a paragraph replaces them with the page's name.
    // Over whole cells that would wipe the table, so each cell keeps its text
    // and becomes a link to the page instead.
    insertText: (_range: unknown, _text: string, attrs: Attrs = {}) => {
      const page = (attrs.reference as { pageId?: string } | undefined)?.pageId;
      apply(page ? { link: docUrl(page), reference: null } : attrs);
    },
    toDomRange: () => ({
      getClientRects: rects,
      getBoundingClientRect: () => {
        const all = rects();
        if (!all.length) return new DOMRect();
        const left = Math.min(...all.map((r) => r.left));
        const top = Math.min(...all.map((r) => r.top));
        return new DOMRect(left, top,
          Math.max(...all.map((r) => r.right)) - left, Math.max(...all.map((r) => r.bottom)) - top);
      },
    }),
  };
}

/**
 * Ctrl/Cmd+K over the table selection: take the link off when everything
 * selected is already linked, otherwise open the editor's link popup for it.
 * Returns false when there is no table selection or nothing in it to link
 * (a bare caret, or only empty cells), so the caller can leave the key alone.
 */
export function toggleTableLink(std: TableFormatStd): boolean {
  if (std.store.readonly) return false;
  const spans = targets(std)?.filter((s) => s.length > 0);
  if (!spans?.length) return false;
  if (allMarked(spans.map((s) => s.text.sliceToDelta(s.index, s.index + s.length)), 'link')) {
    std.store.captureSync();
    std.store.transact(() => {
      for (const s of spans) s.text.format(s.index, s.length, { link: null });
    });
    return true;
  }
  const one = spans.length === 1 ? spans[0].inline : undefined;
  const target = one ?? cellsAsOneText(std, spans);
  const range = one ? { index: spans[0].index, length: spans[0].length } : { index: 0, length: 1 };
  // Loaded on use rather than at the top: the popup is a lit element, and the
  // pure parts of this file are tested without a DOM.
  void import('@blocksuite/affine/inlines/link').then(({ toggleLinkPopup }) => {
    const abort = new AbortController();
    const popup = toggleLinkPopup(std as never, 'create', target as never, range, abort);
    abort.signal.addEventListener('abort', () => popup.remove());
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
export function historyKey(event: KeyLike, mac = IS_MAC): 'undo' | 'redo' | null {
  if (!modHeld(event, mac)) return null;
  const key = shortcutLetter(event);
  if (key === 'z') return event.shiftKey ? 'redo' : 'undo';
  return key === 'y' && !event.shiftKey ? 'redo' : null;
}

/** Ctrl/Cmd+K, the editor's link binding. */
export const isLinkKey = (event: KeyLike, mac = IS_MAC) =>
  modHeld(event, mac) && !event.shiftKey && shortcutLetter(event) === 'k';

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
    // The link popup's address box keeps its own keys: Ctrl+B there is not a
    // request to bold the cells behind it, nor Ctrl+K for a second popup. (A
    // row's options menu also puts the caret in a search box, and the keys
    // must still work there, so this is the popup alone, not any field.)
    if (event.target instanceof Element && event.target.closest('link-popup')) return;
    // Out of a cell, Ctrl+Z reaches nothing that undoes: BlockSuite's binding
    // listens inside the page, and the caret has just been taken out of it.
    const history = historyKey(event);
    if (history && cellsSelected() && !std.store.readonly) {
      event.preventDefault();
      event.stopPropagation();
      std.store[history]();
      return;
    }
    if (isLinkKey(event)) {
      if (!toggleTableLink(std)) return;
      // Ctrl+K is the browser's own "search the web" key in Chrome, Edge and
      // Firefox on Windows and Linux; Safari leaves Cmd+K alone. None of them
      // reserve it, so preventing the default keeps focus in the page.
      event.preventDefault();
      event.stopPropagation();
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
