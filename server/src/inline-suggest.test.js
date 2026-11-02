import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { buildDocState } from './blocks.js';
import { authorView, creditedSuggestions, decide, decideAll, listSuggestions, newSuggestionsBy, pendingText } from './inline-suggest.js';

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

/** The update `fn` makes to `doc`. */
function updateOf(doc, fn) {
  let u;
  const l = (x) => { u = x; };
  doc.on('update', l);
  doc.transact(fn);
  doc.off('update', l);
  return u;
}

test('newSuggestionsBy: new suggestions credited to their own author, with the text they add', () => {
  const { doc, blocks, ids } = mk('Hello world', 'Second');
  const t = text(blocks, ids[0]);
  t.insert(5, ' big', { mnSugg: S('old', 'ins', 'p1') });
  const known = new Set(listSuggestions(doc).map((c) => c.id));
  t.insert(0, 'Hey @sam ', { mnSugg: S('n1', 'ins', 'p1') });
  t.format(t.length - 5, 5, { mnSugg: S('n2', 'del', 'p1') });
  text(blocks, ids[1]).insert(0, 'X', { mnSugg: S('n3', 'ins', 'p2') });
  text(blocks, ids[1]).insert(0, 'AI', { mnSugg: { ...S('n4', 'ins', 'p1'), via: 'ai' } });
  text(blocks, ids[1]).insert(0, 'Y', { mnSugg: S('n5', 'ins', 'andy') });
  const credits = new Map([['old', 'p1'], ['n1', 'p1'], ['n2', 'p1'], ['n3', 'p2'], ['n4', 'p1'], ['n5', 'p1']]);
  const out = newSuggestionsBy(known, doc, credits);
  assert.deepEqual([...out.keys()].sort(), ['p1', 'p2']);
  assert.deepEqual(out.get('p1').ids, ['n1', 'n2'], 'not the old one, not Ask AI, not one credited to someone else');
  assert.match(out.get('p1').text, /@sam/);
  assert.deepEqual(out.get('p2').ids, ['n3']);
  assert.equal(newSuggestionsBy(null, doc, credits).size, 0, 'no baseline: nothing is new');
});

test('creditedSuggestions: only the ids a socket\'s own update writes with by = that user', () => {
  const { doc, blocks, ids } = mk('Hello world', 'Second');
  const t = text(blocks, ids[0]);
  // A writes a suggestion claiming to be B's (inline insert and a del format), while B is active.
  const fromA = updateOf(doc, () => {
    t.insert(0, 'Fake ', { mnSugg: S('a1', 'ins', 'B') });
    t.format(t.length - 5, 5, { mnSugg: S('a2', 'del', 'B') });
  });
  assert.deepEqual(creditedSuggestions(fromA, 'A'), []);
  // (The caller passes the sending socket's user, so B is never asked about A's update.)
  // B's own update is credited to B.
  const fromB = updateOf(doc, () => { text(blocks, ids[1]).insert(0, 'Real ', { mnSugg: S('b1', 'ins', 'B') }); });
  assert.deepEqual(creditedSuggestions(fromB, 'B'), ['b1']);
  // Block level: a prop:mnSugg set on an existing block, and on a new block.
  const blockA = updateOf(doc, () => { blocks.get(ids[0]).set('prop:mnSugg', S('k1', 'remove', 'B')); });
  assert.deepEqual(creditedSuggestions(blockA, 'A'), []);
  const blockB = updateOf(doc, () => {
    blocks.get(ids[1]).set('prop:mnSugg', S('k2', 'remove', 'B'));
    const nb = new Y.Map();
    blocks.set('nb', nb);
    nb.set('sys:flavour', 'affine:paragraph');
    nb.set('prop:mnSugg', S('k3', 'add', 'B'));
    const note = [...blocks.values()].find((b) => b.get('sys:children')?.toArray().includes(ids[1]));
    note.get('sys:children').push(['nb']);
  });
  assert.deepEqual(creditedSuggestions(blockB, 'B').sort(), ['k2', 'k3']);
  // End-to-end with the credits: A's spoof is never told as B; B's own is.
  const known = new Set();
  const credits = new Map([...creditedSuggestions(fromA, 'A'), ...creditedSuggestions(blockA, 'A')].map((id) => [id, 'A']));
  for (const id of [...creditedSuggestions(fromB, 'B'), ...creditedSuggestions(blockB, 'B')]) credits.set(id, 'B');
  const out = newSuggestionsBy(known, doc, credits);
  assert.deepEqual([...out.keys()], ['B']);
  assert.deepEqual(out.get('B').ids.sort(), ['b1', 'k2', 'k3']);
});

test('creditedSuggestions: the first update to mention an id decides it; a closing format item in B\'s update never claims A\'s spoof', () => {
  const { doc, blocks, ids } = mk('Hello world', 'Second');
  const t = text(blocks, ids[0]);
  const seen = new Set();
  const credits = new Map();
  const send = (user, fn) => { for (const id of creditedSuggestions(updateOf(doc, fn), user, seen)) credits.set(id, user); };
  const known = new Set(listSuggestions(doc).map((c) => c.id));
  // A writes a run claiming to be B's.
  send('A', () => { t.insert(5, ' spoof', { mnSugg: S('s1', 'ins', 'B') }); });
  // B types right after it (its update closes s1's run), then marks a del inside it.
  send('B', () => { t.insert(11, ' mine', { mnSugg: S('b1', 'ins', 'B') }); });
  send('B', () => { t.format(7, 2, { mnSugg: S('b2', 'del', 'B') }); });
  assert.ok(!credits.has('s1'), 's1 was claimed by A\'s update first');
  const out = newSuggestionsBy(known, doc, credits);
  assert.deepEqual([...out.keys()], ['B']);
  assert.deepEqual(out.get('B').ids.sort(), ['b1', 'b2'], 'B\'s genuine ones still notify; s1 never does');
});
