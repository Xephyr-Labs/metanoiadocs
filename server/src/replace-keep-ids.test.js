import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { buildDocState, docToMarkdown, replaceBodyKeepingIds } from './blocks.js';
import { applyChange, computeChanges } from './suggestions.js';
import { docFromState } from './board-decode.js';

const docOf = (title, md, resolve) => docFromState(buildDocState(title, md, resolve));
const replace = (doc, title, md, resolve) => doc.transact(() => replaceBodyKeepingIds(doc, title, md, resolve));

/** Top-level body ids with their text, in order. */
function body(doc) {
  const blocks = doc.getMap('blocks');
  const note = [...blocks.values()].find((b) => b.get('sys:flavour') === 'affine:note');
  return note.get('sys:children').toArray().map((id) => ({ id, text: String(blocks.get(id).get('prop:text') ?? '') }));
}

const paras = (xs) => xs.join('\n\n');
const SIX = ['one', 'two', 'three', 'four', 'five', 'six'];

test('changing one sentence changes one block and keeps every id', () => {
  const doc = docOf('T', paras(SIX));
  const before = body(doc);
  replace(doc, 'T', paras(SIX.map((s, i) => (i === 2 ? 'THREE edited' : s))));
  const after = body(doc);
  assert.deepEqual(after.map((b) => b.id), before.map((b) => b.id));
  after.forEach((b, i) => assert.equal(b.text, i === 2 ? 'THREE edited' : before[i].text));
});

test('inserting a paragraph adds exactly one new id', () => {
  const doc = docOf('T', paras(SIX));
  const before = body(doc).map((b) => b.id);
  replace(doc, 'T', paras([...SIX.slice(0, 3), 'new', ...SIX.slice(3)]));
  const after = body(doc);
  assert.equal(after.length, 7);
  assert.equal(after[3].text, 'new');
  assert.ok(!before.includes(after[3].id));
  assert.deepEqual(after.filter((_, i) => i !== 3).map((b) => b.id), before);
});

test('deleting a paragraph removes exactly that block', () => {
  const doc = docOf('T', paras(SIX));
  const before = body(doc).map((b) => b.id);
  replace(doc, 'T', paras(SIX.filter((_, i) => i !== 4)));
  assert.deepEqual(body(doc).map((b) => b.id), before.filter((_, i) => i !== 4));
  assert.equal(doc.getMap('blocks').has(before[4]), false);
});

test('moving a paragraph is one removal and one addition, others untouched', () => {
  const base = docOf('T', paras(SIX));
  const draft = new Y.Doc();
  Y.applyUpdate(draft, Y.encodeStateAsUpdate(base));
  const before = body(draft).map((b) => b.id);
  replace(draft, 'T', paras(['one', 'three', 'four', 'five', 'two', 'six']));
  const after = body(draft);
  assert.deepEqual(after.map((b) => b.text), ['one', 'three', 'four', 'five', 'two', 'six']);
  for (const i of [0, 1, 2, 3, 5]) assert.equal(after[i].id, before[SIX.indexOf(after[i].text)]);
  const kinds = computeChanges(base, draft, base).map((c) => c.kind).sort();
  assert.deepEqual(kinds, ['added', 'removed']);
});

test('two identical paragraphs: editing the second keeps the first', () => {
  const doc = docOf('T', paras(['same', 'same', 'end']));
  const before = body(doc);
  replace(doc, 'T', paras(['same', 'changed', 'end']));
  const after = body(doc);
  assert.deepEqual(after.map((b) => b.id), before.map((b) => b.id));
  assert.deepEqual(after.map((b) => b.text), ['same', 'changed', 'end']);
});

test('a list item edited in place keeps its id and its nested children', () => {
  const doc = docOf('T', '- parent\n  - child a\n  - child b\n- other');
  const blocks = doc.getMap('blocks');
  const [parent, other] = body(doc);
  const kids = blocks.get(parent.id).get('sys:children').toArray();
  replace(doc, 'T', '- parent edited\n  - child a\n  - child b\n- other');
  const after = body(doc);
  assert.deepEqual(after.map((b) => b.id), [parent.id, other.id]);
  assert.equal(after[0].text, 'parent edited');
  assert.deepEqual(blocks.get(parent.id).get('sys:children').toArray(), kids);
  assert.equal(docToMarkdown(Y.encodeStateAsUpdate(doc)).markdown, '- parent edited\n  - child a\n  - child b\n- other');
});

test('computeChanges(base, draft, base) after a one-sentence replace reports exactly one modified change', () => {
  const baseState = buildDocState('T', paras(SIX));
  const draft = docFromState(baseState);
  replace(draft, 'T', paras(SIX.map((s, i) => (i === 1 ? 'two, but edited' : s))));
  const changes = computeChanges(docFromState(baseState), draft, docFromState(baseState));
  assert.equal(changes.length, 1);
  assert.equal(changes[0].kind, 'modified');
  assert.equal(changes[0].before, 'two');
  assert.equal(changes[0].after, 'two, but edited');
});

test('the result has exactly one affine:page and the body note keeps its id', () => {
  const doc = docOf('T', paras(SIX));
  const blocks = doc.getMap('blocks');
  const noteId = [...blocks].find(([, b]) => b.get('sys:flavour') === 'affine:note')[0];
  replace(doc, 'T', '# Heading\n\n- a\n- b\n\n```js\nx\n```');
  const flavours = [...blocks.values()].map((b) => b.get('sys:flavour'));
  assert.equal(flavours.filter((f) => f === 'affine:page').length, 1);
  assert.equal(flavours.filter((f) => f === 'affine:note').length, 1);
  assert.ok(blocks.has(noteId));
  // Equal to what a fresh build renders, and nothing orphaned in the map.
  const fresh = docToMarkdown(buildDocState('T', '# Heading\n\n- a\n- b\n\n```js\nx\n```')).markdown;
  assert.equal(docToMarkdown(Y.encodeStateAsUpdate(doc)).markdown, fresh);
  assert.equal(blocks.size, 2 + 1 + 4); // page, surface, note + 4 blocks
  for (const [id, b] of blocks) assert.equal(b.get('sys:id'), id);
});

test('a page reference ([[id]]) in an unchanged paragraph is not reported as a change', () => {
  const resolve = (k) => (k === 'Other' ? 'page-other' : null);
  const baseState = buildDocState('T', paras(['see [[Other]] here', 'two', 'three']), resolve);
  const draft = docFromState(baseState);
  replace(draft, 'T', paras(['see [[Other]] here', 'two', 'three edited']), resolve);
  const changes = computeChanges(docFromState(baseState), draft, docFromState(baseState));
  assert.equal(changes.length, 1);
  assert.equal(changes[0].after, 'three edited');
});

const orders = (doc) => body(doc).map(({ id }) => doc.getMap('blocks').get(id).get('prop:order'));

test('inserting or deleting in a numbered list renumbers it, and only the item is a change', () => {
  for (const [to, kind] of [['1. a\n2. X\n3. b\n4. c', 'added'], ['1. a\n2. c', 'removed']]) {
    const baseState = buildDocState('T', '1. a\n2. b\n3. c');
    const draft = docFromState(baseState);
    replace(draft, 'T', to);
    assert.deepEqual(orders(draft), [1, 2, 3, 4].slice(0, body(draft).length));
    const changes = computeChanges(docFromState(baseState), draft, docFromState(baseState));
    assert.deepEqual(changes.map((c) => c.kind), [kind]);
    // Accepting it numbers the page the same way.
    const main = docFromState(baseState);
    main.transact(() => applyChange(main, draft, docFromState(baseState), changes[0]));
    assert.deepEqual(orders(main), orders(draft));
  }
});

test('editor state survives: a parent paired for its child, an image whose caption changed', () => {
  const base = docOf('T', '- p\n  - c1\n\n![cap](/api/blob/abc)\n\ntail');
  const bl = base.getMap('blocks');
  base.transact(() => {
    for (const [, b] of bl) {
      if (String(b.get('prop:text') ?? '') === 'p') { b.set('prop:collapsed', true); b.set('prop:textAlign', 'center'); }
      if (b.get('sys:flavour') === 'affine:image') { b.set('prop:width', 400); b.set('prop:height', 300); }
    }
  });
  const draft = new Y.Doc();
  Y.applyUpdate(draft, Y.encodeStateAsUpdate(base));
  replace(draft, 'T', '- p\n  - c1 edited\n\n![new cap](/api/blob/abc)\n\ntail');
  const blocks = [...draft.getMap('blocks').values()];
  const parent = blocks.find((b) => String(b.get('prop:text') ?? '') === 'p');
  const image = blocks.find((b) => b.get('sys:flavour') === 'affine:image');
  assert.equal(parent.get('prop:collapsed'), true);
  assert.equal(parent.get('prop:textAlign'), 'center');
  assert.deepEqual([image.get('prop:width'), image.get('prop:height'), image.get('prop:caption')], [400, 300, 'new cap']);
  const changes = computeChanges(base, draft, base).map((c) => `${c.kind}:${c.before}->${c.after}`);
  assert.deepEqual(changes, ['modified:c1->c1 edited', 'modified:cap->new cap']);
});

/** intro + a list that starts at 5 (as typing "5. " makes it) + tail. */
function fromFive() {
  const doc = docOf('T', 'intro\n\n1. e\n2. f\n3. g\n\ntail');
  doc.transact(() => body(doc).slice(1, 4).forEach(({ id }, i) => doc.getMap('blocks').get(id).set('prop:order', 5 + i)));
  return doc;
}
const listOrders = (doc) => orders(doc).filter((o) => o !== undefined);

test('a list started at 5 keeps its numbers through accepts and replaces', () => {
  const base = fromFive();
  const accept = (edit) => {
    const draft = new Y.Doc();
    Y.applyUpdate(draft, Y.encodeStateAsUpdate(base));
    draft.transact(() => edit(draft));
    const main = new Y.Doc();
    Y.applyUpdate(main, Y.encodeStateAsUpdate(base));
    main.transact(() => { for (const c of computeChanges(base, draft, base)) applyChange(main, draft, base, c); });
    return main;
  };
  const textOf = (d, i) => d.getMap('blocks').get(body(d)[i].id).get('prop:text');
  // A person edits only the paragraph: the list is not renumbered.
  assert.deepEqual(listOrders(accept((d) => textOf(d, 0).insert(5, ' edited'))), [5, 6, 7]);
  // A person deletes f / the AI inserts and deletes: the run still starts at 5.
  assert.deepEqual(listOrders(accept((d) => {
    const k = d.getMap('blocks').get(body(d)[2].id);
    const note = [...d.getMap('blocks').values()].find((b) => b.get('sys:flavour') === 'affine:note');
    note.get('sys:children').delete(2, 1); d.getMap('blocks').delete(k.get('sys:id'));
  })), [5, 6]);
  assert.deepEqual(listOrders(accept((d) => replaceBodyKeepingIds(d, 'T', 'intro\n\n1. e\n2. X\n3. f\n4. g\n\ntail'))), [5, 6, 7, 8]);
  assert.deepEqual(listOrders(accept((d) => replaceBodyKeepingIds(d, 'T', 'intro\n\n1. e\n2. g\n\ntail'))), [5, 6]);
  assert.deepEqual(listOrders(accept((d) => replaceBodyKeepingIds(d, 'T', 'intro2\n\n1. e\n2. f\n3. g\n\ntail'))), [5, 6, 7]);
});

test('a code block keeps its editor-only caption when its code is edited', () => {
  const doc = docOf('T', '```js\nx\n```');
  const code = [...doc.getMap('blocks').values()].find((b) => b.get('sys:flavour') === 'affine:code');
  doc.transact(() => code.set('prop:caption', 'my cap'));
  replace(doc, 'T', '```js\ny\n```');
  assert.equal(String(code.get('prop:text')), 'y');
  assert.equal(code.get('prop:caption'), 'my cap');
});
