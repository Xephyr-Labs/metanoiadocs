// Clicking the gap above or below an image (or any other block with no text
// in it) puts a line there to type on.
//
// BlockSuite answers such a click with nothing of its own. The pointer lands
// on the note, the note has no text under the pointer, and the caret goes to
// the start of the page's first paragraph — so whatever was typed next landed
// at the top of the document, far from the image it was meant to sit beside.
// Its one affordance, a 10px strip 15px under an image, only ever works below,
// and does nothing at all when the next block is already a paragraph. With an
// image at the top of a page, or two images in a row, there was no way to get
// a line between them short of dragging blocks around.
//
// The rule is Notion's: a click in the gap above or below a block that cannot
// hold a caret opens an empty line on that side, or reuses one already there.
import { TextSelection } from '@blocksuite/std';

/** Room given to the first block above / the last block below, where there is
 *  no neighbour to measure the gap against. */
const EDGE = 24;

export interface GapBlock {
  id: string;
  top: number;
  bottom: number;
  left: number;
  right: number;
  /** True for a block a caret cannot be placed in: an image, a file, an
   *  embed, a database, a divider, a row of columns. */
  card: boolean;
}

/**
 * Which side of which card a point is in the gap of, given one container's
 * children in document order. Null when the point is not in such a gap.
 */
export function gapAt(blocks: GapBlock[], x: number, y: number): { id: string; side: 'above' | 'below' } | null {
  for (let i = 0; i < blocks.length; i += 1) {
    const block = blocks[i];
    if (!block.card || x < block.left || x > block.right) continue;
    const previous = blocks[i - 1];
    const next = blocks[i + 1];
    const aboveFrom = previous ? previous.bottom : block.top - EDGE;
    if (y >= aboveFrom && y < block.top) return { id: block.id, side: 'above' };
    const belowTo = next ? next.top : block.bottom + EDGE;
    if (y > block.bottom && y <= belowTo) return { id: block.id, side: 'below' };
  }
  return null;
}

interface ModelLike {
  id: string;
  flavour: string;
  text?: { length: number } | null;
  children: ModelLike[];
}
interface StoreLike {
  readonly: boolean;
  getModelById(id: string): ModelLike | null;
  getParent(model: ModelLike): ModelLike | null;
  addBlock(flavour: string, props: Record<string, unknown>, parent: ModelLike, index?: number): string;
  captureSync?(): void;
}
interface StdLike {
  store: StoreLike;
  view: { getBlock(id: string): Element | null };
  selection: {
    value: { type: string; blockId?: string }[];
    create(type: typeof TextSelection, args: unknown): unknown;
    setGroup(group: string, selections: unknown[]): void;
  };
}

/** Containers whose children sit one under another on the page. */
const CONTAINERS = new Set(['affine:note', 'metanoia:column']);
const TEXT = new Set(['affine:paragraph', 'affine:list', 'affine:code']);

const isCard = (model: ModelLike) => !TEXT.has(model.flavour) && model.text == null;
const isEmptyParagraph = (model: ModelLike | undefined) =>
  model?.flavour === 'affine:paragraph' && (model.text?.length ?? 0) === 0 && !model.children.length;

/** A button, a field, a widget (the drag handle, a toolbar) or any other
 *  non-editable UI drawn over the page. The gap itself is the note or a
 *  column, both editable. */
const isControl = (node: EventTarget): boolean => node instanceof Element && (
  node.tagName.endsWith('-WIDGET')
  || node.matches('button, a, input, select, textarea, [role="button"], [role="menu"], [role="menuitem"], [contenteditable="false"]')
);

function containersIn(model: ModelLike, out: ModelLike[] = []): ModelLike[] {
  if (CONTAINERS.has(model.flavour)) out.push(model);
  for (const child of model.children) {
    if (CONTAINERS.has(child.flavour) || child.flavour === 'metanoia:columns') containersIn(child, out);
  }
  return out;
}

/** Put the caret on an empty line beside `card` — the one already there, or a
 *  new one. */
function openLine(std: StdLike, container: ModelLike, card: ModelLike, side: 'above' | 'below') {
  const at = container.children.indexOf(card);
  const neighbour = container.children[side === 'above' ? at - 1 : at + 1];
  let target = isEmptyParagraph(neighbour) ? neighbour!.id : null;
  if (!target) {
    std.store.captureSync?.();
    target = std.store.addBlock('affine:paragraph', {}, container, side === 'above' ? at : at + 1);
  }
  std.selection.setGroup('note', [
    std.selection.create(TextSelection, { from: { blockId: target, index: 0, length: 0 }, to: null }),
  ]);
}

export function attachBlockGaps(editor: Element & { std?: StdLike }): () => void {
  let pressed: { x: number; y: number } | null = null;
  const onPointerDown = (event: PointerEvent) => { pressed = { x: event.clientX, y: event.clientY }; };

  const onClick = (event: MouseEvent) => {
    const std = editor.std;
    const start = pressed;
    pressed = null;
    if (!std || std.store.readonly || event.button !== 0 || event.detail > 1) return;
    if (event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return;
    if (!(event.target instanceof Node) || !editor.contains(event.target)) return;
    // Page mode only: on the canvas the space between blocks is the canvas.
    if (!editor.querySelector('affine-page-root')) return;
    // The end of a drag (a box selection, a text selection) is not a click.
    if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 4) return;
    // A control is not a gap, even where it overhangs one: a column's ⋯ button
    // sits 6px above its row and its menu can hang below it, and a click on
    // either opened a line there instead of the menu.
    if (event.composedPath().some(isControl)) return;
    const root = (std.store as unknown as { root: ModelLike | null }).root;
    if (!root) return;

    for (const container of containersIn(root)) {
      const blocks: GapBlock[] = [];
      for (const child of container.children) {
        const el = std.view.getBlock(child.id);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        blocks.push({ id: child.id, top: r.top, bottom: r.bottom, left: r.left, right: r.right, card: isCard(child) });
      }
      const gap = gapAt(blocks, event.clientX, event.clientY);
      if (!gap) continue;

      const card = std.store.getModelById(gap.id);
      if (!card) return;
      // Ours, not BlockSuite's: its handler would put the caret on page one.
      event.preventDefault();
      event.stopPropagation();
      openLine(std, container, card, gap.side);
      return;
    }
  };

  // Enter on a selected image (or any card) opens a line under it. BlockSuite
  // has no binding for that: the keystroke fell through to a stale caret and
  // added a blank line at the top of the page instead.
  const onKeyDown = (event: KeyboardEvent) => {
    const std = editor.std;
    if (!std || std.store.readonly || event.key !== 'Enter' || event.isComposing) return;
    if (event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.target instanceof Node && !editor.contains(event.target) && event.target !== document.body) return;
    // Typing into a field inside a card (an inline table's cell, a caption)
    // can leave the card itself block-selected; that Enter belongs to the field.
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement
      || event.target instanceof HTMLSelectElement) return;
    const chosen = std.selection.value;
    // Only a card picked as a whole opens a line. A table cell being typed in
    // is also a selection on the table block (BlockSuite's 'table' selection,
    // set the moment a cell gets the caret), and treating it as a picked card
    // turned Enter in any cell into a new paragraph under the table.
    if (chosen.length !== 1 || !chosen[0].blockId || chosen[0].type === 'text' || chosen[0].type === 'table') return;
    const card = std.store.getModelById(chosen[0].blockId);
    const container = card && std.store.getParent(card);
    if (!card || !container || !isCard(card) || !CONTAINERS.has(container.flavour)) return;
    event.preventDefault();
    event.stopPropagation();
    openLine(std, container, card, 'below');
  };

  // Capture on document so this runs before BlockSuite's own click handling
  // and before the image's strip, which would add a second line.
  document.addEventListener('pointerdown', onPointerDown, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('keydown', onKeyDown, true);
  return () => {
    document.removeEventListener('keydown', onKeyDown, true);
    document.removeEventListener('pointerdown', onPointerDown, true);
    document.removeEventListener('click', onClick, true);
  };
}
