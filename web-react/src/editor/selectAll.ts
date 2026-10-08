// Ctrl/Cmd+A selects the whole document, tables included.
//
// BlockSuite climbs to it in three presses — the line's text, then the line as
// a block, then every block — and from inside a table cell it never climbs at
// all: the table keeps the key and selects that one cell however often it is
// pressed. Here the first press still selects the line's (or the cell's) text
// when it is not all selected yet, which is what someone editing a line wants,
// and the next press selects every block on the page. Tables come with it, so
// a copy or a delete after Ctrl+A takes the whole page.
import { IS_MAC } from '@blocksuite/affine/global/env';
import { BlockSelection, TextSelection } from '@blocksuite/affine/std';
import { shortcutLetter } from './tableFormat';

interface ModelLike { id: string; flavour: string; text?: { length: number } | null; children: ModelLike[]; props?: { displayMode?: string } }
interface SelectionLike { blockId: string; from?: { blockId: string; index: number; length: number }; to?: unknown }
interface StdLike {
  store: { root: ModelLike | null; getBlock(id: string): { model: ModelLike } | null | undefined };
  selection: {
    find(type: unknown): SelectionLike | undefined;
    create(type: unknown, init: { blockId: string }): unknown;
    setGroup(group: string, selections: unknown[]): void;
  };
}

/** Whether a text range already covers everything in the text it sits in. */
export function coversAll(selected: number, total: number): boolean {
  return total === 0 || selected >= total;
}

/** The page's blocks, in order, from every note shown on the page. */
export function pageBlockIds(root: ModelLike | null): string[] {
  if (!root) return [];
  return root.children
    .filter((n) => n.flavour === 'affine:note' && n.props?.displayMode !== 'edgeless')
    .flatMap((n) => n.children.map((c) => c.id));
}

/** Still on the line or cell: true when the first press should be BlockSuite's (select this text). */
function lineNotYetSelected(std: StdLike, cell: Element | null): boolean {
  if (cell) {
    // The cell's markup carries layout whitespace around its text; compare
    // what is readable on both sides.
    const bare = (t: string | null | undefined) => (t ?? '').replace(/[\s\u200b]+/g, '');
    return !coversAll(bare(getSelection()?.toString()).length, bare(cell.textContent).length);
  }
  const text = std.selection.find(TextSelection);
  if (!text?.from || text.to) return false;
  const total = std.store.getBlock(text.from.blockId)?.model.text?.length ?? 0;
  return !coversAll(text.from.index === 0 ? text.from.length : 0, total);
}

export function attachSelectAll(editor: Element & { std?: StdLike }): () => void {
  const onKeyDown = (event: KeyboardEvent) => {
    const mod = IS_MAC ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
    if (!mod || event.altKey || event.shiftKey || event.isComposing || shortcutLetter(event) !== 'a') return;
    const std = editor.std;
    const target = event.target instanceof Element ? event.target : null;
    if (!std || !target || !editor.contains(target)) return;
    // The title, a form field, a popup's search box: their own text is all there is.
    if (target.closest('doc-title, input, textarea, select, link-popup')) return;
    const path = event.composedPath();
    const cell = path.find((n): n is Element => n instanceof Element && n.tagName === 'AFFINE-TABLE-CELL') ?? null;
    // First press: the line's or the cell's own text, by BlockSuite's binding.
    if (lineNotYetSelected(std, cell)) return;
    const ids = pageBlockIds(std.store.root);
    if (!ids.length) return;
    event.preventDefault();
    event.stopPropagation();
    // Out of the cell first: a caret left in it keeps the table's own selection alive.
    if (cell && document.activeElement instanceof HTMLElement) document.activeElement.blur();
    getSelection()?.removeAllRanges();
    std.selection.setGroup('note', ids.map((blockId) => std.selection.create(BlockSelection, { blockId })));
  };
  // Capture: the table cell and BlockSuite's own bindings take the key first otherwise.
  document.addEventListener('keydown', onKeyDown, true);
  return () => document.removeEventListener('keydown', onKeyDown, true);
}
