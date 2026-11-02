import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as Y from 'yjs';

import {
  SLIDE_W, SLIDE_H, addSlideToDoc, buildDeckState, buildDocState, extractText, keyAfter, keyBefore,
  listSlides, lossyBlocks, updateSlideInDoc, validOrderKey,
} from './blocks.js';

const fractional = await import('../../web-react/node_modules/fractional-indexing/src/index.js').catch(() => null);

const docOf = (state) => {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, new Uint8Array(state));
  return doc;
};
const byFlavour = (doc, fl) => [...doc.getMap('blocks').values()].filter((b) => b.get('sys:flavour') === fl);
const xywh = (b) => JSON.parse(b.get('prop:xywh'));

const deck = () => buildDeckState('Q3 review', '', [
  { title: 'Where we are', body: '- Revenue up **12%**\n  - mostly EU\n- Churn flat' },
  { title: 'Next', body: '1. Ship slides\n2. Measure' },
]);

test('a deck is frames on the surface, laid out and keyed the way addSlide() makes them', () => {
  const doc = docOf(deck());
  const blocks = doc.getMap('blocks');
  const [surface] = byFlavour(doc, 'affine:surface');
  const frames = byFlavour(doc, 'affine:frame');
  assert.equal(frames.length, 2);
  const onSurface = surface.get('sys:children').toArray();
  for (const f of frames) {
    assert.equal(f.get('sys:version'), 1);
    assert.ok(onSurface.includes(f.get('sys:id')), 'a frame is a child of the surface');
    assert.ok(f.get('prop:title') instanceof Y.Text);
    assert.deepEqual(f.get('prop:background').toJSON(), { light: '#ffffff', dark: '#252525' });
    assert.equal(f.get('prop:lockedBySelf'), false);
    assert.ok(validOrderKey(f.get('prop:index')));
    // generateKeyBetweenV2: integer key + '0' + 32 random chars.
    assert.match(f.get('prop:presentationIndex'), /^a[0-9A-Za-z]0[1-9A-Za-z]{32}$/);
    const [, , w, h] = xywh(f);
    assert.deepEqual([w, h], [SLIDE_W, SLIDE_H]);
  }
  const [a, b] = frames.sort((x, y) => (x.get('prop:presentationIndex') < y.get('prop:presentationIndex') ? -1 : 1));
  // First slide clear of the page note ([0,0,800,95]); the next 160 to its right.
  assert.deepEqual(xywh(a), [960, 0, 1600, 900]);
  assert.deepEqual(xywh(b), [960 + 1600 + 160, 0, 1600, 900]);
  // Under the note (a0), as generateIndex(true) puts a frame.
  assert.ok(a.get('prop:index') < 'a0');

  // The title box: an edgeless-text inside the frame, owned by it, holding an h1.
  const owned = [...a.get('prop:childElementIds').keys()].map((id) => blocks.get(id));
  assert.equal(owned.length, 2);
  for (const t of owned) {
    assert.equal(t.get('sys:flavour'), 'affine:edgeless-text');
    assert.equal(t.get('sys:version'), 1);
    assert.ok(onSurface.includes(t.get('sys:id')));
    assert.deepEqual(t.get('prop:color').toJSON(), { light: '#000000', dark: '#ffffff' });
    assert.equal(t.get('prop:fontFamily'), 'blocksuite:surface:Inter');
    assert.ok(t.get('prop:index') > 'a0', 'text sits above the note');
    const [x, y, w, h] = xywh(t);
    assert.ok(x >= 960 && y >= 0 && x + w <= 960 + 1600 && y + h <= 900, 'inside the slide');
  }
  const title = owned.find((t) => xywh(t)[1] === 110);
  assert.deepEqual(xywh(title), [1070, 110, 1380, 120]);
  assert.equal(title.get('prop:hasMaxWidth'), false);
  const h1 = blocks.get(title.get('sys:children').get(0));
  assert.equal(h1.get('prop:type'), 'h1');
  assert.equal(h1.get('prop:text').toString(), 'Where we are');
  assert.equal(a.get('prop:title').toString(), 'Where we are');
});

test('list_slides reads back what create_slides wrote, in order, body as markdown', () => {
  const slides = listSlides(deck());
  assert.deepEqual(slides.map(({ title, body }) => ({ title, body })), [
    { title: 'Where we are', body: '- Revenue up **12%**\n  - mostly EU\n- Churn flat' },
    { title: 'Next', body: '1. Ship slides\n1. Measure' },
  ]);
  assert.ok(slides.every((s) => typeof s.id === 'string'));
});

test('slide text is searchable and the page is flagged as canvas for markdown replace', () => {
  const state = deck();
  assert.match(extractText(state).text, /Revenue up 12%/);
  assert.match(extractText(state).text, /Where we are/);
  assert.deepEqual(lossyBlocks(state), ['canvas']);
});

test('add_slide appends after the last slide on a live doc; update_slide rewrites in place', () => {
  const doc = docOf(deck());
  const before = listSlides(Y.encodeStateAsUpdate(doc));
  const id = addSlideToDoc(doc, { title: 'Ask', body: 'One paragraph.' });
  const after = listSlides(Y.encodeStateAsUpdate(doc));
  assert.deepEqual(after.map((s) => s.id), [...before.map((s) => s.id), id]);
  assert.deepEqual(xywh(doc.getMap('blocks').get(id)), [960 + 2 * 1760, 0, 1600, 900]);

  assert.equal(updateSlideInDoc(doc, id, { title: 'The ask', body: '- one\n- two' }), true);
  const s = listSlides(Y.encodeStateAsUpdate(doc)).at(-1);
  assert.deepEqual({ title: s.title, body: s.body }, { title: 'The ask', body: '- one\n- two' });
  // The old body box is gone, not orphaned on the canvas.
  assert.equal(byFlavour(doc, 'affine:edgeless-text').length, 6);
  assert.equal(updateSlideInDoc(doc, 'nope', { title: 'x' }), false);
  // Title only keeps the body.
  updateSlideInDoc(doc, id, { title: 'Ask again' });
  assert.equal(listSlides(Y.encodeStateAsUpdate(doc)).at(-1).body, '- one\n- two');
});

test('an untitled slide is named past the highest Slide N, like the Slides button', () => {
  const doc = docOf(buildDocState('Empty', ''));
  addSlideToDoc(doc, {});
  addSlideToDoc(doc, {});
  assert.deepEqual(listSlides(Y.encodeStateAsUpdate(doc)).map((s) => s.title), ['Slide 1', 'Slide 2']);
});

test('a body keeps only what a text box can hold', () => {
  const doc = docOf(buildDeckState('D', '', [{ title: 'T', body: '> [!NOTE]\n> hi\n\n---\n\n| a | b |\n|---|---|\n| 1 | 2 |' }]));
  const flavours = new Set(byFlavour(doc, 'affine:edgeless-text')
    .flatMap((t) => t.get('sys:children').toArray())
    .map((id) => doc.getMap('blocks').get(id).get('sys:flavour')));
  assert.deepEqual([...flavours].sort(), ['affine:paragraph']);
});

test('keyAfter/keyBefore agree with fractional-indexing', { skip: !fractional && 'web-react dependencies not installed' }, () => {
  for (const k of ['a0', 'a9', 'az', 'Zz', 'b0zz', 'a0V', 'Zy', 'b00', 'Yzz']) {
    assert.equal(keyAfter(k), fractional.generateKeyBetween(k, null), `after ${k}`);
    assert.equal(keyBefore(k), fractional.generateKeyBetween(null, k), `before ${k}`);
  }
});
