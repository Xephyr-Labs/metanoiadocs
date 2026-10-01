// Dropping an image (or any file) anywhere on the page puts it where it was
// dropped.
//
// BlockSuite places a dropped file by looking for a block directly under the
// pointer. Off the text column — in the margin beside a paragraph, or in the
// empty space under the last line, where people naturally aim at a short page
// — there is none, so the file went to the very end of the document, or (below
// the editor's own element) was not taken at all. Either way the image turned
// up somewhere other than where it was dropped.
//
// The fix leaves BlockSuite's drop handling as it is and changes only the
// point it is shown: a file drag over the page that is not over a block is
// re-sent from the nearest point on the text column. The real DataTransfer
// travels with it, so the files and the allowed effect are the browser's own,
// and the drop line is drawn where the image will land.

/** Where a point should be treated as being, given the text column's box and
 *  the first and last block's edges. Clamped in, by one pixel, so the point is
 *  always over a block rather than on its border. */
export function clampToColumn(
  x: number, y: number,
  column: { left: number; right: number },
  blocks: { top: number; bottom: number },
): { x: number; y: number } {
  return {
    x: Math.min(Math.max(x, column.left + 2), column.right - 2),
    y: Math.min(Math.max(y, blocks.top + 1), blocks.bottom - 1),
  };
}

interface StdLike {
  store: { root: { children: { flavour: string; id: string; children: { id: string }[] }[] } | null };
  view: { getBlock(id: string): Element | null };
}

/** The element the page scrolls in — the area a person sees as "the page". */
function scrollPane(element: Element): Element {
  for (let el = element.parentElement; el; el = el.parentElement) {
    const overflow = getComputedStyle(el).overflowY;
    if (overflow === 'auto' || overflow === 'scroll') return el;
  }
  return document.body;
}

const carriesFiles = (event: DragEvent) => !!event.dataTransfer?.types.includes('Files');

export function attachFileDrop(editor: Element & { std?: StdLike }): () => void {
  // Found once, on the first file drag: dragover fires every few dozen ms, and
  // walking the ancestors through getComputedStyle each time is wasted layout.
  let pane: Element | null = null;
  const forward = (event: DragEvent) => {
    // Our own re-sent copy is untrusted; let it through to BlockSuite.
    if (!event.isTrusted || !carriesFiles(event)) return;
    const std = editor.std;
    if (!std || !(event.target instanceof Node)) return;
    // A drop zone of its own (a page or task's File property, which sits
    // above the first block or beside the editor) takes its files itself.
    const targetEl = event.target instanceof Element ? event.target : event.target.parentElement;
    if (targetEl?.closest('[data-file-drop]')) return;
    // Page mode only: on the canvas a drop goes where it lands.
    if (!editor.querySelector('affine-page-root')) return;
    pane ??= scrollPane(editor);
    if (!pane.contains(event.target)) return;

    const note = std.store.root?.children.find((c) => c.flavour === 'affine:note');
    const noteElement = note && std.view.getBlock(note.id);
    const first = note?.children[0] && std.view.getBlock(note.children[0].id);
    const last = note && std.view.getBlock(note.children[note.children.length - 1]?.id ?? '');
    if (!noteElement || !first || !last) return;

    const column = noteElement.getBoundingClientRect();
    const point = clampToColumn(event.clientX, event.clientY, column, {
      top: first.getBoundingClientRect().top,
      bottom: last.getBoundingClientRect().bottom,
    });
    // Already over the text: BlockSuite finds the block itself.
    if (point.x === event.clientX && point.y === event.clientY) return;

    const at = document.elementFromPoint(point.x, point.y);
    if (!at || !editor.contains(at)) return;
    event.preventDefault();
    event.stopPropagation();
    at.dispatchEvent(new DragEvent(event.type, {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: point.x,
      clientY: point.y,
      dataTransfer: event.dataTransfer,
    }));
  };

  // Capture on document: the margin and the space below the editor are
  // outside it, and BlockSuite's own listeners sit on the editor itself.
  document.addEventListener('dragover', forward, true);
  document.addEventListener('drop', forward, true);
  return () => {
    document.removeEventListener('dragover', forward, true);
    document.removeEventListener('drop', forward, true);
  };
}
