import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { buildDocState, collectMarkdownLinks, extractText } from './blocks.js';

/** Every `reference` attribute in a built doc state, in no particular order. */
function referencesIn(state) {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, new Uint8Array(state));
  const out = [];
  for (const [, block] of doc.getMap('blocks')) {
    if (!(block instanceof Y.Map)) continue;
    for (const key of block.keys()) {
      const value = block.get(key);
      if (!(value instanceof Y.Text)) continue;
      for (const d of value.toDelta()) {
        if (d.attributes?.reference) out.push(d.attributes.reference);
      }
    }
  }
  return out;
}

const IDS = { arch: 'id-arch', road: 'id-road' };
const resolve = (key) => IDS[key] ?? null;

test('[[key]] becomes a page reference in paragraphs, lists and table cells', () => {
  const md = [
    'See [[arch]] and [[road]].',
    '',
    '- a list item pointing at [[arch]]',
    '',
    '| a | b |',
    '| --- | --- |',
    '| [[road]] | plain |',
  ].join('\n');

  const refs = referencesIn(buildDocState('T', md, resolve));
  assert.equal(refs.length, 4);
  assert.ok(refs.every((r) => r.type === 'LinkedPage'));
  assert.deepEqual(
    refs.map((r) => r.pageId).sort(),
    ['id-arch', 'id-arch', 'id-road', 'id-road'],
  );
});

test('an unresolved key stays literal rather than vanishing', () => {
  const state = buildDocState('T', 'before [[nope]] after', resolve);
  assert.equal(referencesIn(state).length, 0);
  assert.match(extractText(state).text, /before \[\[nope\]\] after/);
});

test('without a resolver the markup is left completely alone', () => {
  const state = buildDocState('T', 'plain [[arch]] text');
  assert.equal(referencesIn(state).length, 0);
  assert.match(extractText(state).text, /plain \[\[arch\]\] text/);
});

test('collectMarkdownLinks dedupes and drops unresolved keys', () => {
  const found = collectMarkdownLinks('[[arch]] [[road]] [[arch]] [[nope]]', resolve);
  assert.deepEqual(found.sort(), ['id-arch', 'id-road']);
});
