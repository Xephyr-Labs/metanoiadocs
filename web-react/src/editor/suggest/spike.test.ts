// A suggestion is a text attribute, `mnSugg`, on the live page. That only works
// if BlockSuite keeps it: the inline editor runs every format and insert through
// a zod schema built from the registered inline specs, and an object schema
// strips keys it does not know. So the attribute has to be a registered spec,
// and this checks it stays through a local edit, undo/redo and a sync.
//
// The suite runs in node: no editor is mounted. The inline editor's text and
// attribute services are the same ones a mounted paragraph uses, over the
// paragraph's own Y.Text, with the schema the paragraph would get.
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
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
import { suggestInlineExtensions } from './inlineSpec';

const SUGG = { id: 's1', kind: 'ins', by: 'u1', at: 1_700_000_000_000 } as const;
const AI_SUGG = { id: 's2', kind: 'del', by: 'u1', at: 1_700_000_000_001, via: 'ai' } as const;

type Attrs = BaseTextAttributes & { mnSugg?: unknown };
type Delta = { insert: string; attributes?: Record<string, unknown> }[];

/** The paragraph's inline manager, registered the way mountEditor does: the
 *  view's specs and default manager first, ours after them. */
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

function page() {
  const collection = new TestWorkspace({ id: 'spike' });
  collection.storeExtensions = getTestStoreManager().get('store');
  collection.start();
  collection.meta.initialize();
  const doc = collection.createDoc('spike');
  const store = doc.getStore({ id: 'spike' });
  store.load();
  const pageId = store.addBlock('affine:page', {});
  const noteId = store.addBlock('affine:note', {}, pageId);
  const id = store.addBlock('affine:paragraph', { text: new Text('Hello world') }, noteId);
  const yText = (store.getBlock(id)!.model as unknown as { text: Text }).text.yText;
  const editor = new InlineEditor<Attrs>(yText);
  editor.setAttributeSchema(inlineManager().getSchema() as never);
  store.captureSync();
  return { store, spaceDoc: doc.spaceDoc, id, yText, editor };
}

const delta = (t: Y.Text) => t.toDelta() as Delta;

describe('mnSugg survives BlockSuite', () => {
  it('is in the paragraph schema, and a malformed value is dropped', () => {
    const schema = inlineManager().getSchema() as unknown as { parse: (v: unknown) => Attrs };
    expect(schema.parse({ mnSugg: SUGG }).mnSugg).toEqual(SUGG);
    expect(schema.parse({ mnSugg: AI_SUGG }).mnSugg).toEqual(AI_SUGG);
    expect(schema.parse({ mnSugg: { id: 1 } }).mnSugg).toBeUndefined();
  });

  it('keeps the mark on its run through a local insert next to it', () => {
    const { editor, yText } = page();
    editor.formatText({ index: 0, length: 5 }, { mnSugg: SUGG });
    editor.insertText({ index: 5, length: 0 }, 'x');
    expect(delta(yText)).toEqual([
      { insert: 'Hello', attributes: { mnSugg: SUGG } },
      { insert: 'x world' },
    ]);
  });

  it('is not stripped by the next local edit, and carries through an insert that asks for it', () => {
    const { editor, yText } = page();
    editor.formatText({ index: 0, length: 5 }, { mnSugg: SUGG });
    editor.formatText({ index: 0, length: 11 }, { bold: true });
    editor.insertText({ index: 11, length: 0 }, '!', { mnSugg: AI_SUGG });
    expect(delta(yText)).toEqual([
      { insert: 'Hello', attributes: { mnSugg: SUGG, bold: true } },
      { insert: ' world', attributes: { bold: true } },
      { insert: '!', attributes: { mnSugg: AI_SUGG } },
    ]);
  });

  it('comes off on undo and back on redo', () => {
    const { editor, yText, store } = page();
    editor.formatText({ index: 0, length: 5 }, { mnSugg: SUGG });
    store.captureSync();
    store.undo();
    expect(delta(yText)).toEqual([{ insert: 'Hello world' }]);
    store.redo();
    expect(delta(yText)[0]).toEqual({ insert: 'Hello', attributes: { mnSugg: SUGG } });
  });

  it('reaches another copy of the page through a Yjs update', () => {
    const { editor, spaceDoc, id } = page();
    editor.formatText({ index: 6, length: 5 }, { mnSugg: AI_SUGG });
    const other = new Y.Doc();
    Y.applyUpdate(other, Y.encodeStateAsUpdate(spaceDoc));
    const text = (other.getMap('blocks').get(id) as Y.Map<unknown>).get('prop:text') as Y.Text;
    expect(delta(text)).toEqual([{ insert: 'Hello ' }, { insert: 'world', attributes: { mnSugg: AI_SUGG } }]);
  });

  it('renders as <ins>/<del> with the suggestion id, around the run it marks', () => {
    const render = inlineManager().getRenderer();
    const out = (attributes: Record<string, unknown>) =>
      render({ delta: { insert: 'Hi', attributes }, selected: false, startOffset: 0, endOffset: 2, lineIndex: 0 } as never) as unknown as { strings: string[]; values: unknown[] };
    const ins = out({ mnSugg: SUGG, bold: true });
    expect(ins.strings.join('')).toContain('<ins class="mn-sugg-ins"');
    expect(ins.values).toContain('s1');
    expect(out({ mnSugg: AI_SUGG }).strings.join('')).toContain('<del class="mn-sugg-del"');
  });
});
