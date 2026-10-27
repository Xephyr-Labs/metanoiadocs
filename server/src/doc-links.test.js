import test from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { buildDocState, appendMarkdownToDoc, docToMarkdown, extractText, linkResolver, linkLabeler, pageLinksOf, lossyBlocks } from './blocks.js';

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
  // The unmatched one is literal text now, so it reads back escaped and stays literal.
  assert.equal(docToMarkdown(state, { resolveTitle: linkLabeler(DOCS), escape: true }).markdown, 'See [[Roadmap]] and \\[\\[Nope]].');
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
  const read = docToMarkdown(first, { resolveTitle: linkLabeler(DOCS), escape: true }).markdown;
  const second = buildDocState('T', read, linkResolver(DOCS));
  assert.deepEqual(refsIn(second), refsIn(first));
  assert.equal(docToMarkdown(second, { resolveTitle: linkLabeler(DOCS), escape: true }).markdown, read);
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
  const { markdown } = docToMarkdown(Y.encodeStateAsUpdate(doc), { resolveTitle: linkLabeler(DOCS), escape: true });
  assert.match(markdown, /\[\[Roadmap\]\]/);
});

test('pageLinksOf lists the pages a state references, deduped', () => {
  const state = buildDocState('T', '[[Roadmap]] [[Roadmap]] [[id-notes-a]]', linkResolver(DOCS));
  assert.deepEqual(pageLinksOf(state).sort(), ['id-notes-a', 'id-roadmap']);
});

const roundTrip = (state) => docToMarkdown(state, { resolveTitle: linkLabeler(DOCS), escape: true }).markdown;

test('text that only looks like markdown reads back as the same text', () => {
  // Typed in the editor as plain paragraphs, not as a list, a heading or a link.
  const doc = new Y.Doc();
  Y.applyUpdate(doc, new Uint8Array(buildDocState('T', 'x')));
  const blocks = doc.getMap('blocks');
  const para = [...blocks.values()].find((b) => b.get('sys:flavour') === 'affine:paragraph');
  const lines = ['- not a list', '# not a heading', '1. not numbered', 'literal [[Roadmap]] and *stars* and `ticks`', '> not a quote', '| not | a table |'];
  para.get('prop:text').insert(0, lines[0]);
  para.get('prop:text').delete(lines[0].length, 1);
  const note = [...blocks.values()].find((b) => b.get('sys:flavour') === 'affine:note');
  for (const [i, l] of lines.slice(1).entries()) {
    const p = new Y.Map();
    p.set('sys:id', `p${i}`); p.set('sys:flavour', 'affine:paragraph'); p.set('sys:children', new Y.Array());
    p.set('prop:type', 'text');
    const t = new Y.Text(); t.insert(0, l); p.set('prop:text', t);
    blocks.set(`p${i}`, p);
    note.get('sys:children').push([`p${i}`]);
  }
  const read = roundTrip(Y.encodeStateAsUpdate(doc));
  const again = buildDocState('T', read, linkResolver(DOCS));
  assert.deepEqual(refsIn(again), [], 'no link appears from literal brackets');
  const { text } = extractText(again);
  for (const l of lines) assert.ok(text.includes(l), `kept literally: ${l}\n${read}`);
  const flavours = [];
  const d2 = new Y.Doc(); Y.applyUpdate(d2, new Uint8Array(again));
  for (const [, b] of d2.getMap('blocks')) flavours.push(`${b.get('sys:flavour')}:${b.get('prop:type') ?? ''}`);
  assert.ok(!flavours.some((f) => /list|h1|quote|table/.test(f)), flavours.join(' '));
});

test('code keeps its characters exactly', () => {
  const md = '```javascript\nconst a = b * c; // [[Roadmap]] `x`\n```';
  assert.equal(roundTrip(buildDocState('T', md, linkResolver(DOCS))), md);
});

test('links to pages with awkward titles survive a round trip', () => {
  const docs = [...DOCS, { id: 'id-br', title: 'Q1 [draft]' }, { id: 'id-empty', title: '' }];
  const state = buildDocState('T', 'a [[id-br]] b [[id-empty]] c', linkResolver(docs));
  const read = docToMarkdown(state, { resolveTitle: linkLabeler(docs), escape: true }).markdown;
  assert.deepEqual(refsIn(buildDocState('T', read, linkResolver(docs))), ['id-br', 'id-empty'], read);
});

test('pageLinksOf finds references nested in database cells', () => {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, new Uint8Array(buildDocState('T', 'x')));
  const db = new Y.Map();
  db.set('sys:id', 'db'); db.set('sys:flavour', 'affine:database'); db.set('sys:children', new Y.Array());
  const cells = new Y.Map(); const row = new Y.Map(); const cell = new Y.Map();
  const t = new Y.Text(); t.insert(0, ' ', { reference: { type: 'LinkedPage', pageId: 'id-roadmap' } });
  cell.set('value', t); row.set('col', cell); cells.set('row', row); db.set('prop:cells', cells);
  doc.getMap('blocks').set('db', db);
  assert.deepEqual(pageLinksOf(Y.encodeStateAsUpdate(doc)), ['id-roadmap']);
});

test('lossyBlocks names what a markdown replace would destroy', () => {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, new Uint8Array(buildDocState('T', 'x\n\n$$\nE=mc^2\n$$')));
  assert.deepEqual(lossyBlocks(Y.encodeStateAsUpdate(doc)), []);
  const db = new Y.Map();
  db.set('sys:id', 'db'); db.set('sys:flavour', 'affine:database'); db.set('sys:children', new Y.Array());
  doc.getMap('blocks').set('db', db);
  assert.deepEqual(lossyBlocks(Y.encodeStateAsUpdate(doc)), ['database']);
});
