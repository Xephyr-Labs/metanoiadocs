import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { AnchorError, appendMarkdownToDoc, blockAfter, buildDocState, docToMarkdown } from './blocks.js';
import { suggestMarkdown } from './suggest-writer.js';

const docOf = (md) => {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, buildDocState('Terms', md, null));
  return doc;
};
const md = (doc) => docToMarkdown(Y.encodeStateAsUpdate(doc)).markdown;
const PAGE = '## 7. Payments\n\nThe Student pays Lattu AI.\n\n- held until released\n- then paid out\n\nDisputes go to support.';

test('a heading lands mid-page after the quoted passage, every other block kept', () => {
  const doc = docOf(PAGE);
  const ids = [...doc.getMap('blocks').keys()];
  appendMarkdownToDoc(doc, '## 7A. Disputes and refunds', null, blockAfter(doc.getMap('blocks'), 'then paid out'));
  assert.equal(md(doc), '## 7. Payments\n\nThe Student pays Lattu AI.\n\n- held until released\n- then paid out\n\n## 7A. Disputes and refunds\n\nDisputes go to support.');
  for (const id of ids) assert.ok(doc.getMap('blocks').has(id), 'existing blocks keep their ids, so comments stay anchored');
});

test('the anchor folds whitespace and quote style, and must match one block', () => {
  const doc = docOf('He said “yes”  today.\n\nSame line.\n\nSame line again.');
  assert.ok(blockAfter(doc.getMap('blocks'), 'said "yes" today'));
  assert.throws(() => blockAfter(doc.getMap('blocks'), 'Same line'), (e) => e instanceof AnchorError && /matches 2 blocks/.test(e.message));
  assert.throws(() => blockAfter(doc.getMap('blocks'), 'nowhere'), (e) => e instanceof AnchorError && /not on the page/.test(e.message));
});

test('a reviewed writer suggests the new heading in place', () => {
  const doc = docOf(PAGE);
  const out = suggestMarkdown({ doc, markdown: '## 7A. Disputes and refunds', mode: 'append', after: 'The Student pays Lattu AI.', by: 'andy' });
  assert.equal(out.fresh.length, 1);
  const text = docToMarkdown(Y.encodeStateAsUpdate(doc), { withPendingFor: 'andy' }).markdown;
  assert.ok(text.indexOf('7A. Disputes') > text.indexOf('The Student pays') && text.indexOf('7A. Disputes') < text.indexOf('held until'), text);
});
