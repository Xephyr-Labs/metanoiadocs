// Copy, cut and paste that belong to something other than the page.
//
// BlockSuite (0.22.4) listens for copy/cut/paste on `document`, not on the
// editor, and its handlers call preventDefault and then write the EDITOR's
// selection to the clipboard. So while a page is open, selecting text in the
// sidebar, a comment, the task panel or an AI answer and pressing Ctrl+C
// cancelled the browser's copy and put the last thing selected in the page on
// the clipboard instead (or nothing at all) — what pasted into Google Docs was
// never what was selected. A copy in a text box went the same way, and a paste
// into one could land in the page.
//
// When the selection or the focused field is outside the editor, stop the
// event at `document` on its way down, so BlockSuite's bubble-phase listener
// never sees it and the browser does its normal thing. stopPropagation, not
// stopImmediatePropagation: lib/clipboard.ts listens on `document` in the
// capture phase too and still has to run.

type NodeLike = object;
interface ContainerLike { contains(node: NodeLike | null): boolean }
interface SelectionLike { isCollapsed: boolean; rangeCount: number; getRangeAt(i: number): { commonAncestorContainer: NodeLike } }

const EDITABLE = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]';

/** True when a clipboard event belongs outside `host` (the editor's surface). */
export function belongsOutside(
  type: string,
  host: ContainerLike | null,
  active: (NodeLike & { closest?(sel: string): unknown }) | null,
  selection: SelectionLike | null,
): boolean {
  if (!host) return false;
  // The page title renders outside editor-host but is the page's own text, and
  // its rich-text handles copy, cut and paste itself. Stopping the event here
  // silently dropped every paste into the title.
  if (active?.closest?.('doc-title')) return false;
  // A focused field outside the editor owns every clipboard key.
  if (active && !host.contains(active) && active.closest?.(EDITABLE)) return true;
  if (type === 'paste') return false;
  // Copy/cut of text selected outside the editor. A collapsed selection is
  // either nothing or a block selection, which only BlockSuite can copy.
  if (!selection || selection.isCollapsed || !selection.rangeCount) return false;
  return !host.contains(selection.getRangeAt(0).commonAncestorContainer);
}

export function attachForeignClipboard(editor: HTMLElement): () => void {
  const onEvent = (event: Event) => {
    const host = editor.querySelector('editor-host');
    if (belongsOutside(event.type, host, document.activeElement, document.getSelection())) event.stopPropagation();
  };
  for (const type of ['copy', 'cut', 'paste']) document.addEventListener(type, onEvent, true);
  return () => { for (const type of ['copy', 'cut', 'paste']) document.removeEventListener(type, onEvent, true); };
}
