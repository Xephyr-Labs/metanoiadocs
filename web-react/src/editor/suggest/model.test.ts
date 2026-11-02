// The client side of server/src/inline-suggest.test.js: the same cases, run
// through a BlockSuite store (ruling R1 — two runtimes, one set of semantics).
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { Text } from '@blocksuite/affine/store';
import { TestWorkspace } from '@blocksuite/affine/store/test';
import { getTestStoreManager } from '@blocksuite/integration-test/store';
import { decide, decideAll, describeCard, listSuggestions, watchFlavours } from './model';

const S = (id: string, kind: string, by = 'u1') => ({ id, kind, by, at: 1 });

function workspace(id: string) {
  const ws = new TestWorkspace({ id });
  ws.storeExtensions = getTestStoreManager().get('store');
  ws.start();
  ws.meta.initialize();
  return ws;
}

/** A page with one paragraph per argument. */
function mk(...paras: string[]) {
  const doc = workspace('m').createDoc('d');
  const store = doc.getStore({ id: 'd' });
  store.load();
  const pageId = store.addBlock('affine:page', {});
  const noteId = store.addBlock('affine:note', {}, pageId);
  const ids = paras.map((p) => store.addBlock('affine:paragraph', { text: new Text(p) }, noteId));
  const yt = (id: string) => (store.getBlock(id)!.model as any).text.yText as Y.Text;
  const yb = (id: string) => (store.getBlock(id)!.model as any).yBlock as Y.Map<unknown>;
  return { doc, store, ids, noteId, yt, yb };
}

/** "a" + ins "b" + "c" + del "d" */
function abcd() {
  const m = mk('acd');
  const t = m.yt(m.ids[0]);
  t.delete(0, 3);
  t.insert(0, 'a', { mnSugg: null });
  t.insert(1, 'b', { mnSugg: S('s1', 'ins') });
  t.insert(2, 'c', { mnSugg: null });
  t.insert(3, 'd', { mnSugg: S('s2', 'del') });
  return { ...m, t };
}

describe('client suggestion model', () => {
  it('del+ins with one id is one replace card', () => {
    const m = mk('x');
    const t = m.yt(m.ids[0]);
    t.delete(0, t.length);
    t.insert(0, 'old', { mnSugg: S('r', 'del') });
    t.insert(3, 'new', { mnSugg: { ...S('r', 'ins'), via: 'ai' } });
    const cards = listSuggestions(m.store);
    expect(cards.map(({ kind, before, after, via, blockId }) => ({ kind, before, after, via, blockId })))
      .toEqual([{ kind: 'replace', before: 'old', after: 'new', via: 'ai', blockId: m.ids[0] }]);
  });

  it('inline accept/reject', () => {
    let m = abcd();
    expect(listSuggestions(m.store).map((c) => c.kind)).toEqual(['insert', 'delete']);
    expect(decide(m.store, 's1', 'accept')).toBe(true);
    expect(decide(m.store, 's2', 'accept')).toBe(true);
    expect(m.t.toString()).toBe('abc');
    expect(listSuggestions(m.store)).toHaveLength(0);
    expect(decide(m.store, 's1', 'accept')).toBe(false);
    m = abcd();
    decide(m.store, 's1', 'reject');
    decide(m.store, 's2', 'reject');
    expect(m.t.toString()).toBe('acd');
    expect(listSuggestions(m.store)).toHaveLength(0);
  });

  it('refuses a verdict that is neither accept nor reject', () => {
    const m = abcd();
    expect(() => decide(m.store, 's1', 'maybe' as never)).toThrow();
    expect(() => decideAll(m.store, 'nope' as never)).toThrow();
    expect(m.t.toString()).toBe('abcd');
    expect(listSuggestions(m.store)).toHaveLength(2);
  });

  it('block add/remove/type', () => {
    const m = mk('one', 'two', 'three');
    const [a, b, c] = m.ids;
    m.yb(a).set('prop:mnSugg', S('add', 'add'));
    m.yb(b).set('prop:mnSugg', S('rem', 'remove'));
    m.store.updateBlock(m.store.getBlock(c)!.model, { type: 'h2' } as never);
    m.yb(c).set('prop:mnSugg', { ...S('typ', 'type'), from: { flavour: 'affine:paragraph', type: 'text' } });
    const cards = listSuggestions(m.store);
    expect(cards.map((x) => [x.kind, x.before, x.after])).toEqual([['add', '', 'one'], ['remove', 'two', ''], ['type', 'text', 'h2']]);
    expect(cards.map(describeCard)).toEqual(['Add paragraph', 'Remove paragraph', 'Changed to Heading 2']);
    decide(m.store, 'add', 'accept');
    expect(m.yb(a).get('prop:mnSugg')).toBeUndefined();
    decide(m.store, 'rem', 'reject');
    expect(m.store.getBlock(b) && !m.yb(b).get('prop:mnSugg')).toBeTruthy();
    decide(m.store, 'typ', 'reject');
    expect((m.store.getBlock(c)!.model as any).props.type).toBe('text');
    expect(m.yb(c).get('prop:mnSugg')).toBeUndefined();

    const n = mk('one', 'two');
    n.yb(n.ids[0]).set('prop:mnSugg', S('add', 'add'));
    n.yb(n.ids[1]).set('prop:mnSugg', S('rem', 'remove'));
    decide(n.store, 'add', 'reject');
    decide(n.store, 'rem', 'accept');
    expect(n.store.getBlock(n.ids[0])).toBeFalsy();
    expect(n.store.getBlock(n.ids[1])).toBeFalsy();
    expect(n.store.getBlock(n.noteId)!.model.children).toHaveLength(0);
  });

  it('a block removed and one added under one id is one replace, decided as a unit (server R13)', () => {
    for (const verdict of ['accept', 'reject'] as const) {
      const m = mk('open task', 'open task', 'other');
      const [old, ticked] = m.ids;
      m.yb(old).set('prop:mnSugg', S('re', 'remove'));
      m.yb(ticked).set('prop:mnSugg', S('re', 'add'));
      const cards = listSuggestions(m.store);
      expect(cards.map((x) => [x.id, x.kind, x.before, x.after])).toEqual([['re', 'replace', 'open task', 'open task']]);
      expect(decide(m.store, 're', verdict)).toBe(true);
      expect(!!m.store.getBlock(old)).toBe(verdict === 'reject');
      expect(!!m.store.getBlock(ticked)).toBe(verdict === 'accept');
      expect(listSuggestions(m.store)).toEqual([]);
    }
  });

  it('runs a re-ticked pair both carry are listed once, from the replaced block (server R13)', () => {
    const m = mk('big open', 'big open');
    const [old, ticked] = m.ids;
    for (const id of m.ids) m.yt(id).format(0, 4, { mnSugg: S('u2-ins', 'ins', 'u2') });
    m.yb(old).set('prop:mnSugg', S('re', 'remove'));
    m.yb(ticked).set('prop:mnSugg', S('re', 'add'));
    const cards = listSuggestions(m.store);
    expect(cards.map((x) => [x.id, x.kind, x.after])).toEqual([['u2-ins', 'insert', 'big '], ['re', 'replace', 'big open']]);
    expect(cards[0].blockId).toBe(old);
    decide(m.store, 're', 'accept');
    expect(listSuggestions(m.store).map((x) => [x.id, x.after, x.blockId])).toEqual([['u2-ins', 'big ', ticked]]);
  });

  it('decideAll counts and leaves no mnSugg; filters by author', () => {
    const m = abcd();
    m.yb(m.ids[0]).set('prop:mnSugg', S('add', 'add', 'u2'));
    expect(decideAll(m.store, 'accept', { by: 'u2' })).toBe(1);
    expect(listSuggestions(m.store)).toHaveLength(2);
    expect(decideAll(m.store, 'accept')).toBe(2);
    expect(JSON.stringify(m.doc.spaceDoc.getMap('blocks').toJSON()).includes('mnSugg')).toBe(false);
    expect(m.t.toString()).toBe('abc');
  });

  it('describes a replace in the words of the card', () => {
    const m = mk('x');
    const t = m.yt(m.ids[0]);
    t.delete(0, t.length);
    t.insert(0, 'Due ', { mnSugg: null });
    t.insert(4, '20 October', { mnSugg: S('r', 'del') });
    t.insert(14, '27 October', { mnSugg: S('r', 'ins') });
    expect(listSuggestions(m.store).map(describeCard)).toEqual(['Replace "20 October" with "27 October"']);
  });

  it('A accepts while B types in the same block: both converge on both', () => {
    const a = abcd();
    const docB = workspace('b').createDoc('d');
    Y.applyUpdate(docB.spaceDoc, Y.encodeStateAsUpdate(a.doc.spaceDoc));
    const storeB = docB.getStore({ id: 'd' });
    storeB.load();
    const tb = (storeB.getBlock(a.ids[0])!.model as any).text as Text;

    const svA = Y.encodeStateVector(a.doc.spaceDoc);
    const svB = Y.encodeStateVector(docB.spaceDoc);
    decide(a.store, 's2', 'accept'); // drops "d"
    decide(a.store, 's1', 'accept'); // keeps "b"
    tb.insert('X', 1, { mnSugg: null }); // B types between "a" and "b"
    const fromA = Y.encodeStateAsUpdate(a.doc.spaceDoc, svA);
    const fromB = Y.encodeStateAsUpdate(docB.spaceDoc, svB);
    Y.applyUpdate(docB.spaceDoc, fromA);
    Y.applyUpdate(a.doc.spaceDoc, fromB);

    expect(a.t.toString()).toBe(tb.yText.toString());
    expect(a.t.toString()).toBe('aXbc');
    expect(listSuggestions(a.store)).toHaveLength(0);
    expect(listSuggestions(storeB)).toHaveLength(0);
  });
});

describe('type reject across flavours', () => {
  it('rewrites the block in place: same id, same Y.Text, other Y props kept, model rebuilt', () => {
    const m = mk('before', 'Item', 'after');
    const stop = watchFlavours(m.store);
    const id = m.ids[1];
    const yText = m.yt(id);
    m.store.updateBlock(m.store.getBlock(id)!.model, { type: 'h2' } as never);
    m.yb(id).set('prop:mnSize', 'small');
    m.yb(id).set('prop:mnSugg', { ...S('t', 'type'), from: { flavour: 'affine:list', type: 'bulleted' } });
    expect(decide(m.store, 't', 'reject')).toBe(true);
    const kids = m.store.getBlock(m.noteId)!.model.children as any[];
    expect(kids.map((k) => [k.id, k.flavour, k.props.type, k.text.toString()])).toEqual([
      [m.ids[0], 'affine:paragraph', 'text', 'before'], [id, 'affine:list', 'bulleted', 'Item'], [m.ids[2], 'affine:paragraph', 'text', 'after'],
    ]);
    expect((kids[1].text as Text).yText).toBe(yText);
    expect(m.yb(id).get('prop:mnSize')).toBe('small');
    expect(listSuggestions(m.store)).toHaveLength(0);
    m.store.undo(); // the undo rewrites the flavour back, and the model follows
    expect((m.store.getBlock(id)!.model as any).flavour).toBe('affine:paragraph');
    expect(listSuggestions(m.store).map((c) => c.id)).toEqual(['t']);
    stop();
  });

  it('A rejects the type change while B types in that block: both survive, both rebuild', () => {
    const a = mk('Item');
    const id = a.ids[0];
    a.store.updateBlock(a.store.getBlock(id)!.model, { type: 'h2' } as never);
    a.yb(id).set('prop:mnSugg', { ...S('t', 'type'), from: { flavour: 'affine:list', type: 'bulleted' } });
    const docB = workspace('b2').createDoc('d');
    Y.applyUpdate(docB.spaceDoc, Y.encodeStateAsUpdate(a.doc.spaceDoc));
    const storeB = docB.getStore({ id: 'd' });
    storeB.load();
    const stopA = watchFlavours(a.store);
    const stopB = watchFlavours(storeB as never);

    const svA = Y.encodeStateVector(a.doc.spaceDoc);
    const svB = Y.encodeStateVector(docB.spaceDoc);
    decide(a.store, 't', 'reject');
    ((storeB.getBlock(id)!.model as any).text as Text).insert('!', 4, { mnSugg: null });
    const fromA = Y.encodeStateAsUpdate(a.doc.spaceDoc, svA);
    const fromB = Y.encodeStateAsUpdate(docB.spaceDoc, svB);
    Y.applyUpdate(docB.spaceDoc, fromA);
    Y.applyUpdate(a.doc.spaceDoc, fromB);

    for (const st of [a.store, storeB as never]) {
      const mod = (st as typeof a.store).getBlock(id)!.model as any;
      expect([mod.flavour, mod.props.type, mod.text.toString()]).toEqual(['affine:list', 'bulleted', 'Item!']);
    }
    stopA(); stopB();
  });

  it('same flavour, no type before: the type prop goes, as on the server', () => {
    const m = mk('x');
    const id = m.ids[0];
    m.store.updateBlock(m.store.getBlock(id)!.model, { type: 'h2' } as never);
    m.yb(id).set('prop:mnSugg', { ...S('t', 'type'), from: { flavour: 'affine:paragraph' } });
    decide(m.store, 't', 'reject');
    expect(m.yb(id).has('prop:type')).toBe(false);
    expect(m.yb(id).get('prop:mnSugg')).toBeUndefined();
  });
});
