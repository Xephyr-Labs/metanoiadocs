import test from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { buildDocState, appendMarkdownToDoc, docToMarkdown, linkResolver, linkLabeler, pageLinksOf } from './blocks.js';

const DOCS = [
  { id: 'id-roadmap', title: 'Roadmap' },
  { id: 'id-notes-a', title: 'Notes' },
  { id: 'id-notes-b', title: 'Notes' },
];

const refsIn = (state) => {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, new Uint8Array(state));
  const out = [];
  for (const [, b] of doc.getMap('blocks')) {
    const t = b.get('prop:text');
    if (!(t instanceof Y.Text)) continue;
    for (const op of t.toDelta()) if (op.attributes?.reference) out.push(op.attributes.reference.pageId);
  }
  return out;
};

test('[[Title]], [[id]] and [[id|Title]] resolve; ambiguous or unknown titles do not', () => {
  const resolve = linkResolver(DOCS);
  assert.equal(resolve('Roadmap'), 'id-roadmap');
  assert.equal(resolve('  roadmap '), 'id-roadmap', 'case and spacing are forgiven');
  assert.equal(resolve('id-notes-b'), 'id-notes-b');
  assert.equal(resolve('id-notes-a|Notes'), 'id-notes-a');
  assert.equal(resolve('Notes'), null, 'two docs share the title, so neither is guessed');
  assert.equal(resolve('Nope'), null);
});

test('labels read as the title, and carry the id only where the title alone is ambiguous', () => {
  const label = linkLabeler(DOCS);
  assert.equal(label('id-roadmap'), 'Roadmap');
  assert.equal(label('id-notes-a'), 'id-notes-a|Notes');
  assert.equal(label('id-gone'), 'id-gone', 'a page this reader cannot see keeps its link without leaking a title');
});

test('a write turns [[links]] into real page references', () => {
  const state = buildDocState('T', 'See [[Roadmap]] and [[Nope]].', linkResolver(DOCS));
  assert.deepEqual(refsIn(state), ['id-roadmap']);
  assert.match(docToMarkdown(state, { resolveTitle: linkLabeler(DOCS) }).markdown, /See \[\[Roadmap\]\] and \[\[Nope\]\]\./);
});

test('an append turns [[links]] into real page references too', () => {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, new Uint8Array(buildDocState('T', 'First.')));
  appendMarkdownToDoc(doc, '- owner of [[id-notes-b]]', linkResolver(DOCS));
  assert.deepEqual(refsIn(Y.encodeStateAsUpdate(doc)), ['id-notes-b']);
});

test('read then replace keeps every reference and the formatting around it', () => {
  const md = '## Plan\n\n**Bold** <span style="color: red">red</span> see [[Roadmap]]\n\n> [!NOTE]\n> ask [[id-notes-a|Notes]]';
  const first = buildDocState('T', md, linkResolver(DOCS));
  const read = docToMarkdown(first, { resolveTitle: linkLabeler(DOCS) }).markdown;
  const second = buildDocState('T', read, linkResolver(DOCS));
  assert.deepEqual(refsIn(second), refsIn(first));
  assert.equal(docToMarkdown(second, { resolveTitle: linkLabeler(DOCS) }).markdown, read);
});

test('a linked-doc card is read as its [[link]] instead of vanishing', () => {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, new Uint8Array(buildDocState('T', 'Above.')));
  const blocks = doc.getMap('blocks');
  const note = [...blocks.values()].find((b) => b.get('sys:flavour') === 'affine:note');
  const card = new Y.Map();
  card.set('sys:id', 'card1');
  card.set('sys:flavour', 'affine:embed-linked-doc');
  card.set('sys:children', new Y.Array());
  card.set('prop:pageId', 'id-roadmap');
  blocks.set('card1', card);
  note.get('sys:children').push(['card1']);
  const { markdown } = docToMarkdown(Y.encodeStateAsUpdate(doc), { resolveTitle: linkLabeler(DOCS) });
  assert.match(markdown, /\[\[Roadmap\]\]/);
});

test('pageLinksOf lists the pages a state references, deduped', () => {
  const state = buildDocState('T', '[[Roadmap]] [[Roadmap]] [[id-notes-a]]', linkResolver(DOCS));
  assert.deepEqual(pageLinksOf(state).sort(), ['id-notes-a', 'id-roadmap']);
});
