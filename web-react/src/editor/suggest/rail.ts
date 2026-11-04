// The review side of inline suggestions: the cards a page's pending changes
// make, which one is active, moving between them, and deciding them.
// Geometry (where a card sits) is the rail component's; this is the state.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { docsApi } from '../../lib/docsApi';
import { readRoute } from '../../lib/route';
import { decide as decideOne, decideAll as decideEvery, describeCard, listSuggestions, type StoreLike, type SuggestionCard, type Verdict } from './model';

export interface Card extends SuggestionCard {
  /** Who it reads as from: their name, "Ask AI · <asker>" (ruling R3), or "Agent · <name>" for a workspace agent's run. */
  author: string;
  /** What it does, in words. */
  text: string;
}

export const ACTIVE_HL = 'mn-sugg-active';
const BLOCK_KINDS = new Set(['add', 'remove', 'type']);
export const isBlockCard = (c: SuggestionCard) => BLOCK_KINDS.has(c.kind);

export function toCards(list: SuggestionCard[], nameOf: (id: string) => string | undefined): Card[] {
  return list.map((c) => {
    const name = nameOf(c.by) || 'Someone';
    return { ...c, author: c.via === 'ai' ? (c.agent ? `Agent · ${c.agent}` : `Ask AI · ${name}`) : name, text: describeCard(c) };
  });
}

/** The next (`dir` 1) or previous (-1) id after `active`, wrapping. */
export function stepActive(ids: string[], active: string | null, dir: 1 | -1): string | null {
  if (!ids.length) return null;
  const i = active ? ids.indexOf(active) : -1;
  if (i < 0) return dir === 1 ? ids[0] : ids[ids.length - 1];
  return ids[(i + dir + ids.length) % ids.length];
}

/** A margin card's width, and its gap from the text. */
export const CARD_W = 240;
export const CARD_GAP = 16;

/** Cards go under their paragraph on a phone, or when the editor has no room
 *  right of the text for a card; otherwise they sit in the margin. */
export function cardsInline({ phone, textRight, areaRight }: { phone: boolean; textRight: number; areaRight: number }): boolean {
  return phone || areaRight - textRight < CARD_W + CARD_GAP;
}

/** Tops for cards that want to sit at `top`, pushed down so none overlaps the one above. */
export function stackCards(items: { top: number; height: number }[], gap: number): number[] {
  let floor = -Infinity;
  return items.map(({ top, height }) => {
    const at = Math.max(top, floor);
    floor = at + height + gap;
    return at;
  });
}

/** The page elements a card stands for: its marked text, or its blocks. */
export function elementsFor(root: Element, card: Pick<SuggestionCard, 'id' | 'kind' | 'blockIds'>): Element[] {
  if (isBlockCard(card as SuggestionCard)) {
    return card.blockIds.flatMap((b) => {
      const el = root.querySelector(`[data-block-id="${CSS.escape(b)}"]`);
      return el ? [el] : [];
    });
  }
  return [...root.querySelectorAll(`[data-sugg-id="${CSS.escape(card.id)}"]`)];
}

/** Mark suggestion `id`'s text with the `mn-sugg-active` highlight; null clears it. */
export function highlightSuggestion(root: Element, id: string | null, blockIds: string[] = []) {
  const registry = (globalThis.CSS as unknown as { highlights?: Map<string, unknown> } | undefined)?.highlights;
  const Highlight = (globalThis as unknown as { Highlight?: new (...r: Range[]) => unknown }).Highlight;
  if (!registry || !Highlight) return;
  if (!id) { registry.delete(ACTIVE_HL); return; }
  const els = [
    ...root.querySelectorAll(`[data-sugg-id="${CSS.escape(id)}"]`),
    ...blockIds.flatMap((b) => [...root.querySelectorAll(`[data-block-id="${CSS.escape(b)}"]`)]),
  ];
  const ranges = els.map((el) => {
    const r = document.createRange();
    r.selectNodeContents(el);
    return r;
  });
  registry.set(ACTIVE_HL, new Highlight(...ranges));
}

// ---- next/previous from the keyboard (lib/hotkeys). The rail mounted last
// answers; there is one page editor or one task peek in front at a time.
const navigators: ((dir: 1 | -1) => boolean)[] = [];
/** Move to the next or previous change. False when no page has any. */
export function navigateSuggestions(dir: 1 | -1): boolean {
  for (let i = navigators.length - 1; i >= 0; i--) if (navigators[i](dir)) return true;
  return false;
}

// ---- a suggestion to open (a `?sugg=` link, an inbox row). The page may not
// be up yet, so the request waits here for the rail whose page holds it.
let wanted: string | null = null;
const wantedListeners = new Set<() => void>();

/** Open suggestion `id`: its card active, its text scrolled into view. */
export function focusSuggestion(id: string) {
  wanted = id;
  wantedListeners.forEach((l) => l());
}

/** The suggestion waiting to be opened when `has` it; taking it clears it. */
export function takeWanted(has: (id: string) => boolean): string | null {
  if (!wanted || !has(wanted)) return null;
  const id = wanted;
  wanted = null;
  return id;
}

let users: Promise<Map<string, string>> | null = null;
const userNames = () => (users ??= docsApi.users()
  .then((rows) => new Map(rows.map((u) => [u.id, u.name || u.email])))
  .catch(() => { users = null; return new Map<string, string>(); }));

const storeOf = (el: Element | null): (StoreLike & { doc?: { spaceDoc?: YDocLike } }) | null =>
  ((el?.querySelector('editor-host') as { std?: { store?: unknown } } | null)?.std?.store as never) ?? null;
interface YDocLike { on(e: 'update', f: () => void): void; off(e: 'update', f: () => void): void }

export interface Suggestions {
  cards: Card[];
  active: string | null;
  setActive: (id: string | null) => void;
  next: () => void;
  prev: () => void;
  decide: (id: string, v: Verdict) => void;
  decideAll: (v: Verdict) => void;
  /** A card under the pointer (null when it leaves). */
  hover: (id: string | null) => void;
  /** Bring a card's text into view and make it active. */
  reveal: (id: string) => void;
}

export function useSuggestions(editorEl: Element | null): Suggestions {
  const [store, setStore] = useState<ReturnType<typeof storeOf>>(null);
  const [list, setList] = useState<SuggestionCard[]>([]);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [active, setActive] = useState<string | null>(null);

  // The host renders a beat after the element is handed over.
  useEffect(() => {
    setStore(storeOf(editorEl));
    if (!editorEl || storeOf(editorEl)) return;
    const mo = new MutationObserver(() => {
      const s = storeOf(editorEl);
      if (s) { setStore(s); mo.disconnect(); }
    });
    mo.observe(editorEl, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, [editorEl]);

  // Runs on every keystroke: keep the old list when nothing about the
  // suggestions changed, so the page around the editor doesn't re-render.
  const refresh = useCallback(() => {
    if (!store) return;
    const next = listSuggestions(store);
    setList((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
  }, [store]);

  useEffect(() => {
    if (!store) { setList([]); return; }
    refresh();
    const ydoc = store.doc?.spaceDoc;
    let frame = 0;
    const onUpdate = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(refresh); };
    ydoc?.on('update', onUpdate);
    return () => { ydoc?.off('update', onUpdate); cancelAnimationFrame(frame); };
  }, [store, refresh]);

  const hasCards = list.length > 0;
  useEffect(() => { if (hasCards) void userNames().then(setNames); }, [hasCards]);

  const cards = useMemo(() => toCards(list, (id) => names.get(id)), [list, names]);
  const byId = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards]);

  // A card decided elsewhere takes the active mark with it.
  const live = active && byId.has(active) ? active : null;

  const paint = useCallback((id: string | null) => {
    if (!editorEl) return;
    const c = id ? byId.get(id) : undefined;
    highlightSuggestion(editorEl, c ? id : null, c && isBlockCard(c) ? c.blockIds : []);
  }, [editorEl, byId]);

  useEffect(() => { paint(live); }, [paint, live]);
  useEffect(() => () => { if (editorEl) highlightSuggestion(editorEl, null); }, [editorEl]);

  const reveal = useCallback((id: string) => {
    setActive(id);
    const c = byId.get(id);
    if (editorEl && c) elementsFor(editorEl, c)[0]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [editorEl, byId]);

  // `/d/<doc>?sugg=<id>` (agents' links, notifications): read once, then the
  // address is left clean so a reload doesn't jump back to it.
  const [wantedBump, bumpWanted] = useState(0);
  const wantedTimer = useRef<number | undefined>(undefined);
  // Also on popstate: the phone app opens a push's link that way, maybe on the page already open.
  useEffect(() => {
    const l = () => bumpWanted((n) => n + 1);
    const fromRoute = () => {
      const { suggId } = readRoute();
      if (!suggId) return;
      history.replaceState(history.state, '', location.pathname + location.hash);
      focusSuggestion(suggId);
    };
    wantedListeners.add(l);
    fromRoute();
    window.addEventListener('popstate', fromRoute);
    return () => { wantedListeners.delete(l); window.removeEventListener('popstate', fromRoute); };
  }, []);
  useEffect(() => {
    const id = editorEl && takeWanted((x) => byId.has(x));
    if (!id) return;
    setActive(id);
    // The text may not be drawn yet when the store already has it. Not
    // cleared by the next update (other people typing re-run this effect).
    const card = byId.get(id)!;
    let tries = 0;
    window.clearInterval(wantedTimer.current);
    wantedTimer.current = window.setInterval(() => {
      const el = elementsFor(editorEl, card)[0];
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      if (el || ++tries >= 10) window.clearInterval(wantedTimer.current);
    }, 200);
  }, [editorEl, byId, wantedBump]);
  useEffect(() => () => window.clearInterval(wantedTimer.current), []);

  const ids = useMemo(() => cards.map((c) => c.id), [cards]);
  const go = useCallback((dir: 1 | -1) => {
    const id = stepActive(ids, live, dir);
    if (id) reveal(id);
    return !!id;
  }, [ids, live, reveal]);

  const goRef = useRef(go);
  goRef.current = go;
  useEffect(() => {
    const nav = (dir: 1 | -1) => goRef.current(dir);
    navigators.push(nav);
    return () => { navigators.splice(navigators.indexOf(nav), 1); };
  }, []);

  // Clicking suggested text makes its card the active one.
  useEffect(() => {
    if (!editorEl) return;
    const onClick = (e: Event) => {
      const t = e.target as Element | null;
      const run = t?.closest?.('[data-sugg-id]')?.getAttribute('data-sugg-id');
      if (run && byId.has(run)) return setActive(run);
      const block = t?.closest?.('[data-mn-sugg]')?.getAttribute('data-block-id');
      const c = block ? cards.find((x) => isBlockCard(x) && x.blockIds.includes(block)) : undefined;
      if (c) setActive(c.id);
    };
    editorEl.addEventListener('click', onClick);
    return () => editorEl.removeEventListener('click', onClick);
  }, [editorEl, byId, cards]);

  return {
    cards,
    active: live,
    setActive,
    next: () => { go(1); },
    prev: () => { go(-1); },
    decide: (id, v) => {
      if (!store) return;
      decideOne(store, id, v);
      if (live === id) setActive(null);
      refresh();
    },
    decideAll: (v) => {
      if (!store) return;
      decideEvery(store, v);
      setActive(null);
      refresh();
    },
    hover: (id) => paint(id ?? live),
    reveal,
  };
}
