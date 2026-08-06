// Inline comments: select text in the editor -> "Comment" in the format
// toolbar (or a floating button when the toolbar isn't up) -> comments tab
// opens with the quote pinned. Commented text is marked with the CSS Custom
// Highlight API (native; no BlockSuite inline-spec surgery), so we never
// mutate the doc — highlights are recomputed from the comment quotes.
// Clicking a marked range opens its comment in the panel (Google-Docs style).
import { useEffect, useState } from 'react';
import { docsApi } from '../lib/docsApi';

export interface CommentAnchor {
  quote: string;
  blockId: string | null;
}

const HL_NAME = 'mn-comment';
const supported = typeof CSS !== 'undefined' && 'highlights' in CSS;

// ---- pending-anchor store (editor -> RightPanel bridge, presence.ts pattern)
type AnchorListener = (a: CommentAnchor | null) => void;
const anchorListeners = new Set<AnchorListener>();
const openListeners = new Set<() => void>();
let pending: CommentAnchor | null = null;

function setPending(a: CommentAnchor | null) {
  pending = a;
  anchorListeners.forEach((l) => l(a));
}

export function clearPendingAnchor() { setPending(null); }

/** Fires when the editor asks for the comments tab to open. */
export function onCommentRequest(l: () => void): () => void {
  openListeners.add(l);
  return () => { openListeners.delete(l); };
}

export function usePendingAnchor(): CommentAnchor | null {
  const [a, setA] = useState(pending);
  useEffect(() => {
    anchorListeners.add(setA);
    setA(pending);
    return () => { anchorListeners.delete(setA); };
  }, []);
  return a;
}

// ---- focused-comment store (click on a marked range -> scroll to its card)
const focusListeners = new Set<(id: string | null) => void>();
let focusId: string | null = null;

function setFocus(id: string | null) {
  focusId = id;
  focusListeners.forEach((l) => l(id));
}

export function clearPendingFocus() { setFocus(null); }

export function usePendingFocus(): string | null {
  const [id, setId] = useState(focusId);
  useEffect(() => {
    focusListeners.add(setId);
    setId(focusId);
    return () => { focusListeners.delete(setId); };
  }, []);
  return id;
}

// ---- highlight painting
let hlRoot: HTMLElement | null = null;
let hlDocId: string | null = null;
// Live ranges (they track DOM edits) paired with their comment ids, so a
// click can be resolved back to the comment it belongs to.
let applied: { range: Range; id: string }[] = [];

/** Find `quote` inside one block element and return a Range over it. */
function rangeForQuote(block: Element, quote: string): Range | null {
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let joined = '';
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    nodes.push(n as Text);
    joined += n.textContent || '';
  }
  const at = joined.indexOf(quote);
  if (at < 0) return null;
  const range = document.createRange();
  let off = 0;
  let startSet = false;
  for (const node of nodes) {
    const len = node.textContent?.length || 0;
    if (!startSet && at < off + len) {
      range.setStart(node, at - off);
      startSet = true;
    }
    if (startSet && at + quote.length <= off + len) {
      range.setEnd(node, at + quote.length - off);
      return range;
    }
    off += len;
  }
  return null;
}

export function applyCommentHighlights(rows: { id: string; quote: string | null; block_id: string | null; resolved: boolean; parent_id: string | null }[]) {
  if (!supported || !hlRoot) return;
  applied = [];
  for (const c of rows) {
    if (!c.quote || c.resolved || c.parent_id) continue;
    const quote = c.quote.replace(/\s+/g, ' ').trim();
    if (!quote) continue;
    // Prefer the anchored block; fall back to scanning every block (text may
    // have moved). ponytail: first occurrence wins, multi-block quotes unmatched.
    const anchored = c.block_id ? hlRoot.querySelector(`[data-block-id="${CSS.escape(c.block_id)}"]`) : null;
    const blocks = [
      ...(anchored ? [anchored] : []),
      ...hlRoot.querySelectorAll('[data-block-id]'),
    ];
    for (const b of blocks) {
      const r = rangeForQuote(b, quote);
      if (r) { applied.push({ range: r, id: c.id }); break; }
    }
  }
  (CSS as unknown as { highlights: Map<string, unknown> }).highlights.set(
    HL_NAME,
    new (window as unknown as { Highlight: new (...r: Range[]) => unknown }).Highlight(...applied.map((a) => a.range)),
  );
}

let refreshTimer: ReturnType<typeof setTimeout> | null = null;
export function refreshCommentHighlights() {
  if (!supported || !hlDocId) return;
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    if (!hlDocId) return;
    docsApi.comments(hlDocId).then(applyCommentHighlights).catch(() => {});
  }, 400);
}

// ---- BlockSuite format-toolbar injection
// The selection toolbar slots plain light-DOM `editor-icon-button`s inside
// `affine-toolbar-widget`'s shadow `editor-toolbar` — so we can add our own.
const COMMENT_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" width="20" height="20" style="user-select:none;flex-shrink:0;">' +
  '<path fill="currentColor" fill-rule="evenodd" d="M12 3.25c-4.87 0-8.75 3.5-8.75 7.75 0 2.4 1.24 4.53 3.18 5.95a6.4 6.4 0 0 1-1.06 2.6.75.75 0 0 0 .6 1.2c1.87 0 3.4-.63 4.5-1.35.5.08 1.02.13 1.53.13 4.87 0 8.75-3.5 8.75-7.53S16.87 3.25 12 3.25Z" clip-rule="evenodd"/></svg>';

function findToolbar(): HTMLElement | null {
  const w = document.querySelector('affine-toolbar-widget');
  const et = w?.shadowRoot?.querySelector('editor-toolbar') as HTMLElement | null;
  if (!et) return null;
  const r = et.getBoundingClientRect();
  return r.width > 0 && r.height > 0 ? et : null;
}

function injectToolbarButton(onPick: () => void): boolean {
  const et = findToolbar();
  if (!et) return false;
  if (et.querySelector('[data-testid="mn-comment"]')) return true;
  const btn = document.createElement('editor-icon-button');
  btn.setAttribute('data-testid', 'mn-comment');
  btn.setAttribute('aria-label', 'Comment');
  btn.setAttribute('tabindex', '0');
  btn.setAttribute('role', 'button');
  btn.innerHTML = COMMENT_ICON;
  btn.addEventListener('click', (e) => { e.stopPropagation(); onPick(); });
  const sep = document.createElement('editor-toolbar-separator');
  // Sit before the trailing "More menu" group.
  const more = [...et.children].filter((c) => c.tagName === 'EDITOR-MENU-BUTTON').pop() ?? null;
  const at = more?.previousElementSibling?.tagName === 'EDITOR-TOOLBAR-SEPARATOR' ? more.previousElementSibling : more;
  et.insertBefore(sep, at);
  et.insertBefore(btn, at);
  return true;
}

// ---- selection wiring
export function attachComments(
  root: HTMLElement,
  docId: string,
  onDocUpdate: (cb: () => void) => () => void,
): () => void {
  hlRoot = root;
  hlDocId = docId;

  // Fallback button for when BlockSuite's toolbar doesn't show (e.g. mobile).
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = '💬 Comment';
  btn.className =
    'fixed z-50 hidden items-center gap-1 rounded-md border border-line bg-canvas px-2.5 py-1 text-[12px] font-medium text-ink shadow-pop hover:bg-hover';
  document.body.appendChild(btn);

  let anchor: CommentAnchor | null = null;
  const timers: ReturnType<typeof setTimeout>[] = [];

  const hide = () => { btn.style.display = 'none'; };

  const pick = () => {
    if (!anchor) return;
    setPending(anchor);
    // Collapse the selection: if it stays live, the editor treats the next
    // keystroke as "replace selection" and eats the selected text.
    document.getSelection()?.removeAllRanges();
    openListeners.forEach((l) => l());
    hide();
  };

  const onSelect = () => {
    const sel = document.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return hide();
    const range = sel.getRangeAt(0);
    const container = range.commonAncestorContainer;
    const el = container instanceof Element ? container : container.parentElement;
    if (!el || !root.contains(el)) return hide();
    const startEl = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement;
    const blockId = startEl?.closest('[data-block-id]')?.getAttribute('data-block-id') ?? null;
    if (!blockId) return hide(); // title / whitespace selections
    const quote = sel.toString().replace(/\s+/g, ' ').trim().slice(0, 500);
    if (!quote) return hide();
    anchor = { quote, blockId };
    const r = range.getBoundingClientRect();
    btn.style.display = 'flex';
    btn.style.top = `${Math.max(8, r.top - 36)}px`;
    btn.style.left = `${Math.min(window.innerWidth - 120, Math.max(8, r.left + r.width / 2 - 48))}px`;
    // BlockSuite's toolbar pops slightly later; put Comment inside it and
    // drop the fallback button once it's there. Re-runs per selection since
    // the toolbar re-renders. ponytail: two timed attempts, no observer.
    for (const d of [150, 500]) {
      timers.push(setTimeout(() => { if (injectToolbarButton(pick)) hide(); }, d));
    }
  };

  // mousedown (not click): fires before the selection collapses.
  btn.addEventListener('mousedown', (e) => { e.preventDefault(); pick(); });

  // Click on a marked range -> open its comment.
  const onClick = (e: MouseEvent) => {
    if (!applied.length) return;
    const d = document as Document & {
      caretRangeFromPoint?: (x: number, y: number) => Range | null;
      caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    };
    let node: Node | undefined;
    let offset = 0;
    const cr = d.caretRangeFromPoint?.(e.clientX, e.clientY);
    if (cr) { node = cr.startContainer; offset = cr.startOffset; }
    else {
      const cp = d.caretPositionFromPoint?.(e.clientX, e.clientY);
      if (cp) { node = cp.offsetNode; offset = cp.offset; }
    }
    if (!node) return;
    for (const a of applied) {
      try {
        if (a.range.isPointInRange(node, offset)) {
          setFocus(a.id);
          openListeners.forEach((l) => l());
          return;
        }
      } catch { /* range detached by a re-render; next refresh rebuilds it */ }
    }
  };
  root.addEventListener('click', onClick);

  const onUp = () => setTimeout(onSelect, 10);
  document.addEventListener('mouseup', onUp);
  document.addEventListener('keyup', onUp);
  const onScroll = () => hide();
  document.addEventListener('scroll', onScroll, true);

  refreshCommentHighlights();
  const offUpdate = onDocUpdate(() => refreshCommentHighlights());

  return () => {
    document.removeEventListener('mouseup', onUp);
    document.removeEventListener('keyup', onUp);
    document.removeEventListener('scroll', onScroll, true);
    root.removeEventListener('click', onClick);
    timers.forEach(clearTimeout);
    offUpdate();
    btn.remove();
    if (supported) (CSS as unknown as { highlights: Map<string, unknown> }).highlights.delete(HL_NAME);
    if (hlRoot === root) { hlRoot = null; hlDocId = null; applied = []; }
    setPending(null);
    setFocus(null);
  };
}
