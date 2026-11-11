import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { buildDeckState, buildDocState, docToMarkdown, listSlides, looseCanvasMarkdown, lossyBlocks } from './blocks.js';

test('a deck reads back through its slides, not the empty page', () => {
  const state = buildDeckState('Deck', '', [{ title: 'One', body: '- **75** automations' }], null);
  assert.equal(docToMarkdown(state).markdown, '');
  assert.deepEqual(lossyBlocks(state), ['canvas']);
  assert.deepEqual(listSlides(state).map((s) => [s.title, s.body]), [['One', '- **75** automations']]);
  assert.equal(looseCanvasMarkdown(state), '', 'slide text is not repeated as loose canvas text');
});

test('an edgeless-only note is canvas text', () => {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, buildDocState('Board', 'Only on the canvas', null));
  for (const [, b] of doc.getMap('blocks')) if (b.get('sys:flavour') === 'affine:note') b.set('prop:displayMode', 'edgeless');
  const state = Y.encodeStateAsUpdate(doc);
  assert.equal(docToMarkdown(state).markdown, '');
  assert.equal(looseCanvasMarkdown(state), 'Only on the canvas');
});
