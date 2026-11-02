// Suggesting mode writes inline suggestions, and no local typing ever grows
// someone's suggestion (ruling R6). Runs in node over a real store and the
// paragraph's real inline editor (unmounted), as spike.test.ts does; the DOM
// event wiring around these functions is checked live in a browser.
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type * as Y from 'yjs';
import { Container } from '@blocksuite/affine/global/di';
import { StdIdentifier } from '@blocksuite/affine/std';
import { InlineEditor } from '@blocksuite/affine/std/inline';
import { DefaultInlineManagerExtension, InlineSpecExtensions } from '@blocksuite/affine/inlines/preset';
import { LatexInlineSpecExtension } from '@blocksuite/affine/inlines/latex';
import { LinkInlineSpecExtension } from '@blocksuite/affine/inlines/link';
import { ReferenceInlineSpecExtension } from '@blocksuite/affine/inlines/reference';
import { FootNoteInlineSpecExtension } from '@blocksuite/affine/inlines/footnote';
import { MentionInlineSpecExtension } from '@blocksuite/affine/inlines/mention';
import { type BaseTextAttributes, Text } from '@blocksuite/affine/store';
import { TestWorkspace } from '@blocksuite/affine/store/test';
import { getTestStoreManager } from '@blocksuite/integration-test/store';
// BlockSuite's own typing hook, the one that copies the previous run's
// attributes onto typed text. Not exported by the package, so by path.
import { onVBeforeinput, onVCompositionEnd } from '../../../node_modules/@blocksuite/affine-rich-text/src/hooks';
import { suggestInlineExtensions } from './inlineSpec';
import { listSuggestions } from './model';
import { addSuggestedBlock, applyInput, attachSuggestingInput, blockSuiteBinds, type Ed, patchHooks, refusedKey, removeOwnAddedBlock, SUGGESTING_CLASS, suggestableIn, suggestReplacement } from './suggestingInput';

const ME = 'me';
const THEM = { id: 't1', kind: 'ins', by: 'them', at: 1 } as const;

type Attrs = BaseTextAttributes & { mnSugg?: unknown };
type Delta = { insert: string; attributes?: { mnSugg?: { id: string; kind: string; by: string } } & Record<string, unknown> };

function inlineManager() {
  const di = new Container();
  const exts: { setup: (di: never) => void }[] = [
    ...InlineSpecExtensions, LatexInlineSpecExtension, LinkInlineSpecExtension, ReferenceInlineSpecExtension,
    FootNoteInlineSpecExtension, MentionInlineSpecExtension, DefaultInlineManagerExtension,
    ...suggestInlineExtensions(),
  ];
  for (const e of exts) e.setup(di as never);
  di.addValue(StdIdentifier, {} as never);
  return di.provider().get(DefaultInlineManagerExtension.identifier);
}

function page(initial = 'Hello world') {
  const collection = new TestWorkspace({ id: 'si' });
  collection.storeExtensions = getTestStoreManager().get('store');
  collection.start();
  collection.meta.initialize();
  const store = collection.createDoc('si').getStore({ id: 'si' });
  store.load();
  const pageId = store.addBlock('affine:page', {});
  const noteId = store.addBlock('affine:note', {}, pageId);
  const id = store.addBlock('affine:paragraph', { text: new Text(initial) }, noteId);
  const model = store.getBlock(id)!.model as unknown as { text: Text };
  const ed = new InlineEditor<Attrs>(model.text.yText, {
    hooks: { beforeinput: onVBeforeinput as never, compositionEnd: onVCompositionEnd as never },
  });
  ed.setAttributeSchema(inlineManager().getSchema() as never);
  return { store, id, ed: ed as unknown as Ed, yText: model.text.yText };
}

const delta = (t: Y.Text) => t.toDelta() as Delta[];
const sugg = (d: Delta) => d.attributes?.mnSugg;

/** What BlockSuite's beforeinput does for a typed character: run the hook, then insert. */
function typeViaBlockSuite(ed: Ed, index: number, data: string) {
  const ctx = { inlineEditor: ed, raw: { inputType: 'insertText' } as InputEvent, inlineRange: { index, length: 0 }, data, attributes: {} };
  ed.hooks.beforeinput?.(ctx as never);
  ed.insertText(ctx.inlineRange, ctx.data, ctx.attributes);
}

/** What BlockSuite's compositionend does: run the hook, then insert at its range. */
function composeViaBlockSuite(ed: Ed, range: { index: number; length: number }, data: string) {
  const ctx = { inlineEditor: ed, raw: {} as CompositionEvent, inlineRange: range, data, attributes: {} };
  ed.hooks.compositionEnd?.(ctx as never);
  if (ctx.data) ed.insertText(ctx.inlineRange, ctx.data, ctx.attributes);
}

describe('Suggesting mode', () => {
  it('typing "x" inside plain text marks it as my insertion', () => {
    const { ed, yText } = page();
    const caret = applyInput(ed, 'insertText', 'x', { index: 2, length: 0 }, ME);
    const d = delta(yText);
    expect(d.map((x) => x.insert)).toEqual(['He', 'x', 'llo world']);
    expect(sugg(d[1])).toMatchObject({ kind: 'ins', by: ME });
    expect(sugg(d[0])).toBeUndefined();
    expect(caret).toBe(3);
  });

  it("typing right after another user's insertion is a new suggestion of mine; theirs is unchanged", () => {
    const { ed, yText } = page();
    ed.formatText({ index: 0, length: 5 }, { mnSugg: THEM } as never);
    applyInput(ed, 'insertText', 'x', { index: 5, length: 0 }, ME);
    const d = delta(yText);
    expect(d[0]).toEqual({ insert: 'Hello', attributes: { mnSugg: THEM } });
    expect(d[1].insert).toBe('x');
    expect(sugg(d[1])).toMatchObject({ kind: 'ins', by: ME });
    expect(sugg(d[1])!.id).not.toBe(THEM.id);
  });

  it('typing next to my own pending insertion joins it', () => {
    const { ed, yText } = page();
    applyInput(ed, 'insertText', 'a', { index: 5, length: 0 }, ME);
    applyInput(ed, 'insertText', 'b', { index: 6, length: 0 }, ME);
    const d = delta(yText);
    expect(d[1].insert).toBe('ab');
    expect(sugg(d[1])).toMatchObject({ kind: 'ins', by: ME });
  });

  it('Backspace over a plain character keeps it, marked deleted by me', () => {
    const { ed, yText } = page();
    const caret = applyInput(ed, 'deleteContentBackward', null, { index: 5, length: 0 }, ME);
    const d = delta(yText);
    expect(d.map((x) => x.insert).join('')).toBe('Hello world');
    expect(d[1].insert).toBe('o');
    expect(sugg(d[1])).toMatchObject({ kind: 'del', by: ME });
    expect(caret).toBe(4);
  });

  it('Backspace twice is one deletion; Delete marks forward and steps over it', () => {
    const { ed, yText } = page();
    applyInput(ed, 'deleteContentBackward', null, { index: 5, length: 0 }, ME);
    applyInput(ed, 'deleteContentBackward', null, { index: 4, length: 0 }, ME);
    expect(delta(yText)[1]).toMatchObject({ insert: 'lo', attributes: { mnSugg: { kind: 'del', by: ME } } });
    const caret = applyInput(ed, 'deleteContentForward', null, { index: 0, length: 0 }, ME);
    expect(caret).toBe(1);
    expect(sugg(delta(yText)[0])).toMatchObject({ kind: 'del' });
  });

  it('Backspace over my own pending insertion really removes it', () => {
    const { ed, yText } = page();
    applyInput(ed, 'insertText', 'xy', { index: 5, length: 0 }, ME);
    applyInput(ed, 'deleteContentBackward', null, { index: 7, length: 0 }, ME);
    expect(delta(yText).map((x) => x.insert)).toEqual(['Hello', 'x', ' world']);
    applyInput(ed, 'deleteContentBackward', null, { index: 6, length: 0 }, ME);
    expect(delta(yText)).toEqual([{ insert: 'Hello world' }]);
  });

  it("Backspace over someone else's suggestion leaves it alone", () => {
    const { ed, yText } = page();
    ed.formatText({ index: 0, length: 5 }, { mnSugg: THEM } as never);
    const caret = applyInput(ed, 'deleteContentBackward', null, { index: 5, length: 0 }, ME);
    expect(delta(yText)[0]).toEqual({ insert: 'Hello', attributes: { mnSugg: THEM } });
    expect(caret).toBe(4);
  });

  it('typing over a selection marks it deleted and the typed text inserted, as one suggestion', () => {
    const { ed, yText } = page();
    const caret = applyInput(ed, 'insertText', 'Hi', { index: 0, length: 5 }, ME);
    const d = delta(yText);
    expect(d.map((x) => x.insert)).toEqual(['Hello', 'Hi', ' world']);
    expect(sugg(d[0])).toMatchObject({ kind: 'del', by: ME });
    expect(sugg(d[1])).toMatchObject({ kind: 'ins', by: ME });
    expect(sugg(d[0])!.id).toBe(sugg(d[1])!.id);
    expect(caret).toBe(7);
  });

  it('a composed word (IME) is my insertion, and composing over a selection replaces it as a suggestion', () => {
    const { ed, yText } = page();
    patchHooks(ed, { userId: ME, on: () => true });
    composeViaBlockSuite(ed, { index: 11, length: 0 }, ' বাংলা');
    expect(delta(yText)[1]).toMatchObject({ insert: ' বাংলা', attributes: { mnSugg: { kind: 'ins', by: ME } } });
    composeViaBlockSuite(ed, { index: 0, length: 5 }, 'হ্যালো');
    const d = delta(yText);
    expect(d.slice(0, 2).map((x) => x.insert)).toEqual(['Hello', 'হ্যালো']);
    expect(sugg(d[0])).toMatchObject({ kind: 'del', by: ME });
    expect(sugg(d[0])!.id).toBe(sugg(d[1])!.id);
  });

  it('Enter at the end of a block adds a block marked as my suggested addition; Backspace in it removes it', () => {
    const { store, id } = page();
    const model = store.getBlock(id)!.model;
    const added = addSuggestedBlock(store as never, model as never, ME)!;
    const cards = listSuggestions(store as never);
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ kind: 'add', by: ME, blockId: added });
    const parent = store.getParent(model)!;
    expect(parent.children.map((c) => c.id)).toEqual([id, added]);
    // Enter again from the added block: same suggestion.
    const second = addSuggestedBlock(store as never, store.getBlock(added)!.model as never, ME)!;
    expect(listSuggestions(store as never)).toHaveLength(1);
    expect(removeOwnAddedBlock(store as never, store.getBlock(second)!.model as never, ME)).toBe(true);
    expect(removeOwnAddedBlock(store as never, model as never, ME)).toBe(false);
    expect(store.getBlock(second)).toBeFalsy();
  });
});

describe('typing outside Suggesting mode (ruling R6)', () => {
  it('BlockSuite on its own grows the suggestion the caret sits after', () => {
    const { ed, yText } = page();
    ed.formatText({ index: 0, length: 5 }, { mnSugg: THEM } as never);
    typeViaBlockSuite(ed, 5, 'x');
    expect(delta(yText)[0]).toEqual({ insert: 'Hellox', attributes: { mnSugg: THEM } });
  });

  it('typed text next to or inside an insertion is plain, and keeps the other formatting', () => {
    const { ed, yText } = page();
    ed.formatText({ index: 0, length: 5 }, { mnSugg: THEM, bold: true } as never);
    patchHooks(ed, { userId: ME, on: () => false });
    typeViaBlockSuite(ed, 5, 'x');
    typeViaBlockSuite(ed, 2, 'y');
    composeViaBlockSuite(ed, { index: 1, length: 0 }, 'z');
    expect(delta(yText).slice(0, 6)).toEqual([
      { insert: 'H', attributes: { mnSugg: THEM, bold: true } },
      { insert: 'z', attributes: { bold: true } },
      { insert: 'e', attributes: { mnSugg: THEM, bold: true } },
      { insert: 'y', attributes: { bold: true } },
      { insert: 'llo', attributes: { mnSugg: THEM, bold: true } },
      { insert: 'x', attributes: { bold: true } },
    ]);
  });
});

describe('what Suggesting mode refuses', () => {
  const key = (k: string, mods: Partial<Record<'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey', boolean>> = {}) =>
    ({ key: k, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods });

  it('Tab and formatting or structure chords; not copy, cut, paste, undo, redo, select all, find or moving', () => {
    for (const k of [key('Tab'), key('Tab', { shiftKey: true }), key('b', { ctrlKey: true }), key('i', { metaKey: true }),
      key('k', { ctrlKey: true }), key('1', { ctrlKey: true, altKey: true }), key('d', { ctrlKey: true })]) {
      expect(refusedKey(k), JSON.stringify(k)).toBe(true);
    }
    for (const k of [key('c', { ctrlKey: true }), key('x', { metaKey: true }), key('v', { ctrlKey: true }), key('z', { ctrlKey: true }),
      key('Z', { metaKey: true, shiftKey: true }), key('y', { ctrlKey: true }), key('a', { ctrlKey: true }), key('f', { ctrlKey: true }),
      key('ArrowLeft', { ctrlKey: true, shiftKey: true }), key('Home', { ctrlKey: true }), key('End', { metaKey: true }), key('x'), key('Enter')]) {
      expect(refusedKey(k), JSON.stringify(k)).toBe(false);
    }
  });

  it('a refused chord keeps the browser\'s default unless BlockSuite binds it (or an app chord takes it)', () => {
    class El { closest() { return null; } }
    let onKeyDown: ((e: unknown) => void) | undefined;
    let appTakes = false;
    vi.stubGlobal('Element', El);
    vi.stubGlobal('KeyboardEvent', class { constructor(public type: string, init: object) { Object.assign(this, init); } });
    vi.stubGlobal('window', {
      addEventListener: (t: string, f: (e: unknown) => void) => { if (t === 'keydown') onKeyDown = f; },
      removeEventListener: () => {},
      dispatchEvent: () => !appTakes,
    });
    try {
      const target = new El();
      const detach = attachSuggestingInput({ contains: (x: unknown) => x === target } as unknown as Element, { userId: ME, on: () => true });
      const press = (k: ReturnType<typeof key> & { code?: string }) => {
        const e = { ...k, target, isComposing: false, keyCode: 0, prevented: false, stopped: false,
          preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; } };
        onKeyDown!(e);
        return [e.stopped, e.prevented];
      };
      // The browser's: print, reload, save, zoom. Kept from BlockSuite, not from the browser.
      for (const k of [key('p', { ctrlKey: true }), key('r', { metaKey: true }), key('s', { ctrlKey: true }), key('=', { ctrlKey: true }), key('-', { metaKey: true })]) {
        expect(press(k), JSON.stringify(k)).toEqual([true, false]);
      }
      // BlockSuite's: bold, link, Heading 1 (Ctrl+Shift+1 arrives as "!"), indent.
      for (const k of [key('b', { ctrlKey: true }), key('k', { metaKey: true }), { ...key('!', { ctrlKey: true, shiftKey: true }), code: 'Digit1' }, key('Tab')]) {
        expect(press(k), JSON.stringify(k)).toEqual([true, true]);
      }
      appTakes = true; // Ctrl+J: the app's theme switch handled the copy
      expect(press(key('j', { ctrlKey: true }))).toEqual([true, true]);
      detach();
    } finally { vi.unstubAllGlobals(); }
    expect(blockSuiteBinds(key('p', { ctrlKey: true }))).toBe(false);
    expect(blockSuiteBinds({ ...key('∫', { metaKey: true, altKey: true }), code: 'KeyB' })).toBe(false);
    expect(blockSuiteBinds({ ...key('ç', { metaKey: true, altKey: true }), code: 'KeyC' })).toBe(true);
  });

  it('AltGr is typing, not a chord: @ { } [ ] \\ | € ~ and Polish or Czech letters', () => {
    for (const k of ['@', '{', '}', '[', ']', '\\', '|', '€', '~', 'ł', 'ś', 'ž']) {
      expect(refusedKey(key(k, { ctrlKey: true, altKey: true })), k).toBe(false);
    }
    const altGr = { ...key('ę'), getModifierState: (m: string) => m === 'AltGraph' };
    expect(refusedKey(altGr)).toBe(false);
  });

  it('moving blocks (Mod+Shift or Mod+Alt with Up/Down) is refused; selecting by word or line is not', () => {
    for (const k of [key('ArrowUp', { ctrlKey: true, shiftKey: true }), key('ArrowDown', { metaKey: true, shiftKey: true }),
      key('ArrowUp', { ctrlKey: true, altKey: true }), key('ArrowDown', { metaKey: true, altKey: true })]) {
      expect(refusedKey(k), JSON.stringify(k)).toBe(true);
    }
    expect(refusedKey(key('ArrowLeft', { ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(refusedKey(key('ArrowUp', { ctrlKey: true }))).toBe(false);
  });

  it('text inside a table or a database is not suggestable (ruling R12)', () => {
    expect(suggestableIn(['affine:paragraph', 'affine:note', 'affine:page'])).toBe(true);
    expect(suggestableIn(['affine:table', 'affine:note'])).toBe(false);
    expect(suggestableIn(['affine:paragraph', 'affine:database'])).toBe(false);
    expect(suggestableIn(['metanoia:database'])).toBe(false);
  });

  it('a composition in text that cannot hold a suggestion (code, latex, the title) is dropped, not written plain', () => {
    const { ed, yText } = page('let x');
    // The code block's schema: no mnSugg.
    (ed as unknown as { setAttributeSchema(s: unknown): void }).setAttributeSchema(z.object({}));
    patchHooks(ed, { userId: ME, on: () => true });
    composeViaBlockSuite(ed, { index: 4, length: 1 }, 'y');
    expect(yText.toString()).toBe('let x');
  });

  it('attaches its listeners for the editor it is given', () => {
    const add = vi.fn();
    const remove = vi.fn();
    vi.stubGlobal('window', { addEventListener: add, removeEventListener: remove });
    try {
      const detach = attachSuggestingInput({} as Element, { userId: ME, on: () => true });
      expect(add.mock.calls.map((c) => [c[0], c[2]])).toEqual(
        ['beforeinput', 'compositionstart', 'keydown', 'cut', 'paste'].map((t) => [t, true]));
      detach();
      expect(remove).toHaveBeenCalledTimes(5);
    } finally { vi.unstubAllGlobals(); }
  });
});

describe('the Suggest button writes an inline replace (suggestReplacement)', () => {
  it('marks the passage deleted and the new text inserted, by me, under one id: one replace card, one undo step', () => {
    const { store, yText } = page('Hello world');
    let transactions = 0;
    yText.doc!.on('afterTransaction', () => { transactions++; });
    expect(suggestReplacement(yText, { index: 6, length: 5 }, 'there', ME)).toBe(true);
    const d = delta(yText);
    expect(d.map((x) => x.insert)).toEqual(['Hello ', 'world', 'there']);
    expect(sugg(d[1])).toMatchObject({ kind: 'del', by: ME });
    expect(sugg(d[2])).toMatchObject({ kind: 'ins', by: ME, id: sugg(d[1])!.id });
    expect(transactions).toBe(1);
    const cards = listSuggestions(store as never);
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ kind: 'replace', before: 'world', after: 'there', by: ME });
  });

  it('an empty replacement suggests deleting the passage', () => {
    const { yText } = page('Hello world');
    suggestReplacement(yText, { index: 5, length: 6 }, '', ME);
    const d = delta(yText);
    expect(d.map((x) => x.insert)).toEqual(['Hello', ' world']);
    expect(sugg(d[1])).toMatchObject({ kind: 'del', by: ME });
  });

  it("leaves someone else's pending text inside the passage alone", () => {
    const { yText } = page('Hello world');
    yText.format(0, 5, { mnSugg: THEM });
    suggestReplacement(yText, { index: 0, length: 11 }, 'Bye', ME);
    const d = delta(yText);
    expect(d.map((x) => x.insert)).toEqual(['Hello', ' world', 'Bye']);
    expect(sugg(d[0])).toEqual(THEM);
    expect(sugg(d[1])).toMatchObject({ kind: 'del', by: ME });
  });

  it('refuses a range that is not in the text', () => {
    const { yText } = page('Hi');
    expect(suggestReplacement(yText, { index: 1, length: 5 }, 'x', ME)).toBe(false);
    expect(yText.toString()).toBe('Hi');
  });
});

describe('Suggesting mode hides the formatting and structure tools (ruling R11)', () => {
  it('the format toolbar, slash menu, @ menu, drag handle and phone toolbar are hidden under the class', () => {
    const css = readFileSync(new URL('../../index.css', import.meta.url), 'utf8');
    const rule = css.match(new RegExp(`((?:html\\.${SUGGESTING_CLASS} [a-z-]+,?\\s*)+)\\{\\s*display: none !important;`));
    expect(rule, 'hiding rule').toBeTruthy();
    for (const el of ['affine-toolbar-widget', 'affine-slash-menu', 'affine-linked-doc-popover', 'affine-drag-handle-widget', 'affine-keyboard-toolbar',
      'affine-code-toolbar', 'latex-editor-menu', 'affine-emoji-menu']) {
      expect(rule![1]).toContain(`html.${SUGGESTING_CLASS} ${el}`);
    }
  });

  it('the to-do checkbox and the callout icon take no clicks (ruling R11b)', () => {
    const css = readFileSync(new URL('../../index.css', import.meta.url), 'utf8');
    const rule = css.match(new RegExp(`((?:html\\.${SUGGESTING_CLASS} [.a-z_-]+,?\\s*)+)\\{\\s*pointer-events: none !important;`));
    expect(rule, 'pointer rule').toBeTruthy();
    for (const sel of ['.affine-list-block__todo-prefix', '.affine-callout-emoji']) expect(rule![1]).toContain(`html.${SUGGESTING_CLASS} ${sel}`);
  });
});
