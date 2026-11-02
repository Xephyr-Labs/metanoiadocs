import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { buildDocState } from './blocks.js';
import { authorView, decide, decideAll, listSuggestions, pendingText } from './inline-suggest.js';

const S = (id, kind, by = 'u1') => ({ id, kind, by, at: 1 });

/** Doc with paragraphs; returns [doc, texts]. */
function mk(...paras) {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, new Uint8Array(buildDocState('T', paras.join('\n\n'))));
  const blocks = doc.getMap('blocks');
  const ids = [...blocks.keys()].filter((k) => blocks.get(k).get('sys:flavour') === 'affine:paragraph');
  const root = [...blocks.values()].find((b) => b.get('sys:flavour') === 'affine:page');
  const order = [];
  const walk = (id) => { order.push(id); blocks.get(id).get('sys:children')?.forEach(walk); };
  root.get('sys:children').forEach(walk);
  return { doc, blocks, ids: order.filter((i) => ids.includes(i)) };
}
const text = (blocks, id) => blocks.get(id).get('prop:text');

/** "a" + ins "b" + "c" + del "d" */
function abcd() {
  const m = mk('acd');
  const t = text(m.blocks, m.ids[0]);
  t.delete(0, 3);
  t.insert(0, 'a', { mnSugg: null });
  t.insert(1, 'b', { mnSugg: S('s1', 'ins') });
  t.insert(2, 'c', { mnSugg: null });
  t.insert(3, 'd', { mnSugg: S('s2', 'del') });
  return { ...m, t };
}

test('pendingText and authorView', () => {
  const { t } = abcd();
  assert.equal(pendingText(t), 'acd');
  assert.equal(authorView(t, 'u1'), 'abc');
  assert.equal(authorView(t, 'u2'), 'acd');
});

test('del+ins with one id is one replace card', () => {
  const m = mk('x');
  const t = text(m.blocks, m.ids[0]);
  t.delete(0, t.length);
  t.insert(0, 'old', { mnSugg: S('r', 'del') });
  t.insert(3, 'new', { mnSugg: { ...S('r', 'ins'), via: 'ai' } });
  const cards = listSuggestions(m.doc);
  assert.equal(cards.length, 1);
  assert.deepEqual(cards.map(({ kind, before, after, via, blockId }) => ({ kind, before, after, via, blockId })),
    [{ kind: 'replace', before: 'old', after: 'new', via: 'ai', blockId: m.ids[0] }]);
});

test('inline accept/reject', () => {
  let m = abcd();
  assert.deepEqual(listSuggestions(m.doc).map((c) => c.kind), ['insert', 'delete']);
  assert.equal(decide(m.doc, 's1', 'accept'), true);
  assert.equal(decide(m.doc, 's2', 'accept'), true);
  assert.equal(m.t.toString(), 'abc');
  assert.equal(listSuggestions(m.doc).length, 0);
  assert.equal(decide(m.doc, 's1', 'accept'), false);
  m = abcd();
  decide(m.doc, 's1', 'reject');
  decide(m.doc, 's2', 'reject');
  assert.equal(m.t.toString(), 'acd');
  assert.equal(listSuggestions(m.doc).length, 0);
});

test('block add/remove/type', () => {
  const m = mk('one', 'two', 'three');
  const [a, b, c] = m.ids;
  m.blocks.get(a).set('prop:mnSugg', { ...S('add', 'add') });
  m.blocks.get(b).set('prop:mnSugg', { ...S('rem', 'remove') });
  m.blocks.get(c).set('prop:mnSugg', { ...S('typ', 'type'), from: { flavour: 'affine:paragraph', type: 'text' } });
  m.blocks.get(c).set('prop:type', 'h2');
  const cards = listSuggestions(m.doc);
  assert.deepEqual(cards.map((x) => [x.kind, x.before, x.after]),
    [['add', '', 'one'], ['remove', 'two', ''], ['type', 'text', 'h2']]);
  decide(m.doc, 'add', 'accept');
  assert.equal(m.blocks.get(a).get('prop:mnSugg'), undefined);
  decide(m.doc, 'rem', 'reject');
  assert.ok(m.blocks.has(b) && !m.blocks.get(b).get('prop:mnSugg'));
  decide(m.doc, 'typ', 'reject');
  assert.equal(m.blocks.get(c).get('prop:type'), 'text');

  const n = mk('one', 'two');
  n.blocks.get(n.ids[0]).set('prop:mnSugg', S('add', 'add'));
  n.blocks.get(n.ids[1]).set('prop:mnSugg', S('rem', 'remove'));
  decide(n.doc, 'add', 'reject');
  decide(n.doc, 'rem', 'accept');
  assert.ok(!n.blocks.has(n.ids[0]) && !n.blocks.has(n.ids[1]));
  const root = [...n.blocks.values()].find((x) => x.get('sys:flavour') === 'affine:page');
  const note = n.blocks.get(root.get('sys:children').get(0));
  assert.equal(note.get('sys:children').length, 0);
});

test('decideAll counts and leaves no mnSugg; filters by author', () => {
  const m = abcd();
  m.blocks.get(m.ids[0]).set('prop:mnSugg', S('add', 'add', 'u2'));
  assert.equal(decideAll(m.doc, 'accept', { by: 'u2' }), 1);
  assert.equal(listSuggestions(m.doc).length, 2);
  assert.equal(decideAll(m.doc, 'accept'), 2);
  assert.equal(JSON.stringify(m.doc.getMap('blocks').toJSON()).includes('mnSugg'), false);
  assert.equal(m.t.toString(), 'abc');
});
