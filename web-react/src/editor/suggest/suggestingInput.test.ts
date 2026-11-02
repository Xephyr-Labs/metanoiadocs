// Suggesting mode writes inline suggestions, and no local typing ever grows
// someone's suggestion (ruling R6). Runs in node over a real store and the
// paragraph's real inline editor (unmounted), as spike.test.ts does; the DOM
// event wiring around these functions is checked live in a browser.
import { describe, expect, it } from 'vitest';
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
import { addSuggestedBlock, applyInput, type Ed, patchHooks, removeOwnAddedBlock } from './suggestingInput';

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
