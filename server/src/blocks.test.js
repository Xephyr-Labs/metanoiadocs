import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { appendMarkdownToDoc, appendPageReference, buildDocState, collectMarkdownLinks, docToMarkdown, extractText } from './blocks.js';

// The editor's own key generator, when the web app's dependencies are installed
// alongside — the real proof that a table built here takes new rows.
const fractional = await import('../../web-react/node_modules/fractional-indexing/src/index.js').catch(() => null);

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

test('a markdown image line becomes a real image block, and round-trips', () => {
  const key = 'a'.repeat(64);
  const md = ['Before.', '', `![press preview](/api/blob/${key})`, '', 'After.'].join('\n');

  const state = buildDocState('T', md);
  const doc = new Y.Doc();
  Y.applyUpdate(doc, new Uint8Array(state));
  const images = [...doc.getMap('blocks')]
    .map(([, b]) => b)
    .filter((b) => b instanceof Y.Map && b.get('sys:flavour') === 'affine:image');

  assert.equal(images.length, 1);
  assert.equal(images[0].get('prop:sourceId'), key);
  assert.equal(images[0].get('prop:caption'), 'press preview');
  assert.match(docToMarkdown(state).markdown, new RegExp(`!\\[press preview\\]\\(/api/blob/${key}\\)`));
});

test('an image whose source is not a stored blob stays literal text', () => {
  const state = buildDocState('T', '![x](/workspace/group/og.png)');
  const doc = new Y.Doc();
  Y.applyUpdate(doc, new Uint8Array(state));
  const flavours = [...doc.getMap('blocks')].map(([, b]) => b.get('sys:flavour'));
  assert.ok(!flavours.includes('affine:image'));
});

test('appendMarkdownToDoc edits the doc in place, so a live editor sees the blocks', () => {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, buildDocState('Notes', 'first line'));
  assert.equal(appendMarkdownToDoc(doc, '## Added\n\nsecond line'), true);
  const text = extractText(Y.encodeStateAsUpdate(doc)).text;
  assert.match(text, /first line/);
  assert.match(text, /second line/);
});

test('appendMarkdownToDoc reports a doc with no body instead of inventing one', () => {
  // Nobody has ever opened this page, so there is no note block to append into.
  // Only the caller can decide to write a whole body, so this must not guess.
  assert.equal(appendMarkdownToDoc(new Y.Doc(), 'orphan'), false);
});

test('> [!NOTE] becomes a note panel holding its lines, and exports back the same', () => {
  const md = [
    'Before.',
    '',
    '> [!NOTE]',
    '> The log lives here.',
    '> - first entry',
    '> - second entry',
    '',
    '> [!caution] Do not deploy on Fridays.',
    '',
    '> A plain quote.',
  ].join('\n');
  const state = buildDocState('T', md);
  const doc = new Y.Doc();
  Y.applyUpdate(doc, new Uint8Array(state));
  const blocks = doc.getMap('blocks');
  const callouts = [...blocks.values()].filter((b) => b.get('sys:flavour') === 'affine:callout');
  assert.deepEqual(callouts.map((b) => b.get('prop:mnPanel')), ['note', 'error']);
  const kids = callouts[0].get('sys:children').toArray().map((id) => blocks.get(id));
  assert.deepEqual(kids.map((b) => b.get('sys:flavour')), ['affine:paragraph', 'affine:list', 'affine:list']);
  assert.equal(kids[0].get('prop:text').toString(), 'The log lives here.');

  const { markdown } = docToMarkdown(state);
  assert.match(markdown, /^> \[!NOTE\]\n> The log lives here\.\n>\n> - first entry\n> - second entry$/m);
  assert.match(markdown, /^> \[!ERROR\]\n> Do not deploy on Fridays\.$/m);
  assert.match(markdown, /^> A plain quote\.$/m);
  // And the export imports as the same panels.
  assert.equal(docToMarkdown(buildDocState('T', markdown)).markdown, markdown);
  assert.match(extractText(state).text, /second entry/);
});

test('a panel quoted inside a panel keeps its lines', () => {
  const { markdown } = docToMarkdown(buildDocState('T', '> [!NOTE]\n> > [!WARNING]\n> > inner warning\n> after'));
  assert.match(markdown, /inner warning/);
  assert.match(markdown, /after/);
});

/** Every block's Y.Map in a built doc state, in document order of the map. */
function blocksIn(state) {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, new Uint8Array(state));
  return [...doc.getMap('blocks').values()].filter((b) => b instanceof Y.Map);
}

test('a run of > lines is one quote with its lines kept, and exports back the same', () => {
  const md = '> one\n> two\n> three\n\nAfter.';
  const state = buildDocState('T', md);
  const quotes = blocksIn(state).filter((b) => b.get('prop:type') === 'quote');
  assert.equal(quotes.length, 1);
  assert.equal(quotes[0].get('prop:text').toString(), 'one\ntwo\nthree');
  assert.equal(docToMarkdown(state).markdown, md);
});

test('a blank line between > runs keeps them two quotes', () => {
  const quotes = blocksIn(buildDocState('T', '> one\n\n> two')).filter((b) => b.get('prop:type') === 'quote');
  assert.equal(quotes.length, 2);
});

test('text colour, highlight and underline come in as the editor palette and go back out', () => {
  const md = 'A <span style="color: red">red</span> word, a <span style="color: blue; background: yellow">loud</span> one and an <u>underlined</u> one.';
  const state = buildDocState('T', md);
  const p = blocksIn(state).find((b) => String(b.get('prop:text') ?? '').startsWith('A red'));
  const marks = p.get('prop:text').toDelta().filter((d) => d.attributes).map((d) => d.attributes);
  assert.deepEqual(marks, [
    { color: 'var(--affine-text-highlight-foreground-red)' },
    { color: 'var(--affine-text-highlight-foreground-blue)', background: 'var(--affine-text-highlight-yellow)' },
    { underline: true },
  ]);
  assert.equal(docToMarkdown(state).markdown, md);
});

test('<mark> highlights yellow; a colour outside the palette is dropped, not stored', () => {
  const state = buildDocState('T', '<mark>hi</mark> and <span style="color: #ff0000">raw</span>');
  const p = blocksIn(state).find((b) => String(b.get('prop:text') ?? '').startsWith('hi'));
  const marks = p.get('prop:text').toDelta().map((d) => d.attributes ?? null);
  assert.deepEqual(marks, [{ background: 'var(--affine-text-highlight-yellow)' }, null]);
  assert.equal(p.get('prop:text').toString(), 'hi and raw');
});

test('<small> and <big> lines set the body text size and come back out', () => {
  const md = 'Body.\n\n<small>A footnote, with **bold**.</small>\n\n- <big>Large item</big>\n\n## <small>Heading stays a heading</small>';
  const state = buildDocState('T', md);
  const all = blocksIn(state);
  const by = (t) => all.find((b) => String(b.get('prop:text') ?? '').startsWith(t));
  assert.equal(by('A footnote').get('prop:mnSize'), 'small');
  assert.equal(by('Large item').get('prop:mnSize'), 'large');
  assert.equal(by('Body').get('prop:mnSize'), undefined);
  assert.equal(by('<small>Heading').get('prop:mnSize'), undefined);
  assert.equal(docToMarkdown(state).markdown, md);
});

test('two <small> runs on one line stay literal rather than leaving tags in the text', () => {
  const p = blocksIn(buildDocState('T', '<small>a</small> and <small>b</small>')).find((b) => String(b.get('prop:text') ?? '').includes('and'));
  assert.equal(p.get('prop:mnSize'), undefined);
  assert.equal(p.get('prop:text').toString(), '<small>a</small> and <small>b</small>');
});

test('a quote with every line in <small> is one small quote, and comes back as one', () => {
  const state = buildDocState('T', '> <small>a</small>\n> <small>b</small>');
  const q = blocksIn(state).find((b) => b.get('prop:type') === 'quote');
  assert.equal(q.get('prop:mnSize'), 'small');
  assert.equal(q.get('prop:text').toString(), 'a\nb');
  assert.equal(docToMarkdown(state).markdown, '> <small>a\n> b</small>');
});

/** A built table's row and column order keys, each list in stored order. */
function tableOrders(state) {
  const table = blocksIn(state).find((b) => b.get('sys:flavour') === 'affine:table');
  const pick = (re) => [...table.keys()].filter((k) => re.test(k)).map((k) => table.get(k));
  return { table, rows: pick(/^prop:rows\..+\.order$/), cols: pick(/^prop:columns\..+\.order$/) };
}

const twelveRows = ['| h |', '| --- |', ...Array.from({ length: 11 }, (_, i) => `| r${i} |`)].join('\n');

test('table order keys are ones the editor can insert beside', () => {
  const { rows } = tableOrders(buildDocState('T', twelveRows));
  assert.equal(rows.length, 12);
  // fractional-indexing's rule: integer part `a` + one digit, and the fraction
  // after it never ends in '0' (a000000 and a000010 used to).
  for (const k of rows) assert.match(k, /^a\d[0-9A-Za-z]*[1-9A-Za-z]$/);
});

test('the editor can add a row after, and between, built table rows', { skip: !fractional && 'web-react dependencies not installed' }, () => {
  const sorted = tableOrders(buildDocState('T', twelveRows)).rows.sort();
  for (let i = 0; i < sorted.length; i++) {
    const next = sorted[i + 1] ?? null;
    const k = fractional.generateKeyBetween(sorted[i], next);
    assert.ok(k > sorted[i] && (next === null || k < next));
  }
});

test('table rows export in the editor\'s code-point order, not locale order', () => {
  const state = buildDocState('T', '| a |\n| --- |\n| b |');
  const { table } = tableOrders(state);
  // Keys the editor itself would write: 'aZ' sorts before 'aa' by code point.
  const ids = [...table.keys()].filter((k) => /^prop:rows\..+\.order$/.test(k));
  const doc = table.doc;
  doc.transact(() => { table.set(ids[0], 'aa'); table.set(ids[1], 'aZ'); });
  const md = docToMarkdown(Y.encodeStateAsUpdate(doc)).markdown;
  assert.match(md, /^\| b \|\n\| --- \|\n\| a \|$/);
});

test('a pipe inside a table cell survives export and re-import', () => {
  const md = '| expr | means |\n| --- | --- |\n| a \\| b | either |';
  const out = docToMarkdown(buildDocState('T', md)).markdown;
  assert.equal(out, md);
  const cells = blocksIn(buildDocState('T', md))
    .find((b) => b.get('sys:flavour') === 'affine:table');
  const texts = [...cells.keys()].filter((k) => k.startsWith('prop:cells.')).map((k) => cells.get(k).toString());
  assert.ok(texts.includes('a | b'));
});

test('a plain callout round-trips as plain, keeping its emoji', () => {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, buildDocState('T', '> [!NOTE]\n> body'));
  const callout = [...doc.getMap('blocks').values()].find((b) => b.get('sys:flavour') === 'affine:callout');
  // What the editor leaves after "Neutral": no panel type, the reader's emoji.
  doc.transact(() => { callout.delete('prop:mnPanel'); callout.set('prop:emoji', '💡'); });
  const md = docToMarkdown(Y.encodeStateAsUpdate(doc)).markdown;
  assert.equal(md, '> [!CALLOUT 💡]\n> body');
  const back = blocksIn(buildDocState('T', md)).find((b) => b.get('sys:flavour') === 'affine:callout');
  assert.equal(back.get('prop:mnPanel'), undefined);
  assert.equal(back.get('prop:emoji'), '💡');
  assert.equal(docToMarkdown(buildDocState('T', md)).markdown, md);
});

/** A doc whose blocks map lists an edgeless-only note before the page's body note. */
function docWithCanvasNoteFirst() {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, buildDocState('T', 'body'));
  const blocks = doc.getMap('blocks');
  const entries = [...blocks.entries()];
  const body = entries.find(([, b]) => b.get('sys:flavour') === 'affine:note');
  const page = entries.find(([, b]) => b.get('sys:flavour') === 'affine:page')[1];
  const fresh = new Y.Doc();
  const into = fresh.getMap('blocks');
  fresh.transact(() => {
    const canvas = new Y.Map();
    canvas.set('sys:id', 'canvas-note');
    canvas.set('sys:flavour', 'affine:note');
    canvas.set('prop:displayMode', 'edgeless');
    canvas.set('sys:children', new Y.Array());
    into.set('canvas-note', canvas);
    for (const [id, b] of entries) into.set(id, b.clone());
  });
  into.get(entries.find(([, b]) => b === page)[0]).get('sys:children').push(['canvas-note']);
  return { doc: fresh, bodyId: body[0] };
}

test('appends land in the page-view note, not a canvas-only note listed first', () => {
  const a = docWithCanvasNoteFirst();
  assert.equal(a.doc.getMap('blocks').keys().next().value, 'canvas-note');
  assert.equal(appendMarkdownToDoc(a.doc, 'added'), true);
  assert.equal(a.doc.getMap('blocks').get('canvas-note').get('sys:children').length, 0);
  assert.match(docToMarkdown(Y.encodeStateAsUpdate(a.doc)).markdown, /body\n\nadded/);

  const r = docWithCanvasNoteFirst();
  assert.equal(appendPageReference(r.doc, 'id-arch'), true);
  assert.equal(r.doc.getMap('blocks').get('canvas-note').get('sys:children').length, 0);
  assert.equal(r.doc.getMap('blocks').get(r.bodyId).get('sys:children').length, 2);
});
