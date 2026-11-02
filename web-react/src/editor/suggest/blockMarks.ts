/** Root class for share links and version previews: pending insertions and
 *  added blocks are hidden by CSS, deletions show as plain text. The data
 *  itself is not filtered — it is a render-time rule only. */
export const CLEAN_VIEW_CLASS = 'mn-sugg-clean';

const ATTR = 'data-mn-sugg';
const KINDS = new Set(['add', 'remove', 'type']);

interface BlockEl extends Element {
  model?: {
    yBlock?: { get(key: string): unknown };
    props?: { mnSugg?: { kind?: string } | null };
  };
}

const kindOf = (el: BlockEl): string | undefined => {
  // The Y.Map first: BlockSuite's props proxy only forwards declared keys
  // (see textSize.ts), so the proxy is a fallback, not the source of truth.
  const v = (el.model?.yBlock?.get('prop:mnSugg') ?? el.model?.props?.mnSugg) as { kind?: string } | null | undefined;
  return v?.kind;
};

/**
 * Mirror each block's `prop:mnSugg` kind onto its element as `data-mn-sugg`,
 * and keep doing so: blocks come and go as the page renders, and a remote
 * accept/reject changes the prop without touching the DOM. `onChange` is the
 * document-update hook, as in textSize.ts.
 */
export function paintSuggestionBlocks(host: Element, onChange?: (cb: () => void) => () => void): () => void {
  let queued = false;
  const paint = () => {
    queued = false;
    for (const el of host.querySelectorAll<BlockEl>('[data-block-id]')) {
      const kind = kindOf(el);
      const want = kind && KINDS.has(kind) ? kind : null;
      if (el.getAttribute(ATTR) !== want) {
        if (want) el.setAttribute(ATTR, want);
        else el.removeAttribute(ATTR);
      }
    }
  };
  const schedule = () => {
    if (!queued) { queued = true; requestAnimationFrame(paint); }
  };
  const mo = new MutationObserver(schedule);
  mo.observe(host, { childList: true, subtree: true });
  const off = onChange?.(schedule);
  schedule();
  return () => {
    mo.disconnect();
    try { off?.(); } catch { /* noop */ }
  };
}
