// Inline comments: select text in the editor -> "Comment" in the format
// toolbar (or a floating button when the toolbar isn't up) -> comments tab
// opens with the quote pinned. Commented text is marked with the CSS Custom
// Highlight API (native; no BlockSuite inline-spec surgery), so we never
// mutate the doc — highlights are recomputed from the comment quotes.
// Clicking a marked range opens its comment in the panel (Google-Docs style).
import { useEffect, useState } from 'react';
import { ActionPlacement, ToolbarModuleExtension, type ToolbarContext } from '@blocksuite/affine/shared/services';
import { BlockFlavourIdentifier, TextSelection } from '@blocksuite/affine/std';
import { CommentIcon, EditIcon } from '@blocksuite/icons/lit';
import { docsApi } from '../lib/docsApi';
import { findQuote, normalizeQuote } from '../lib/textMatch';

export interface CommentAnchor {
  quote: string;
  blockId: string | null;
  /** 'suggest' opens the composer as a suggested change to the quoted text. */
  mode?: 'comment' | 'suggest';
  /** Which copy of the quote in its block was selected (0 = first). */
  occurrence?: number;
}

const HL_NAME = 'mn-comment';
const HL_SUGGESTION = 'mn-suggestion';
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

/** Turn the selection waiting in the composer into a comment or a suggestion. */
export function setPendingMode(mode: 'comment' | 'suggest') {
  if (pending) setPending({ ...pending, mode });
}

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

/** The rows a comment highlight is drawn from. */
export type CommentRows = Parameters<typeof applyCommentHighlights>[0];
/** Where they come from: the member API, or — on a public link that allows
 *  comments — the guest one. */
let hlLoad: (() => Promise<CommentRows>) | null = null;

/** Whether this page takes comments at all — false for a read-only link, a
 *  version preview, or before the editor has mounted. */
export const commentsEnabled = () => !!hlDocId;
// Live ranges (they track DOM edits) paired with their comment ids, so a
// click can be resolved back to the comment it belongs to. A thread on an
// image has no text to range over; it carries the image's element instead.
let applied: { range?: Range; el?: Element; id: string }[] = [];

/** Blocks a thread hangs on as a whole rather than on a passage of text. */
const WHOLE_BLOCK = new Set(['AFFINE-IMAGE']);
const MARK_ATTR = 'data-mn-commented';
/** The quote a thread on an image carries (see commentOnBlock's callers). */
const IMAGE_LABEL = /^Image(: |$)/;

/** Characters BlockSuite puts in the DOM that are not part of the text. */
const INVISIBLE = /[​﻿]/;

/**
 * The editor's text from `from` onward, one entry per character pointing back
 * at its DOM position. A space stands between blocks, which is how a selection
 * across two paragraphs reads back — and so how its quote was stored.
 */
function indexText(root: Element, from: Element | null, limit: number) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  if (from) walker.currentNode = from;
  let raw = '';
  const at: { node: Text; offset: number }[] = [];
  let lastBlock: Element | null = null;
  let anchorLen = from ? -1 : Infinity;
  for (let n = walker.nextNode(); n && raw.length < limit; n = walker.nextNode()) {
    const node = n as Text;
    if (from && anchorLen < 0 && !from.contains(node)) anchorLen = raw.length;
    // Only the document's own text. A block's DOM also carries a <style>
    // sheet and an empty-line placeholder ("Type '/' for commands"), and a
    // quote like "paragraph" matched the CSS class names in that sheet — the
    // highlight landed on invisible text and the passage looked unmarked.
    if (!node.parentElement?.closest('[data-v-text]')) continue;
    const block = node.parentElement?.closest('[data-block-id]') ?? null;
    const text = node.textContent || '';
    if (block !== lastBlock && raw.length && at.length) {
      raw += ' ';
      at.push(at[at.length - 1]);
    }
    lastBlock = block;
    for (let i = 0; i < text.length; i++) {
      if (INVISIBLE.test(text[i])) continue;
      raw += text[i];
      at.push({ node, offset: i });
    }
  }
  if (anchorLen < 0) anchorLen = raw.length;
  return { raw, at, anchorLen };
}

function rangeFrom(idx: ReturnType<typeof indexText>, hit: { index: number; length: number }): Range {
  const start = idx.at[hit.index];
  const end = idx.at[hit.index + hit.length - 1];
  const range = document.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset + 1);
  return range;
}

/**
 * Where a thread's quote is on the page now.
 *
 * It must start in the block the thread was anchored to: when that block is
 * still here but no longer says the quote, the text was edited and the thread
 * is detached — highlighting the same words somewhere else on the page (what
 * the old first-match search did) points readers at the wrong passage. Only
 * when the block itself is gone is the rest of the page searched, and then
 * only an unambiguous, single match counts.
 */
function rangeForThread(root: Element, blockId: string | null, quote: string, occurrence = 0): Range | null {
  const anchored = blockId ? root.querySelector(`[data-block-id="${CSS.escape(blockId)}"]`) : null;
  if (anchored) {
    // Enough text past the block for a quote that runs into the next ones.
    const idx = indexText(root, anchored, quote.length * 2 + 400);
    // The copy that was selected; if edits left fewer copies, a sole one.
    let hit = findQuote(idx.raw, quote, occurrence);
    if (!hit && occurrence > 0 && !findQuote(idx.raw, quote, 1)) hit = findQuote(idx.raw, quote);
    return hit && hit.index < idx.anchorLen ? rangeFrom(idx, hit) : null;
  }
  const idx = indexText(root, null, Infinity);
  const hit = findQuote(idx.raw, quote);
  if (!hit || findQuote(idx.raw, quote, 1)) return null;
  return rangeFrom(idx, hit);
}

/** The rows the highlighter reads. */
interface HighlightRow {
  id: string;
  quote: string | null;
  block_id: string | null;
  resolved: boolean;
  parent_id: string | null;
  author_name?: string;
  kind?: string;
  suggestion_status?: string | null;
  quote_occurrence?: number;
}

/** Open threads whose text is no longer on the page. */
let detached = new Set<string>();
export const isDetached = (id: string) => detached.has(id);
let lastRows: HighlightRow[] = [];

export function applyCommentHighlights(rows: HighlightRow[]) {
  lastRows = rows;
  // The open-thread count drives the gutter and the top-bar badge, and it is
  // knowable even where the Highlight API isn't — compute it before bailing.
  setOpenCount(rows.filter((c) => !c.resolved && !c.parent_id).length);
  if (!supported || !hlRoot) return;
  applied = [];
  const nextDetached = new Set<string>();
  const suggestionRanges: Range[] = [];
  authors = new Map(rows.map((c) => [c.id, c.author_name ?? '']));
  hlRoot.querySelectorAll(`[${MARK_ATTR}]`).forEach((el) => el.removeAttribute(MARK_ATTR));
  for (const c of rows) {
    if (c.resolved || c.parent_id) continue;
    // A thread on an image: mark the image itself. Checked before the quote,
    // which for an image is only a label ("Image") and must never be searched
    // for in the page's text.
    const whole = c.block_id ? hlRoot.querySelector(`[data-block-id="${CSS.escape(c.block_id)}"]`) : null;
    if (whole && WHOLE_BLOCK.has(whole.tagName)) {
      whole.setAttribute(MARK_ATTR, '');
      applied.push({ el: whole, id: c.id });
      continue;
    }
    if (!c.quote) continue;
    // An image's thread whose image is not on the page (deleted, or not drawn
    // in this mode): its label is not text to look for, and searching for it
    // would mark the first "Image" anywhere in the prose.
    if (!whole && IMAGE_LABEL.test(c.quote)) { nextDetached.add(c.id); continue; }
    const quote = normalizeQuote(c.quote);
    if (!quote) continue;
    const r = rangeForThread(hlRoot, c.block_id, quote, c.quote_occurrence ?? 0);
    if (!r) { nextDetached.add(c.id); continue; }
    applied.push({ range: r, id: c.id });
    if (c.kind === 'suggestion' && !c.suggestion_status) suggestionRanges.push(r);
  }
  detached = nextDetached;
  const Highlight = (window as unknown as { Highlight: new (...r: Range[]) => unknown }).Highlight;
  const registry = (CSS as unknown as { highlights: Map<string, unknown> }).highlights;
  const suggested = new Set(suggestionRanges);
  registry.set(HL_NAME, new Highlight(...applied.flatMap((a) => (a.range && !suggested.has(a.range) ? [a.range] : []))));
  registry.set(HL_SUGGESTION, new Highlight(...suggestionRanges));
  markerListeners.forEach((l) => l());
}

// ---- gutter markers
// A highlight alone doesn't tell you a passage has a thread until you happen to
// look at it. These are the pips in the margin, positioned off the same ranges
// the highlighter already resolved, so the two can never point at different text.
export interface CommentMarker { id: string; top: number; author: string }

let authors = new Map<string, string>();
const markerListeners = new Set<() => void>();

/** Marker offsets relative to `container`. Empty until highlights resolve. */
export function commentMarkers(container: HTMLElement | null): CommentMarker[] {
  if (!container) return [];
  const base = container.getBoundingClientRect().top;
  const out: CommentMarker[] = [];
  for (const a of applied) {
    const r = (a.range ?? a.el)!.getBoundingClientRect();
    // A collapsed rect means the range's text is no longer laid out (collapsed
    // block, switched mode) — skip rather than pile every marker at the top.
    if (!r.height) continue;
    out.push({ id: a.id, top: Math.round(r.top - base), author: authors.get(a.id) ?? '' });
  }
  return out;
}

/** Fires whenever the highlight pass reruns and marker positions may have moved. */
export function onMarkersChanged(l: () => void): () => void {
  markerListeners.add(l);
  return () => { markerListeners.delete(l); };
}

/**
 * Start a thread on a whole block — an image, from its toolbar. `label` is
 * what the thread quotes, since there is no text to quote: "Image", or the
 * image's caption when it has one.
 */
export function commentOnBlock(blockId: string, label: string) {
  if (!hlDocId) return; // a public viewer or a version preview: no comments here
  setPending({ quote: label.slice(0, 500), blockId });
  openListeners.forEach((l) => l());
}

/** Focus a thread from outside the editor (a gutter pip). */
export function focusComment(id: string) {
  setFocus(id);
  openListeners.forEach((l) => l());
}

// ---- open-thread count (top-bar badge; no extra request — same payload)
const countListeners = new Set<(n: number) => void>();
let openCount = 0;
function setOpenCount(n: number) {
  if (n === openCount) return;
  openCount = n;
  countListeners.forEach((l) => l(n));
}

export function useOpenCommentCount(): number {
  const [n, setN] = useState(openCount);
  useEffect(() => {
    countListeners.add(setN);
    setN(openCount);
    return () => { countListeners.delete(setN); };
  }, []);
  return n;
}

let refreshTimer: ReturnType<typeof setTimeout> | null = null;
/**
 * Re-find the threads' text after an edit. From the rows already loaded: an
 * edit moves text, it doesn't add comments, and fetching the whole list after
 * every pause in typing was a request per keystroke-burst for every reader.
 */
export function refreshCommentHighlights() {
  if (!supported || !hlDocId) return;
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    if (hlDocId) applyCommentHighlights(lastRows);
  }, 400);
}

// ---- live updates
// The server announces a change to a page's comments over that page's sync
// connection; the panel listens here and so does the highlighter.
const changeListeners = new Set<() => void>();
export function onCommentsChanged(l: () => void): () => void {
  changeListeners.add(l);
  return () => { changeListeners.delete(l); };
}
/** Someone (maybe us) changed this page's comments. Reload rows everywhere. */
export function notifyCommentsChanged() {
  if (hlDocId && hlLoad) hlLoad().then(applyCommentHighlights).catch(() => {});
  changeListeners.forEach((l) => l());
}

// ---- the selection toolbar
// "Comment" and "Suggest edit" are actions on BlockSuite's own text toolbar,
// registered the way every other toolbar addition here is. They used to be DOM
// nodes pushed into the toolbar's shadow root on two timers, which lit's next
// re-render could wipe — and did, whenever the toolbar repositioned late.

/** What this viewer may start from a selection. Set by attachComments. */
let caps = { comment: false, suggest: false };
/** Opens the composer for the current selection; set by attachComments. */
let pickSelection: ((mode: 'comment' | 'suggest') => void) | null = null;

/** The selection as a comment anchor, read from the DOM where the text is. */
function selectionAnchor(root: Element): CommentAnchor | null {
  const sel = document.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  const container = range.commonAncestorContainer;
  const el = container instanceof Element ? container : container.parentElement;
  if (!el || !root.contains(el)) return null;
  const startEl = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement;
  const blockId = startEl?.closest('[data-block-id]')?.getAttribute('data-block-id') ?? null;
  if (!blockId) return null; // title / whitespace selections
  const quote = normalizeQuote(sel.toString()).slice(0, 500);
  if (!quote) return null;
  const endEl = range.endContainer instanceof Element ? range.endContainer : range.endContainer.parentElement;
  const endBlock = endEl?.closest('[data-block-id]')?.getAttribute('data-block-id') ?? null;
  const blockEl = startEl?.closest('[data-block-id]') ?? null;
  const occurrence = blockEl ? occurrenceAt(blockEl, range, quote) : 0;
  return { quote, blockId, occurrence, ...(endBlock && endBlock !== blockId ? { multi: true } : {}) } as CommentAnchor & { multi?: boolean };
}

/**
 * How many copies of `quote` come before the selection in its block — so a
 * comment or suggestion on the second "the" in a line stays on the second.
 */
function occurrenceAt(block: Element, range: Range, quote: string): number {
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  let all = '';
  let before = -1;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.parentElement?.closest('[data-v-text]')) continue;
    const text = n.textContent || '';
    if (n === range.startContainer) {
      before = all.length + text.slice(0, range.startOffset).replace(new RegExp(INVISIBLE.source, 'g'), '').length;
    }
    all += text.replace(new RegExp(INVISIBLE.source, 'g'), '');
  }
  if (before < 0) return 0;
  let count = 0;
  for (let k = 0; k < 1000; k++) {
    const hit = findQuote(all, quote, k);
    if (!hit || hit.index >= before) break;
    count++;
  }
  return count;
}

const hasTextSelection = (ctx: ToolbarContext) => {
  const sel = ctx.selection.find(TextSelection);
  return !!sel && !sel.isCollapsed();
};

/** Toolbar actions for the text-selection toolbar (flavour `affine:note`). */
export function commentToolbarExtensions() {
  return [
    ToolbarModuleExtension({
      id: BlockFlavourIdentifier('custom:affine:note'),
      config: {
        actions: [
          {
            placement: ActionPlacement.Normal,
            id: 'z.metanoia-comment',
            tooltip: 'Comment',
            icon: CommentIcon(),
            when: (ctx: ToolbarContext) => caps.comment && hasTextSelection(ctx),
            run: () => pickSelection?.('comment'),
          },
          {
            placement: ActionPlacement.Normal,
            id: 'z.metanoia-suggest',
            tooltip: 'Suggest edit',
            icon: EditIcon(),
            when: (ctx: ToolbarContext) => caps.suggest && hasTextSelection(ctx),
            run: () => pickSelection?.('suggest'),
          },
        ],
      },
    }),
  ];
}

// ---- selection wiring
/** Whether BlockSuite's own selection toolbar is up (and so carries our actions). */
function toolbarShowing(): boolean {
  const w = document.querySelector('affine-toolbar-widget');
  const et = w?.shadowRoot?.querySelector('editor-toolbar') as HTMLElement | null;
  if (!et) return false;
  const r = et.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

export function attachComments(
  root: HTMLElement,
  docId: string,
  onDocUpdate: (cb: () => void) => () => void,
  load: () => Promise<CommentRows> = () => docsApi.comments(docId),
  /** `readonly`: the page can't be edited here (a guest, a commenter, a
   *  suggester), so BlockSuite shows no toolbars and the floating buttons are
   *  how a selection becomes a comment. `canSuggest`: offer "Suggest edit". */
  { readonly = false, canSuggest = false, canComment = true }: { readonly?: boolean; canSuggest?: boolean; canComment?: boolean } = {},
): () => void {
  hlRoot = root;
  hlDocId = docId;
  hlLoad = load;
  caps = { comment: canComment, suggest: canComment && canSuggest };
  // Zero out the previous doc's state immediately — otherwise its badge count
  // and gutter pips linger over the new page until the fetch below lands.
  applied = [];
  lastRows = [];
  detached = new Set();
  setOpenCount(0);
  markerListeners.forEach((l) => l());
  // Load once on open. The highlights, the gutter pips and the top-bar count
  // all come from this, so waiting for someone to open the comments panel
  // would mean a page with threads looks like a page without any.
  load().then(applyCommentHighlights).catch(() => {});

  // Fallback buttons for when BlockSuite's toolbar doesn't show: a read-only
  // page, or a phone.
  const bar = document.createElement('div');
  bar.className = 'fixed z-50 hidden items-center gap-0.5 rounded-md border border-line bg-canvas p-0.5 shadow-pop';
  const mkButton = (label: string, mode: 'comment' | 'suggest') => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.className = 'rounded px-2 py-1 text-[12px] font-medium text-ink hover:bg-hover';
    // pointerdown (not click): fires before the selection collapses, and on touch.
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); pick(mode); });
    return b;
  };
  const commentBtn = mkButton('💬 Comment', 'comment');
  const suggestBtn = mkButton('✎ Suggest', 'suggest');
  bar.append(commentBtn);
  if (canSuggest) bar.append(suggestBtn);
  document.body.appendChild(bar);

  let anchor: (CommentAnchor & { multi?: boolean }) | null = null;
  const timers: ReturnType<typeof setTimeout>[] = [];

  const hide = () => { bar.style.display = 'none'; };

  const pick = (mode: 'comment' | 'suggest') => {
    const a = (selectionAnchor(root) as (CommentAnchor & { multi?: boolean }) | null) ?? anchor;
    if (!a) return;
    // A suggestion replaces one passage of one block; longer or wider
    // selections stay comments rather than becoming a change that can't apply.
    const suggest = mode === 'suggest' && !a.multi && a.quote.length < 500;
    setPending({ quote: a.quote, blockId: a.blockId, occurrence: a.occurrence, mode: suggest ? 'suggest' : 'comment' });
    // Collapse the selection: if it stays live, the editor treats the next
    // keystroke as "replace selection" and eats the selected text.
    document.getSelection()?.removeAllRanges();
    openListeners.forEach((l) => l());
    hide();
  };
  pickSelection = pick;

  // When an image's Comment button was last put up (read-only pages). The
  // click that did it may also have cleared an old text selection, and the
  // debounced selectionchange check would then take the button down again.
  let imageShownAt = 0;

  const onSelect = () => {
    if (!canComment) return;
    const sel = document.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
      if (Date.now() - imageShownAt < 400) return;
      return hide();
    }
    const next = selectionAnchor(root) as (CommentAnchor & { multi?: boolean }) | null;
    if (!next) return hide();
    anchor = next;
    const r = sel.getRangeAt(0).getBoundingClientRect();
    commentBtn.style.display = '';
    suggestBtn.style.display = next.multi ? 'none' : '';
    const width = canSuggest ? 190 : 110;
    bar.style.display = 'flex';
    bar.style.top = `${Math.max(8, r.top - 40)}px`;
    bar.style.left = `${Math.min(window.innerWidth - width - 8, Math.max(8, r.left + r.width / 2 - width / 2))}px`;
    // Where BlockSuite's toolbar comes up it carries Comment and Suggest
    // itself, so the fallback steps aside once it has appeared.
    if (!readonly) {
      for (const d of [120, 400]) timers.push(setTimeout(() => { if (toolbarShowing()) hide(); }, d));
    }
  };

  // Click on a marked range -> open its comment.
  const onClick = (e: MouseEvent) => {
    // On touch a tap is how you place the cursor; opening the full-screen
    // comments sheet instead made commented text impossible to edit. Phones
    // reach threads through the margin dots and the top-bar button.
    if (!applied.length || window.matchMedia('(hover: none)').matches) return;
    // A commented image: a click on it opens its thread, like marked text.
    const onImage = e.target instanceof Node
      ? applied.find((a) => a.el?.contains(e.target as Node))
      : undefined;
    if (onImage) {
      setFocus(onImage.id);
      openListeners.forEach((l) => l());
      return;
    }
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
        if (a.range?.isPointInRange(node, offset)) {
          setFocus(a.id);
          openListeners.forEach((l) => l());
          return;
        }
      } catch { /* range detached by a re-render; next refresh rebuilds it */ }
    }
  };
  root.addEventListener('click', onClick);

  // Read-only: an image's Comment button, since its toolbar never appears.
  const onImageClick = (e: MouseEvent) => {
    const image = e.target instanceof Element ? e.target.closest('affine-image') : null;
    const blockId = image?.getAttribute('data-block-id');
    if (!image || !blockId) return;
    const caption = image.querySelector('block-caption-editor')?.textContent?.trim();
    // After the selection check that every mouseup schedules (10ms): a plain
    // click leaves no text selected, and that check would hide this at once.
    timers.push(setTimeout(() => {
      anchor = { quote: caption ? `Image: ${caption}` : 'Image', blockId };
      imageShownAt = Date.now();
      const r = image.querySelector('img')?.getBoundingClientRect() ?? image.getBoundingClientRect();
      // An image takes a comment, not a text suggestion.
      suggestBtn.style.display = 'none';
      bar.style.display = 'flex';
      bar.style.top = `${Math.max(8, r.top + 8)}px`;
      bar.style.left = `${Math.min(window.innerWidth - 120, r.right - 112)}px`;
    }, 40));
  };
  // Capture: the image block stops its own clicks from bubbling.
  if (readonly && canComment) root.addEventListener('click', onImageClick, true);

  // A long-press selection on a phone fires neither mouseup nor keyup;
  // selectionchange covers it (debounced, it fires per handle drag).
  let selTimer: ReturnType<typeof setTimeout> | undefined;
  const onUp = () => { clearTimeout(selTimer); selTimer = setTimeout(onSelect, 10); };
  const onSelChange = () => { clearTimeout(selTimer); selTimer = setTimeout(onSelect, 250); };
  document.addEventListener('mouseup', onUp);
  document.addEventListener('keyup', onUp);
  document.addEventListener('selectionchange', onSelChange);
  const onScroll = () => hide();
  document.addEventListener('scroll', onScroll, true);

  refreshCommentHighlights();
  const offUpdate = onDocUpdate(() => refreshCommentHighlights());

  return () => {
    document.removeEventListener('mouseup', onUp);
    document.removeEventListener('keyup', onUp);
    document.removeEventListener('selectionchange', onSelChange);
    clearTimeout(selTimer);
    document.removeEventListener('scroll', onScroll, true);
    root.removeEventListener('click', onClick);
    root.removeEventListener('click', onImageClick, true);
    timers.forEach(clearTimeout);
    offUpdate();
    bar.remove();
    if (supported) {
      (CSS as unknown as { highlights: Map<string, unknown> }).highlights.delete(HL_NAME);
      (CSS as unknown as { highlights: Map<string, unknown> }).highlights.delete(HL_SUGGESTION);
    }
    root.querySelectorAll(`[${MARK_ATTR}]`).forEach((el) => el.removeAttribute(MARK_ATTR));
    if (hlRoot === root) {
      hlRoot = null; hlDocId = null; hlLoad = null; applied = []; lastRows = [];
      caps = { comment: false, suggest: false };
      pickSelection = null;
    }
    setPending(null);
    setFocus(null);
  };
}
