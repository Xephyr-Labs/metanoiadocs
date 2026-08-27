/** Renaming a document from the sidebar.
 *
 *  A page's title is a block in its Yjs model, and the editor writes that model
 *  title back to the server whenever it changes (see mountEditor's debounced
 *  sync). A sidebar text field that only patched the database row would be
 *  overwritten the next time the document was opened, so the sidebar doesn't
 *  edit the title itself — it opens the document and puts the caret in the
 *  title, which is the one place an edit sticks.
 *
 *  The request has to outlive a navigation, hence a module-level handoff rather
 *  than a prop: the row that was clicked unmounts before the editor exists. */
let wanted: string | null = null;

/** Ask for `docId`'s title to be focused once its editor is up. */
export function requestTitleFocus(docId: string) {
  wanted = docId;
}

/** True once, and only for the document that asked. */
export function takeTitleFocus(docId: string) {
  if (wanted !== docId) return false;
  wanted = null;
  return true;
}

/** Put the caret in the document title with the text selected, once BlockSuite
 *  has rendered it. The editor element exists before its blocks do — the title
 *  arrives with the first sync — so this waits for it instead of assuming.
 *  Returns a cancel for the wait. */
export function focusDocTitle(editor: Element): () => void {
  let frame = 0;
  let tries = 0;
  const attempt = () => {
    const el = editor.querySelector<HTMLElement>('doc-title [contenteditable]');
    if (el) {
      el.focus();
      // Selected, not just focused: the point of the gesture is to replace the
      // name, and BlockSuite reads a native range as its own selection.
      const range = document.createRange();
      range.selectNodeContents(el);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      return;
    }
    // ~1s at 60fps — long enough for a slow sync, short enough that a document
    // without a title block doesn't leave a frame loop running behind it.
    if (++tries < 60) frame = requestAnimationFrame(attempt);
  };
  frame = requestAnimationFrame(attempt);
  return () => cancelAnimationFrame(frame);
}
