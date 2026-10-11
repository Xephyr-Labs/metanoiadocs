// BlockSuite's "Create Linked Doc" is switched off: the toolbar button over a
// selection (and over an embed), and its shortcut Ctrl/Cmd+Shift+L.
//
// It moves the selected blocks into a new doc and leaves a card in their place.
// That new doc is made in the browser's in-memory workspace, which this app
// never saves — our pages are rows the server creates. So the text left the
// page for a doc that existed nowhere, and the card read "Deleted page". On 11
// Oct it emptied a whole page ("Team Video Brief"); a version restore got it
// back. A linked page is still one "@" or "/" away, and those make a real one.

/** Merged over BlockSuite's own action of the same id, in the toolbar module
 *  that reaches every block (blockLinks.ts). */
export const noLinkedDocConvertAction = { id: 'e.convert-to-linked-doc', when: () => false };

const isConvertShortcut = (e: KeyboardEvent) =>
  (e.metaKey || e.ctrlKey) && e.shiftKey && !e.altKey && e.key.toLowerCase() === 'l';

/** Swallow the shortcut before BlockSuite's two bindings of it see it. */
export function attachNoLinkedDocShortcut(editor: HTMLElement): () => void {
  const onKeyDown = (e: KeyboardEvent) => {
    if (!isConvertShortcut(e)) return;
    e.preventDefault();
    e.stopPropagation();
  };
  editor.addEventListener('keydown', onKeyDown, true);
  return () => editor.removeEventListener('keydown', onKeyDown, true);
}
