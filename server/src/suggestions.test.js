import test from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { buildDocState, extractText } from './blocks.js';
import { applyTextSuggestion, applyChange, computeChanges, docFromState, parseDraftName, draftName, syncText } from './suggestions.js';
import { findQuote } from './text-match.js';

const state = (doc) => Y.encodeStateAsUpdate(doc);
const textBlock = (doc, s) => {
  for (const [id, b] of doc.getMap('blocks')) {
    const t = b.get('prop:text');
    if (t instanceof Y.Text && t.toString() === s) return { id, block: b, text: t };
  }
  return null;
};
/** A page, a draft forked from it, and the live page — all sharing history. */
function fork(md) {
  const base = buildDocState('Plan', md);
  return { base, draft: docFromState(base), main: docFromState(base) };
}

test('findQuote matches across collapsed whitespace and maps back to raw offsets', () => {
  assert.deepEqual(findQuote('one  two three', 'two three'), { index: 5, length: 9 });
  assert.equal(findQuote('abc', 'zzz'), null);
  assert.deepEqual(findQuote('ab ab', 'ab', 1), { index: 3, length: 2 });
});

test('a suggestion card replaces exactly the quoted text', () => {
  const doc = docFromState(buildDocState('T', 'The quick brown fox.\n'));
  const { id } = textBlock(doc, 'The quick brown fox.');
  assert.equal(applyTextSuggestion(doc, id, 'quick  brown', 'slow red'), true);
  assert.ok(textBlock(doc, 'The slow red fox.'));
  assert.equal(applyTextSuggestion(doc, id, 'not there', 'x'), false);
});

test('draft edits show up as changes, the owner\'s own edits do not', () => {
  const { base, draft, main } = fork('First line.\n\nSecond line.\n\nThird line.\n');
  // Suggester rewrites the first line, deletes the third, adds a new one.
  textBlock(draft, 'First line.').text.insert(0, 'Brand new ');
  const third = textBlock(draft, 'Third line.');
  const blocks = draft.getMap('blocks');
  for (const [, b] of blocks) {
    const kids = b.get('sys:children');
    if (kids instanceof Y.Array && kids.toArray().includes(third.id)) {
      kids.delete(kids.toArray().indexOf(third.id), 1);
      const added = new Y.Map();
      added.set('sys:id', 'new-block');
      added.set('sys:flavour', 'affine:paragraph');
      added.set('sys:children', new Y.Array());
      const t = new Y.Text(); t.insert(0, 'Added by suggester.');
      added.set('prop:text', t);
      added.set('prop:type', 'text');
      blocks.set('new-block', added);
      kids.push(['new-block']);
    }
  }
  blocks.delete(third.id);
  // Meanwhile the owner edits the second line on the live page.
  textBlock(main, 'Second line.').text.insert(0, 'Owner: ');

  const changes = computeChanges(docFromState(base), draft, main);
  assert.deepEqual(changes.map((c) => c.kind).sort(), ['added', 'modified', 'removed']);
  const mod = changes.find((c) => c.kind === 'modified');
  assert.equal(mod.before, 'First line.');
  assert.equal(mod.after, 'Brand new First line.');
  assert.equal(mod.mainChanged, false);

  // Accept all of it onto the live page.
  const baseDoc = docFromState(base);
  for (const c of changes) assert.equal(applyChange(main, draft, baseDoc, c), true);
  const text = extractText(state(main)).text;
  assert.match(text, /Brand new First line\./);
  assert.match(text, /Owner: Second line\./); // the owner's edit survives
  assert.match(text, /Added by suggester\./);
  assert.doesNotMatch(text, /Third line/);
  // Nothing left to suggest once it's all on the page.
  assert.equal(computeChanges(baseDoc, draft, main).filter((c) => c.kind !== 'modified').length, 0);
});

test('a change the owner also made shows as overlapping', () => {
  const { base, draft, main } = fork('Shared line.\n');
  textBlock(draft, 'Shared line.').text.insert(0, 'Draft ');
  textBlock(main, 'Shared line.').text.insert(0, 'Live ');
  const [c] = computeChanges(docFromState(base), draft, main);
  assert.equal(c.mainChanged, true);
});

test('syncText edits only the differing middle and keeps formatting', () => {
  const d = new Y.Doc();
  const a = d.getText('a');
  const b = d.getText('b');
  a.insert(0, 'hello world');
  b.insert(0, 'hello brave world');
  b.format(0, 5, { bold: true });
  syncText(a, b);
  assert.deepEqual(a.toDelta(), b.toDelta());
});

test('draft names round-trip', () => {
  assert.deepEqual(parseDraftName(draftName('doc-1', 's-2')), { docId: 'doc-1', sid: 's-2' });
  assert.equal(parseDraftName('doc-1'), null);
});

test('a suggestion card changes the occurrence that was selected', () => {
  const doc = docFromState(buildDocState('T', 'the cat and the dog\n'));
  const { id } = textBlock(doc, 'the cat and the dog');
  assert.equal(applyTextSuggestion(doc, id, 'the', 'a', 1), true);
  assert.ok(textBlock(doc, 'the cat and a dog'));
});

test('accepting a removed block keeps the children the page still has', () => {
  const base = buildDocState('T', 'Parent line\n\nChild line\n');
  const draft = docFromState(base);
  const main = docFromState(base);
  // On the page, nest Child under Parent (as an editor might after the fork).
  const nest = (doc) => {
    const p = textBlock(doc, 'Parent line');
    const c = textBlock(doc, 'Child line');
    doc.transact(() => {
      for (const [, b] of doc.getMap('blocks')) {
        const kids = b.get('sys:children');
        if (kids instanceof Y.Array && kids.toArray().includes(c.id)) kids.delete(kids.toArray().indexOf(c.id), 1);
      }
      p.block.get('sys:children').push([c.id]);
    });
    return { p, c };
  };
  const { p } = nest(main);
  // The draft deletes Parent only.
  draft.transact(() => {
    const dp = textBlock(draft, 'Parent line');
    for (const [, b] of draft.getMap('blocks')) {
      const kids = b.get('sys:children');
      if (kids instanceof Y.Array && kids.toArray().includes(dp.id)) kids.delete(kids.toArray().indexOf(dp.id), 1);
    }
    draft.getMap('blocks').delete(dp.id);
  });
  const baseDoc = docFromState(base);
  const changes = computeChanges(baseDoc, draft, main);
  const removed = changes.find((c) => c.kind === 'removed' && c.id === p.id);
  assert.ok(removed);
  applyChange(main, draft, baseDoc, removed);
  const text = extractText(state(main)).text;
  assert.doesNotMatch(text, /Parent line/);
  assert.match(text, /Child line/);
});
