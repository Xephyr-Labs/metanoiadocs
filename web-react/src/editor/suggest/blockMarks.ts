/** Root class for share links and version previews: pending insertions and
 *  added blocks are hidden by CSS, deletions show as plain text. The data
 *  itself is not filtered — it is a render-time rule only. */
export const CLEAN_VIEW_CLASS = 'mn-sugg-clean';

const ATTR = 'data-mn-sugg';
const KINDS = new Set(['add', 'remove', 'type']);

interface BlockEl extends Element {
  model?: {
    props?: { mnSugg?: { kind?: string } | null };
    propsUpdated?: { subscribe(cb: () => void): { unsubscribe(): void } };
  };
}

/**
 * Mirror each block's `prop:mnSugg` kind onto its element as `data-mn-sugg`,
 * and keep doing so: blocks come and go as the page renders, and a remote
 * accept/reject changes the prop without touching the DOM (see textSize.ts).
 */
export function paintSuggestionBlocks(host: Element): () => void {
  const subs = new Map<BlockEl, { unsubscribe(): void }>();
  let queued = false;
  const paint = () => {
    queued = false;
    for (const el of host.querySelectorAll<BlockEl>('[data-block-id]')) {
      const kind = el.model?.props?.mnSugg?.kind;
      const want = kind && KINDS.has(kind) ? kind : null;
      if (el.getAttribute(ATTR) !== want) {
        if (want) el.setAttribute(ATTR, want);
        else el.removeAttribute(ATTR);
      }
      if (!subs.has(el) && el.model?.propsUpdated) subs.set(el, el.model.propsUpdated.subscribe(schedule));
    }
  };
  const schedule = () => {
    if (!queued) { queued = true; requestAnimationFrame(paint); }
  };
  const mo = new MutationObserver(schedule);
  mo.observe(host, { childList: true, subtree: true });
  schedule();
  return () => {
    mo.disconnect();
    for (const s of subs.values()) { try { s.unsubscribe(); } catch { /* noop */ } }
    subs.clear();
  };
}
