// Suggesting mode: a person's typing becomes inline suggestions on the live
// page (docs/superpowers/specs/2026-11-02-inline-suggestions-design.md).
//
// While it is on, inserted text carries `mnSugg` {kind 'ins', by: me};
// Backspace, Delete, cut and typing over a selection mark text {kind 'del'}
// instead of removing it, except text that is my own pending insertion, which
// really goes; Enter at the end of a paragraph or list item adds a block marked
// `prop:mnSugg` {kind 'add'}. Everything else that would change the page from
// the keyboard (Enter mid-block, Backspace at a block's start, typing across
// blocks, text inside code/latex/the title) does nothing.
//
// Whether it is on or not, no local typing grows a suggestion (ruling R6):
// BlockSuite's typing hook copies the previous run's attributes onto typed
// text, `mnSugg` included, so every inline editor's hooks are wrapped to say
// what `mnSugg` the new text gets — none, or my own.
//
// Only these Yjs changes come out of here (the server guard's list, Task 10):
// insert text carrying my `ins`; format text that has no `mnSugg` with my
// `del`; delete runs of my own `ins`; add a paragraph/list block whose
// `prop:mnSugg` is my `add`; delete an empty block whose `prop:mnSugg` is my
// own `add`.
import { focusTextModel } from '@blocksuite/affine/rich-text';
import { Text } from '@blocksuite/affine/store';
import type * as Y from 'yjs';
import type { Suggestion } from './inlineSpec';

type Range = { index: number; length: number };
type Attrs = Record<string, unknown> & { mnSugg?: Suggestion | null };

/** The InlineEditor surface this uses (typed loosely: it is generic over attributes). */
export interface Ed {
  yText: Y.Text;
  rootElement: Element | null;
  isReadonly: boolean;
  isComposing: boolean;
  hooks: { beforeinput?: (ctx: HookCtx) => void; compositionEnd?: (ctx: HookCtx) => void };
  insertText(range: Range, text: string, attributes?: Attrs): void;
  deleteText(range: Range): void;
  formatText(range: Range, attributes: Attrs, options?: { match?: (delta: { attributes?: Attrs }) => boolean }): void;
  setInlineRange(range: Range | null): void;
  getInlineRange(): Range | null;
  toInlineRange(range: globalThis.Range): Range | null;
  normalizeAttributes(attributes?: Attrs): Attrs | undefined;
  isEmbed(delta: { insert: string; attributes?: Attrs }): boolean;
}
interface HookCtx { inlineRange: Range; data: string | null; attributes: Attrs }

export interface SuggestingOptions {
  /** My user id: the author of what I suggest. */
  userId: string;
  /** Suggesting mode is on now. Asked on every edit. */
  on: () => boolean;
}

type Op = { insert: unknown; attributes?: Attrs };

/** The runs of `yText` inside [from, to), clipped to it. */
function runs(yText: Y.Text, from: number, to: number) {
  const out: { at: number; len: number; op: Op }[] = [];
  let at = 0;
  for (const op of yText.toDelta() as Op[]) {
    const len = typeof op.insert === 'string' ? op.insert.length : 1;
    const s = Math.max(at, from);
    const e = Math.min(at + len, to);
    if (s < e) out.push({ at: s, len: e - s, op });
    at += len;
  }
  return out;
}
const opAt = (yText: Y.Text, i: number): Op | undefined => (i < 0 ? undefined : runs(yText, i, i + 1)[0]?.op);

/** Mine to extend or remove: my own, not an Ask AI one that carries my id as the asker. */
const isMine = (s: Suggestion | null | undefined, me: string): s is Suggestion => !!s && s.by === me && !s.via;

/** My own suggestion right beside [from, to), to join. */
function neighbour(yText: Y.Text, from: number, to: number, me: string): Suggestion | undefined {
  for (const s of [opAt(yText, from - 1)?.attributes?.mnSugg, opAt(yText, to)?.attributes?.mnSugg]) {
    if (isMine(s, me)) return s;
  }
  return undefined;
}

// randomUUID is missing outside a secure context (the workspace is often
// reached over plain http at a LAN address; see lib/clipboard.ts).
const newId = () => crypto.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;

type Base = { id: string; at: number };
/** A suggestion joined keeps its id and time, so the new text's attributes
 *  equal its neighbour's and Yjs keeps them one run. */
const mark = ({ id, at }: Base, kind: 'ins' | 'del', me: string): Suggestion => ({ id, kind, by: me, at });

/**
 * Suggest deleting `range`: my own pending insertions in it really go, text
 * with no suggestion is marked deleted by me, anyone else's suggestion stays.
 * Returns the suggestion it joined or started, and where the kept text now ends.
 */
export function suggestDelete(ed: Ed, range: Range, me: string) {
  const end = range.index + range.length;
  const base: Base = neighbour(ed.yText, range.index, end, me) ?? { id: newId(), at: Date.now() };
  const own = runs(ed.yText, range.index, end).filter((r) => r.op.attributes?.mnSugg?.kind === 'ins' && isMine(r.op.attributes.mnSugg, me));
  for (const r of own.reverse()) ed.deleteText({ index: r.at, length: r.len });
  const kept = range.length - own.reduce((n, r) => n + r.len, 0);
  if (kept) ed.formatText({ index: range.index, length: kept }, { mnSugg: mark(base, 'del', me) }, { match: (d) => !d.attributes?.mnSugg });
  return { base, end: range.index + kept };
}

/**
 * Where text typed over `range` goes and the `mnSugg` it carries: the range is
 * suggested deleted first and the text lands after it, in the same suggestion;
 * otherwise beside my own pending suggestion it joins that one, else a new one.
 */
function prepareInsert(ed: Ed, range: Range, me: string) {
  let at = range.index;
  let base: Base | undefined;
  if (range.length) ({ base, end: at } = suggestDelete(ed, range, me));
  base ??= neighbour(ed.yText, at, at, me) ?? { id: newId(), at: Date.now() };
  return { at, mnSugg: mark(base, 'ins', me) };
}

/** The formatting typed text picks up from the text before it, as BlockSuite
 *  does: not an embed's, not a link or code that ends here, never `mnSugg`. */
function carriedFormat(ed: Ed, at: number): Attrs {
  const prev = opAt(ed.yText, at - 1);
  if (!prev || typeof prev.insert !== 'string' || ed.isEmbed(prev as never)) return {};
  const next = opAt(ed.yText, at)?.attributes ?? {};
  const out: Attrs = { ...prev.attributes };
  delete out.mnSugg;
  for (const k of ['link', 'code']) if (next[k] !== out[k]) delete out[k];
  return out;
}

/** This inline editor's schema keeps `mnSugg` (code blocks, latex and the title do not: ruling R7). */
const canHold = (ed: Ed) => !!ed.normalizeAttributes({ mnSugg: mark({ id: 'probe', at: 0 }, 'ins', 'probe') })?.mnSugg;

// Table and database cells hold their own text; suggesting there is out of v1 (ruling R12).
const NOT_SUGGESTABLE = new Set(['affine:table', 'affine:database', 'metanoia:database']);
/** False when the text sits in (or under) a table or database block. */
export const suggestableIn = (flavours: string[]) => !flavours.some((f) => NOT_SUGGESTABLE.has(f));

/** The flavours of every block the inline editor sits in, innermost first. */
function enclosingFlavours(ed: Ed): string[] {
  const out: string[] = [];
  for (let el = ed.rootElement?.closest('[data-block-id]'); el; el = el.parentElement?.closest('[data-block-id]')) {
    const f = (el as Element & { model?: { flavour?: string } }).model?.flavour;
    if (f) out.push(f);
  }
  return out;
}

/** Text typed here can be marked as a suggestion. */
const suggestable = (ed: Ed) => canHold(ed) && suggestableIn(enclosingFlavours(ed));

const MOD_ALLOWED = new Set(['c', 'x', 'v', 'z', 'y', 'a', 'f', 'arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'home', 'end']);
/**
 * Keys Suggesting mode refuses: Tab (indent) and every Ctrl/Meta chord that is
 * not copy, cut, paste, undo, redo, select all, find or moving the caret —
 * formatting, links, headings, duplicating are not suggestable in v1.
 * Cut and paste go on to the cut/paste handlers below.
 */
export function refusedKey(e: KeyLike): boolean {
  if (e.key === 'Tab') return true;
  if ((!e.ctrlKey && !e.metaKey) || altGr(e)) return false;
  // Mod+Shift / Mod+Alt with Up or Down is BlockSuite's moveBlocks.
  if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && (e.shiftKey || e.altKey)) return true;
  return !MOD_ALLOWED.has(e.key.toLowerCase()) && !['Backspace', 'Delete', 'Enter'].includes(e.key);
}

type KeyLike = { key: string; code?: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean; getModifierState?(k: string): boolean };

/**
 * The refused keys BlockSuite binds in a page (its keymaps: formatting,
 * links, text conversions, moving blocks, indent). Only these keep their
 * preventDefault when refused: anything else (Ctrl+P, Ctrl+R, Ctrl+S, zoom)
 * is the browser's, and Suggesting mode only keeps BlockSuite out of it.
 * Edgeless-only bindings (zoom, grouping) do not apply: Suggesting is page mode.
 */
const BLOCKSUITE_CHORDS = new Set([
  'Mod-b', 'Mod-i', 'Mod-u', 'Mod-e', 'Mod-k', 'Mod-Shift-s', 'Mod-Shift-l',
  ...['0', '1', '2', '3', '4', '5', '6', '8', '9', 'd'].flatMap((k) => [`Mod-Alt-${k}`, `Mod-Shift-${k}`]), 'Mod-Alt-c',
  'Mod-Shift-ArrowUp', 'Mod-Shift-ArrowDown', 'Mod-Alt-ArrowUp', 'Mod-Alt-ArrowDown',
]);
export function blockSuiteBinds(e: KeyLike): boolean {
  if (e.key === 'Tab') return true;
  if (!e.ctrlKey && !e.metaKey) return false;
  const mods = `Mod-${e.shiftKey ? 'Shift-' : ''}${e.altKey ? 'Alt-' : ''}`;
  // Shift and Alt change the character (Shift+1 is "!", Option+b is "∫"): the physical key decides too.
  const fromCode = /^(?:Key|Digit)(.)$/.exec(e.code ?? '')?.[1].toLowerCase();
  const names = [e.key.length === 1 ? e.key.toLowerCase() : e.key, fromCode].filter(Boolean);
  return names.some((n) => BLOCKSUITE_CHORDS.has(mods + n));
}
/** A character typed with AltGr: Windows reports it as Ctrl+Alt (@ { } [ ] € ł…).
 *  A plain letter or digit is a Ctrl+Alt chord instead (Ctrl+Alt+1 = Heading 1). */
const altGr = (e: KeyLike) => [...e.key].length === 1 && !/^[a-z0-9]$/i.test(e.key)
  && (!!e.getModifierState?.('AltGraph') || (e.ctrlKey && e.altKey && !e.metaKey));

/**
 * Apply one input in Suggesting mode, given the inline range it acts on.
 * Returns where the caret goes, or null when the input changes nothing.
 */
export function applyInput(ed: Ed, inputType: string, data: string | null, range: Range, me: string): number | null {
  if (inputType === 'insertLineBreak') data = '\n';
  if (inputType.startsWith('insert')) {
    if (!data) return null;
    const { at, mnSugg } = prepareInsert(ed, range, me);
    ed.insertText({ index: at, length: 0 }, data, { ...carriedFormat(ed, at), mnSugg });
    return at + data.length;
  }
  if (!inputType.startsWith('delete')) return null;
  const back = !inputType.includes('Forward');
  let r = range;
  if (!r.length) {
    r = back ? { index: r.index - 1, length: 1 } : { index: r.index, length: 1 };
    if (r.index < 0 || r.index + 1 > ed.yText.length) return null;
  }
  const { end } = suggestDelete(ed, r, me);
  return back || range.length ? r.index : end;
}

/** Inline embeds (a page link, an equation, a footnote, a mention): typed text never takes their attributes. */
const EMBEDS = ['reference', 'latex', 'footnote', 'mention'];

/**
 * The Suggest button: suggest replacing `range` of `yText` with `text` (empty:
 * deleting it), as selecting it and typing in Suggesting mode would — one
 * replace, del + ins under one id, by me, in one transaction (one undo step).
 * Straight on the Y.Text, not through a mounted inline editor, which refuses
 * writes on a read-only page (a suggester's). False when `range` is not in it.
 */
export function suggestReplacement(yText: Y.Text, range: Range, text: string, me: string): boolean {
  const doc = yText.doc;
  if (!doc || !range.length || range.index < 0 || range.index + range.length > yText.length) return false;
  const ed = {
    yText,
    insertText: (r: Range, t: string, a?: Attrs) => { yText.insert(r.index, t, a ?? {}); },
    deleteText: (r: Range) => { yText.delete(r.index, r.length); },
    formatText: (r: Range, a: Attrs, { match }: { match?: (d: { attributes?: Attrs }) => boolean } = {}) => {
      for (const run of runs(yText, r.index, r.index + r.length)) if (!match || match(run.op)) yText.format(run.at, run.len, a);
    },
    isEmbed: (d: { attributes?: Attrs }) => EMBEDS.some((k) => d.attributes?.[k]),
  } as unknown as Ed;
  doc.transact(() => {
    applyInput(ed, text ? 'insertReplacementText' : 'deleteContentBackward', text || null, range, me);
  }, doc.clientID);
  return true;
}

const wrapped = new WeakSet<Ed>();

/**
 * Wrap an inline editor's typing hooks so typed and composed text never
 * inherits a suggestion: plain outside Suggesting mode, my own insertion in it.
 * A composition over a selection (an IME replacing a word) is suggested as a
 * replacement there. Wrapped once per editor; innermost, so the Android
 * recompose fix (androidRecompose.ts) has already set the range it reads.
 */
export function patchHooks(ed: Ed, { userId, on }: SuggestingOptions) {
  if (wrapped.has(ed)) return;
  wrapped.add(ed);
  const { beforeinput, compositionEnd } = ed.hooks;
  ed.hooks.beforeinput = (ctx) => {
    beforeinput?.(ctx);
    ctx.attributes = { ...ctx.attributes, mnSugg: null };
  };
  ed.hooks.compositionEnd = (ctx) => {
    compositionEnd?.(ctx);
    if (on() && !suggestable(ed)) {
      // Code, latex, the title, a table or database cell (rulings R7, R12):
      // nothing can be suggested here, and a plain write would be a direct edit.
      ctx.data = '';
      ctx.inlineRange = { index: ctx.inlineRange.index, length: 0 };
      return;
    }
    if (!on()) {
      ctx.attributes = { ...ctx.attributes, mnSugg: null };
      return;
    }
    const { at, mnSugg } = prepareInsert(ed, ctx.inlineRange, userId);
    ctx.inlineRange = { index: at, length: 0 };
    ctx.attributes = { ...ctx.attributes, mnSugg };
    if (!ctx.data) ed.setInlineRange({ index: at, length: 0 });
  };
}

interface YBlockLike { get(k: string): unknown; set(k: string, v: unknown): void }
interface BlockModel { id: string; flavour: string; props: { type?: string; text?: Text }; children: BlockModel[]; yBlock?: YBlockLike }
interface StoreLike {
  doc: { spaceDoc: Y.Doc };
  transact(fn: () => void): void;
  captureSync(): void;
  addBlock(flavour: string, props: Record<string, unknown>, parent: BlockModel, index: number): string;
  deleteBlock(model: BlockModel): void;
  getBlock(id: string): { model: BlockModel } | null | undefined;
  getParent(model: BlockModel): BlockModel | null;
}

const blockSugg = (m: BlockModel) => m.yBlock?.get('prop:mnSugg') as { id: string; kind: string; by: string; at: number; via?: string } | undefined;

/**
 * Enter at the end of `model` in Suggesting mode: a new empty block after it,
 * a list item for a list item and a paragraph otherwise, marked as my suggested
 * addition — the same suggestion as `model` when that is my own addition too.
 * Returns its id.
 */
export function addSuggestedBlock(store: StoreLike, model: BlockModel, me: string): string | null {
  const parent = store.getParent(model);
  if (!parent) return null;
  const list = model.flavour === 'affine:list';
  const own = blockSugg(model);
  const base: Base = own?.kind === 'add' && isMine(own as Suggestion, me) ? own as Base : { id: newId(), at: Date.now() };
  let added: string | null = null;
  store.captureSync();
  store.transact(() => {
    // ponytail: always the next sibling; BlockSuite puts it first among the children of an expanded parent.
    added = store.addBlock(list ? 'affine:list' : 'affine:paragraph', { type: list ? model.props.type : 'text', text: new Text() }, parent, parent.children.indexOf(model) + 1);
    // In the same transaction, so no one ever sees the block unmarked; the
    // store builds its model only after the transaction, hence the Y map.
    (store.doc.spaceDoc.getMap('blocks').get(added) as YBlockLike).set('prop:mnSugg', { id: base.id, kind: 'add', by: me, at: base.at });
  });
  return added;
}

/** Backspace in an empty block that is my own suggested addition: it goes. */
export function removeOwnAddedBlock(store: StoreLike, model: BlockModel, me: string): boolean {
  const s = blockSugg(model);
  if (s?.kind !== 'add' || !isMine(s as Suggestion, me) || model.props.text?.length || model.children.length) return false;
  store.captureSync();
  store.deleteBlock(model);
  return true;
}

// ---- DOM wiring -------------------------------------------------------------

/** On <html> while Suggesting mode is on: index.css hides BlockSuite's format
 *  toolbar, slash and @ menus, drag handle and phone toolbar (ruling R11) —
 *  formatting and structure are not suggestable in v1. On <html> because the
 *  menus render into document.body. */
export const SUGGESTING_CLASS = 'mn-suggesting';

type Root = Element & { inlineEditor?: Ed };

/** The inline editor holding the whole selection, or null when it spans several (or none). */
function editorAtSelection(): Ed | null {
  const sel = document.getSelection();
  const root = (n: Node | null | undefined) => (n instanceof Element ? n : n?.parentElement)?.closest('[data-v-root="true"]') as Root | null;
  const a = root(sel?.anchorNode);
  return a && a === root(sel?.focusNode) ? a.inlineEditor ?? null : null;
}

interface StdLike { store: StoreLike }
const blockOf = (ed: Ed, editorEl: Element) => {
  const id = ed.rootElement?.closest('[data-block-id]')?.getAttribute('data-block-id');
  const std = (editorEl.querySelector('editor-host') as (Element & { std?: StdLike }) | null)?.std;
  const model = id ? std?.store.getBlock(id)?.model : undefined;
  return std && model ? { std, model } : null;
};

/** The range a beforeinput acts on: the browser's target range when it has one (a word, a grapheme), else the caret. */
function targetRange(ed: Ed, e: InputEvent): Range | null {
  const t = e.getTargetRanges?.()[0];
  if (t && !t.collapsed) {
    const r = document.createRange();
    r.setStart(t.startContainer, t.startOffset);
    r.setEnd(t.endContainer, t.endOffset);
    const ir = ed.toInlineRange(r);
    if (ir?.length) return ir;
  }
  return ed.getInlineRange();
}

const stop = (e: Event) => { e.preventDefault(); e.stopImmediatePropagation(); };
const printable = (e: KeyboardEvent) => [...e.key].length === 1 && ((!e.ctrlKey && !e.metaKey) || altGr(e));

/**
 * Listen on window, in the capture phase, for events inside `editorEl`: this
 * runs before BlockSuite's own handlers and before this app's document-level
 * ones (heading and column Enter in blockGaps/columns, markdown paste, emoji
 * shortcodes). In Suggesting mode it takes over typing, deleting, Enter, cut
 * and paste; in any mode it wraps each inline editor's hooks (R6).
 */
export function attachSuggestingInput(editorEl: Element, opts: SuggestingOptions): () => void {
  const me = opts.userId;
  const ready = (ed: Ed | null): ed is Ed => !!ed && !ed.isReadonly && suggestable(ed);
  const caret = (ed: Ed, at: number | null) => { if (at !== null) ed.setInlineRange({ index: at, length: 0 }); };

  const onBeforeInput = (ev: Event) => {
    const e = ev as InputEvent;
    const ed = editorAtSelection();
    if (ed) patchHooks(ed, opts);
    if (!opts.on() || e.isComposing || ed?.isComposing || e.inputType === 'insertCompositionText' || e.inputType.startsWith('history')) return;
    // insertParagraph is Enter, handled on keydown; formats, drops and anything
    // across blocks stop here.
    stop(e);
    if (!ready(ed)) return;
    const range = targetRange(ed, e);
    if (!range) return;
    const data = e.data ?? e.dataTransfer?.getData('text/plain') ?? null;
    caret(ed, applyInput(ed, e.inputType, data, range, me));
  };

  const onCompositionStart = () => { const ed = editorAtSelection(); if (ed) patchHooks(ed, opts); };

  const onKeyDown = (ev: Event) => {
    const e = ev as KeyboardEvent;
    if (!opts.on() || e.isComposing || e.keyCode === 229) return;
    if (refusedKey(e)) {
      // Kept from BlockSuite always; from the browser only where BlockSuite
      // would have taken it (blockSuiteBinds) or an app chord does below.
      e.stopImmediatePropagation();
      if (blockSuiteBinds(e)) e.preventDefault();
      // The app's own chords (palette, sidebar, theme) listen on window and
      // would never see this one: hand them a copy, from outside the editor.
      if ((e.ctrlKey || e.metaKey) && !window.dispatchEvent(new KeyboardEvent('keydown', e))) e.preventDefault();
      return;
    }
    const ed = editorAtSelection();
    const range = ed?.getInlineRange();
    if (e.key === 'Enter') {
      stop(e);
      if (!ready(ed) || !range) return;
      if (e.shiftKey) return caret(ed, applyInput(ed, 'insertLineBreak', null, range, me));
      const b = blockOf(ed, editorEl);
      if (!b || range.length || range.index !== ed.yText.length || !['affine:paragraph', 'affine:list'].includes(b.model.flavour)) return;
      const id = addSuggestedBlock(b.std.store, b.model, me);
      if (id) focusTextModel(b.std as never, id);
    } else if (e.key === 'Backspace' || e.key === 'Delete') {
      // Never BlockSuite's keymaps (merging blocks, deleting selected blocks);
      // the beforeinput that follows marks the text.
      e.stopImmediatePropagation();
      if (!ready(ed) || !range) return e.preventDefault();
      const atEdge = !range.length && (e.key === 'Backspace' ? range.index === 0 : range.index === ed.yText.length);
      if (!atEdge) return;
      e.preventDefault();
      const b = e.key === 'Backspace' ? blockOf(ed, editorEl) : null;
      if (!b) return;
      const parent = b.std.store.getParent(b.model);
      const prev = parent?.children[parent.children.indexOf(b.model) - 1];
      if (removeOwnAddedBlock(b.std.store, b.model, me) && prev?.props.text) focusTextModel(b.std as never, prev.id, prev.props.text.length);
    } else if (printable(e) && !(e.altKey && !e.ctrlKey && !altGr(e))) { // plain Alt: Alt+[ / Alt+] step through changes (window hotkeys)
      if (!ed) return stop(e); // typing over a selection across blocks
      // Not to BlockSuite: its slash menu opens on keydown. The text itself
      // arrives as the beforeinput that follows.
      e.stopImmediatePropagation();
    }
  };

  const onCut = (ev: Event) => {
    if (!opts.on()) return;
    const e = ev as ClipboardEvent;
    const ed = editorAtSelection();
    const range = ed?.getInlineRange();
    e.clipboardData?.setData('text/plain', document.getSelection()?.toString() ?? '');
    stop(e);
    if (!ready(ed) || !range?.length) return;
    suggestDelete(ed, range, me);
    caret(ed, range.index);
  };

  const onPaste = (ev: Event) => {
    if (!opts.on()) return;
    const e = ev as ClipboardEvent;
    stop(e);
    const ed = editorAtSelection();
    const range = ed?.getInlineRange();
    const text = e.clipboardData?.getData('text/plain').replace(/\r\n?/g, '\n');
    // Pasted as text, line breaks kept as soft breaks inside this block.
    if (ready(ed) && range && text) caret(ed, applyInput(ed, 'insertFromPaste', text, range, me));
  };

  const listeners: [string, (e: Event) => void][] = [
    ['beforeinput', onBeforeInput], ['compositionstart', onCompositionStart], ['keydown', onKeyDown], ['cut', onCut], ['paste', onPaste],
  ];
  // Text fields inside the editor (a link's URL, a database cell, a menu's
  // search) are not the page and keep their own typing.
  const ours = (e: Event) => e.target instanceof Element && editorEl.contains(e.target) && !e.target.closest('input, textarea');
  const guarded = listeners.map(([t, f]) => [t, (e: Event) => { if (ours(e)) f(e); }] as const);
  for (const [t, f] of guarded) window.addEventListener(t, f, true);
  return () => { for (const [t, f] of guarded) window.removeEventListener(t, f, true); };
}
