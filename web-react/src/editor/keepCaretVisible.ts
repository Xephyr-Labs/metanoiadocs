// On a phone the line being typed must stay above the keyboard *and* the
// formatting bar docked on it.
//
// The browser scrolls the caret clear of the keyboard, but it knows nothing of
// BlockSuite's toolbar pinned just above, so the current line ended up half
// behind it. After each selection change or keyboard resize, if the caret sits
// in the band the toolbar covers, the editor's scroller moves it up.

/** The height kept clear above the keyboard: the toolbar plus a little air. */
const CLEAR = 72;

function scrollParent(el: Element | null): HTMLElement | null {
  for (let n = el?.parentElement; n; n = n.parentElement) {
    const y = getComputedStyle(n).overflowY;
    if ((y === 'auto' || y === 'scroll') && n.scrollHeight > n.clientHeight) return n;
  }
  return null;
}

/** How far the caret has to move up, or 0 when it is already in the clear. */
export function overlap(caretBottom: number, viewportBottom: number, clear = CLEAR) {
  return Math.max(0, Math.ceil(caretBottom - (viewportBottom - clear)));
}

export function keepCaretVisible(root: HTMLElement): () => void {
  let frame = 0;
  const check = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const sel = document.getSelection();
      if (!sel?.rangeCount || !root.contains(sel.anchorNode)) return;
      const range = sel.getRangeAt(0);
      const rects = range.getClientRects();
      const rect = rects[rects.length - 1] ?? range.getBoundingClientRect();
      if (!rect || (!rect.height && !rect.bottom)) return;
      const vv = window.visualViewport;
      const bottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
      const by = overlap(rect.bottom, bottom);
      if (by) scrollParent(root)?.scrollBy({ top: by });
    });
  };
  document.addEventListener('selectionchange', check);
  window.visualViewport?.addEventListener('resize', check);
  return () => {
    cancelAnimationFrame(frame);
    document.removeEventListener('selectionchange', check);
    window.visualViewport?.removeEventListener('resize', check);
  };
}
