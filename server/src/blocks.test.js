import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { buildDocState, collectMarkdownLinks, docToMarkdown, extractText } from './blocks.js';

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

test('markdown survives a round trip through the block state', () => {
  const md = [
    '## Heading',
    '',
    'A paragraph.',
    '',
    '- first',
    '  - nested',
    '- second',
    '',
    '1. one',
    '2. two',
    '',
    '- [x] done',
    '- [ ] not done',
    '',
    '> quoted line',
    '',
    '```js',
    'const a = 1;',
    '```',
    '',
    '| a | b |',
    '| --- | --- |',
    '| 1 | 2 |',
    '',
    '---',
  ].join('\n');

  const { title, markdown } = docToMarkdown(buildDocState('T', md));
  assert.equal(title, 'T');
  // Numbered items re-emit as `1.` — markdown renderers number them anyway.
  assert.equal(markdown, md.replace('2. two', '1. two'));
});

test('a built doc carries an edgeless surface, or the whiteboard renders blank', () => {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, new Uint8Array(buildDocState('T', 'hello')));
  const blocks = doc.getMap('blocks');
  const page = [...blocks.values()].find((b) => b.get('sys:flavour') === 'affine:page');
  const kids = page.get('sys:children').toArray().map((id) => blocks.get(id).get('sys:flavour'));
  assert.deepEqual(kids, ['affine:surface', 'affine:note']);

  const surface = [...blocks.values()].find((b) => b.get('sys:flavour') === 'affine:surface');
  const elements = surface.get('prop:elements');
  assert.equal(elements.get('type'), '$blocksuite:internal:native$');
  assert.ok(elements.get('value') instanceof Y.Map);
});

test('a hard-wrapped paragraph imports as one paragraph, not one per line', () => {
  const md = [
    'A paragraph that someone',
    'wrapped at eighty columns.',
    '',
    'A second paragraph.',
    '',
    '- a list item that also',
    '  runs onto a second line',
  ].join('\n');

  assert.equal(
    docToMarkdown(buildDocState('T', md)).markdown,
    [
      'A paragraph that someone wrapped at eighty columns.',
      '',
      'A second paragraph.',
      '',
      '- a list item that also runs onto a second line',
    ].join('\n'),
  );
});

test('nested list items become real children, not flattened siblings', () => {
  const state = buildDocState('T', ['- parent', '  - child', '    - grandchild'].join('\n'));
  assert.equal(docToMarkdown(state).markdown, ['- parent', '  - child', '    - grandchild'].join('\n'));
});

test('inline marks survive import and come back out as markdown', () => {
  const md = 'A **bold** and *italic* and `code` and ~~gone~~ and [a link](https://example.com).';
  assert.equal(docToMarkdown(buildDocState('T', md)).markdown, md);
});

test('code blocks and snake_case are left alone', () => {
  const md = ['```js', 'const a = b ** 2; // **not bold**', '```', '', 'degree_type and __really bold__'].join('\n');
  assert.equal(docToMarkdown(buildDocState('T', md)).markdown, md.replace('__really bold__', '**really bold**'));
});

test('a page reference exports as [[Title]] only when the title resolves', () => {
  const state = buildDocState('T', 'see [[arch]] here', resolve);
  assert.equal(
    docToMarkdown(state, { resolveTitle: (id) => (id === 'id-arch' ? 'Architecture' : null) }).markdown,
    'see [[Architecture]] here',
  );
  assert.equal(docToMarkdown(state).markdown, 'see  here');
});

test('collectMarkdownLinks dedupes and drops unresolved keys', () => {
  const found = collectMarkdownLinks('[[arch]] [[road]] [[arch]] [[nope]]', resolve);
  assert.deepEqual(found.sort(), ['id-arch', 'id-road']);
});
