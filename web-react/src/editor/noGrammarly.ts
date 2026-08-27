/** Keep Grammarly (and its lookalikes) off the document text.
 *
 *  BlockSuite renders from the Yjs model: every `[contenteditable]` in here is a
 *  view of a `Y.Text`, and the only writes the editor accepts are the ones it
 *  sees through its own input path. Grammarly applies a suggestion by rewriting
 *  the text node directly, which means two things happen at once — the model
 *  never learns about the edit, so it is gone on the next load, and the DOM no
 *  longer has the length the range mapper expects, so the caret can no longer be
 *  placed on that line. There is no way to accept the edit after the fact; the
 *  only fix is to not let the extension attach.
 *
 *  The attributes have to go on the editable elements themselves, and BlockSuite
 *  makes a fresh one per block as you type, so marking the host once is not
 *  enough — hence the observer. */
const OFF = {
  'data-gramm': 'false',
  'data-gramm_editor': 'false',
  'data-enable-grammarly': 'false',
};

function mark(el: Element) {
  for (const [name, value] of Object.entries(OFF)) {
    if (el.getAttribute(name) !== value) el.setAttribute(name, value);
  }
}

/** Mark `host` and every editable inside it, now and as blocks appear.
 *  Returns the teardown. */
export function keepGrammarlyOut(host: HTMLElement): () => void {
  const markAll = (root: Element) => {
    if (root.hasAttribute('contenteditable')) mark(root);
    root.querySelectorAll('[contenteditable]').forEach(mark);
  };

  mark(host);
  markAll(host);

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      // Elements that arrive already editable.
      for (const node of record.addedNodes) {
        if (node instanceof Element) markAll(node);
      }
      // ...and elements that become editable later. affine-page-root is
      // inserted plain and gains contenteditable afterwards, so watching new
      // nodes alone left the element wrapping the whole document unguarded.
      if (record.type === 'attributes' && record.target instanceof Element) {
        if (record.target.hasAttribute('contenteditable')) mark(record.target);
      }
    }
  });
  observer.observe(host, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['contenteditable'],
  });
  return () => observer.disconnect();
}
