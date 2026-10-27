import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { buildDocState, docToMarkdown, replaceBodyKeepingIds } from './blocks.js';
import { computeChanges } from './suggestions.js';
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
