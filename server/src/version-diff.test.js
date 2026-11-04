import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { diffWords, diffBlocks, diffStates } from './version-diff.js';
import { buildDocState, extractBlocks } from './blocks.js';
import { suggestedState } from './suggest-fixture.js';

const p = (id, text, extra = {}) => ({ id, flavour: 'affine:paragraph', type: 'text', checked: false, text, ...extra });
const img = (id, sig) => ({ id, flavour: 'affine:image', type: null, checked: false, text: '', sig });
const ops = (r) => r.blocks.map((b) => b.op);
/** The words of a diff, joined back up per side — what each version read. */
const sides = (words) => ({
  before: words.filter((w) => w.op !== 'ins').map((w) => w.text).join(''),
  after: words.filter((w) => w.op !== 'del').map((w) => w.text).join(''),
});

// ── words ────────────────────────────────────────────────────────────────────

test('diffWords: an insertion is one ins run between equal runs', () => {
  const w = diffWords('the quick fox', 'the quick brown fox');
  assert.deepEqual(w, [
    { op: 'eq', text: 'the quick ' },
    { op: 'ins', text: 'brown ' },
    { op: 'eq', text: 'fox' },
  ]);
});

test('diffWords: a deletion', () => {
  assert.deepEqual(diffWords('a b c', 'a c'), [
    { op: 'eq', text: 'a ' },
    { op: 'del', text: 'b ' },
    { op: 'eq', text: 'c' },
  ]);
});

test('diffWords: a replaced word reads as del then ins', () => {
  assert.deepEqual(diffWords('ship it Monday', 'ship it Friday'), [
    { op: 'eq', text: 'ship it ' },
    { op: 'del', text: 'Monday' },
    { op: 'ins', text: 'Friday' },
  ]);
});

test('diffWords: both sides rebuild exactly, punctuation and Unicode included', () => {
  const a = 'Hello, world! আমি ভাত খাই। done.';
  const b = 'Hello world!! আমি রুটি খাই। done…';
  assert.deepEqual(sides(diffWords(a, b)), { before: a, after: b });
});

test('diffWords: empty sides', () => {
  assert.deepEqual(diffWords('', ''), []);
  assert.deepEqual(diffWords('', 'new'), [{ op: 'ins', text: 'new' }]);
  assert.deepEqual(diffWords('old', ''), [{ op: 'del', text: 'old' }]);
});

test('diffWords: a long rewrite still rebuilds both sides', () => {
  const a = Array.from({ length: 3000 }, (_, i) => `w${i}`).join(' ');
  const b = Array.from({ length: 3000 }, (_, i) => `v${i}`).join(' ');
  assert.deepEqual(sides(diffWords(a, b)), { before: a, after: b });
});

// ── blocks ───────────────────────────────────────────────────────────────────

test('diffBlocks: identical pages are all same, no changes counted', () => {
  const r = diffBlocks([p('a', 'one'), p('b', 'two')], [p('a', 'one'), p('b', 'two')]);
  assert.deepEqual(ops(r), ['same', 'same']);
  assert.deepEqual(r.stats, { added: 0, removed: 0, changed: 0, moved: 0 });
});

test('diffBlocks: an inserted block is added in place', () => {
  const r = diffBlocks([p('a', 'one'), p('c', 'three')], [p('a', 'one'), p('b', 'two'), p('c', 'three')]);
  assert.deepEqual(ops(r), ['same', 'added', 'same']);
  assert.equal(r.blocks[1].text, 'two');
  assert.equal(r.stats.added, 1);
});

test('diffBlocks: a deleted block is removed in place', () => {
  const r = diffBlocks([p('a', 'one'), p('b', 'two'), p('c', 'three')], [p('a', 'one'), p('c', 'three')]);
  assert.deepEqual(ops(r), ['same', 'removed', 'same']);
  assert.equal(r.stats.removed, 1);
});

test('diffBlocks: an edited block (same id) is changed, with its word diff', () => {
  const r = diffBlocks([p('a', 'ship it Monday')], [p('a', 'ship it Friday')]);
  assert.deepEqual(ops(r), ['changed']);
  assert.deepEqual(sides(r.blocks[0].words), { before: 'ship it Monday', after: 'ship it Friday' });
  assert.equal(r.stats.changed, 1);
});

test('diffBlocks: a retyped block is changed and says what it was', () => {
  const r = diffBlocks([p('a', 'Title')], [p('a', 'Title', { type: 'h1' })]);
  assert.deepEqual(ops(r), ['changed']);
  assert.deepEqual(r.blocks[0].was, { flavour: 'affine:paragraph', type: 'text', checked: false });
  assert.ok(r.blocks[0].words.every((w) => w.op === 'eq'));
});

test('diffBlocks: a ticked todo is changed', () => {
  const todo = (checked) => ({ id: 't', flavour: 'affine:list', type: 'todo', checked, text: 'pay' });
  assert.deepEqual(ops(diffBlocks([todo(false)], [todo(true)])), ['changed']);
});

test('diffBlocks: new ids for similar text (a rebuilt page) pair up as changed', () => {
  const r = diffBlocks(
    [p('a', 'The launch is planned for Monday morning'), p('b', 'Unrelated')],
    [p('x', 'The launch is planned for Friday morning'), p('b', 'Unrelated')],
  );
  assert.deepEqual(ops(r), ['changed', 'same']);
  assert.deepEqual(sides(r.blocks[0].words), {
    before: 'The launch is planned for Monday morning',
    after: 'The launch is planned for Friday morning',
  });
});

test('diffBlocks: new ids for different text stay a removal and an addition', () => {
  const r = diffBlocks([p('a', 'apples and pears')], [p('x', 'quarterly revenue report')]);
  assert.deepEqual(ops(r).sort(), ['added', 'removed']);
});

test('diffBlocks: an id reused for other text gives way to a block that reads exactly the same', () => {
  // A markdown replace edits blocks in place by position: the old "Tail" id
  // now holds the new paragraph, and "Tail" itself came back under a new id.
  const r = diffBlocks(
    [p('i', 'Intro'), p('d', 'This line will be deleted.'), p('x', 'Tail paragraph.')],
    [p('i', 'Intro'), p('x', 'A brand new paragraph.'), p('y', 'Tail paragraph.')],
  );
  assert.deepEqual(r.blocks.map((b) => [b.op, b.text]), [
    ['same', 'Intro'],
    ['removed', 'This line will be deleted.'],
    ['added', 'A brand new paragraph.'],
    ['same', 'Tail paragraph.'],
  ]);
});

test('diffBlocks: the same, from the other side — a deleted block whose id the next one took', () => {
  const r = diffBlocks(
    [p('a', 'Alpha'), p('b', 'Bravo is going'), p('c', 'Charlie stays')],
    [p('a', 'Alpha'), p('b', 'Charlie stays')],
  );
  assert.deepEqual(r.blocks.map((b) => [b.op, b.text]), [['same', 'Alpha'], ['removed', 'Bravo is going'], ['same', 'Charlie stays']]);
});

test('diffBlocks: punctuation alone does not make two paragraphs alike', () => {
  const r = diffBlocks([p('a', 'Tail paragraph.')], [p('x', 'A brand new paragraph.')]);
  assert.deepEqual(ops(r), ['removed', 'added']);
});

test('diffBlocks: a moved block shows once, at its new place, as moved', () => {
  const r = diffBlocks(
    [p('a', 'one'), p('b', 'two'), p('c', 'three'), p('d', 'four')],
    [p('b', 'two'), p('c', 'three'), p('a', 'one'), p('d', 'four')],
  );
  assert.deepEqual(ops(r), ['same', 'same', 'moved', 'same']);
  assert.equal(r.blocks[2].text, 'one');
  assert.deepEqual(r.stats, { added: 0, removed: 0, changed: 0, moved: 1 });
});

test('diffBlocks: a block moved and edited carries its word diff', () => {
  const r = diffBlocks([p('a', 'one fish'), p('b', 'two'), p('c', 'three')], [p('b', 'two'), p('c', 'three'), p('a', 'one red fish')]);
  assert.deepEqual(ops(r), ['same', 'same', 'moved']);
  assert.deepEqual(sides(r.blocks[2].words), { before: 'one fish', after: 'one red fish' });
});

test('diffBlocks: an image is one block — added, removed, changed — never a word diff', () => {
  const r = diffBlocks([img('i1', 'src-a'), p('x', 'between'), img('i2', 'src-b')], [img('i1', 'src-z'), img('i3', 'src-c'), p('x', 'between')]);
  assert.deepEqual(ops(r), ['changed', 'added', 'same', 'removed']);
  assert.equal(r.blocks[0].label, 'Image');
  assert.equal(r.blocks[0].words, undefined);
});

test('diffBlocks: a table rebuilt under a new id where the old one stood reads as changed', () => {
  const tbl = (id, sig) => ({ ...img(id, sig), flavour: 'affine:table' });
  const r = diffBlocks([p('a', 'Intro'), tbl('t1', 'cells-1')], [p('a', 'Intro'), tbl('t2', 'cells-2')]);
  assert.deepEqual(ops(r), ['same', 'changed']);
  assert.equal(r.blocks[1].label, 'Table');
});

test('diffBlocks: an image never pairs with a paragraph by similarity', () => {
  const r = diffBlocks([img('i1', 's')], [p('x', '')]);
  assert.deepEqual(ops(r).sort(), ['added', 'removed']);
});

test('diffBlocks: empty docs', () => {
  assert.deepEqual(ops(diffBlocks([], [])), []);
  assert.deepEqual(ops(diffBlocks([], [p('a', 'x')])), ['added']);
  assert.deepEqual(ops(diffBlocks([p('a', 'x')], [])), ['removed']);
});

test('diffBlocks: a 2,000-block page diffs well under a second', () => {
  const words = (i) => `Paragraph ${i} talks about the quarterly plan for team ${i % 17} and its many goals`;
  const before = Array.from({ length: 2000 }, (_, i) => p(`b${i}`, words(i)));
  const after = before.map((b, i) => (i % 10 === 0 ? { ...b, text: b.text + ' and one more' } : b));
  after.splice(500, 50); // a run deleted
  after.splice(1200, 0, ...Array.from({ length: 40 }, (_, i) => p(`n${i}`, `brand new ${i}`)));
  const [moved] = after.splice(100, 1); after.push(moved);
  const t0 = performance.now();
  const r = diffBlocks(before, after);
  const ms = performance.now() - t0;
  assert.ok(ms < 300, `took ${ms.toFixed(0)}ms`);
  assert.equal(r.stats.removed, 50);
  assert.equal(r.stats.added, 40);
  assert.equal(r.stats.moved, 1);
});

test('diffBlocks: a whole 2,000-block rewrite under new ids is still fast', () => {
  const before = Array.from({ length: 2000 }, (_, i) => p(`b${i}`, `old line ${i} with some words in it`));
  const after = Array.from({ length: 2000 }, (_, i) => p(`n${i}`, `new line ${i} with other words`));
  const t0 = performance.now();
  diffBlocks(before, after);
  assert.ok(performance.now() - t0 < 1000);
});

// ── states ───────────────────────────────────────────────────────────────────

test('extractBlocks all: ids on every block, non-text blocks kept with a signature', () => {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, buildDocState('T', 'hello\n\n![pic](/api/blob/abc)\n\n---'));
  const { blocks } = extractBlocks(Y.encodeStateAsUpdate(doc), { all: true });
  assert.ok(blocks.every((b) => typeof b.id === 'string'));
  const flavours = blocks.map((b) => b.flavour);
  assert.deepEqual(flavours, ['affine:paragraph', 'affine:image', 'affine:divider']);
  assert.ok(blocks[1].sig.includes('abc'));
  // The default read is unchanged: text blocks only.
  assert.ok(extractBlocks(Y.encodeStateAsUpdate(doc)).blocks.every((b) => !b.sig));
});

test('diffStates: an edit between two saves of the same doc keeps ids and diffs words', () => {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, buildDocState('Plan', 'first line\n\nsecond line'));
  const before = Y.encodeStateAsUpdate(doc);
  const para = [...doc.getMap('blocks').values()].find((b) => b.get('prop:text')?.toString() === 'second line');
  para.get('prop:text').insert(7, 'and better ');
  doc.getMap('blocks').forEach((b) => { if (b.get('sys:flavour') === 'affine:page') { b.get('prop:title').insert(4, ' B'); } });
  const r = diffStates(before, Y.encodeStateAsUpdate(doc));
  assert.deepEqual(ops(r), ['same', 'changed']);
  assert.deepEqual(sides(r.blocks[1].words), { before: 'second line', after: 'second and better line' });
  assert.deepEqual(sides(r.title), { before: 'Plan', after: 'Plan B' });
});

test('diffStates: no previous version means everything is added', () => {
  const r = diffStates(null, buildDocState('T', 'a\n\nb'));
  assert.deepEqual(ops(r), ['added', 'added']);
});

test('diffStates: pending suggestions read as not accepted on both sides', () => {
  const r = diffStates(suggestedState(), suggestedState());
  assert.ok(ops(r).every((o) => o === 'same'));
  assert.deepEqual(r.blocks.map((b) => b.text), ['keep OLD', 'REMOVED', 'Retyped']);
});

test('diffStates: a 2,000-paragraph page, decoded both sides, diffs well under a second', () => {
  const md = Array.from({ length: 2000 }, (_, i) => `Paragraph ${i} about the plan for team ${i % 17}`).join('\n\n');
  const doc = new Y.Doc();
  Y.applyUpdate(doc, buildDocState('Big', md));
  const before = Y.encodeStateAsUpdate(doc);
  let n = 0;
  doc.getMap('blocks').forEach((b) => { const t = b.get('prop:text'); if (t && n++ % 25 === 0) t.insert(0, 'Edited: '); });
  const after = Y.encodeStateAsUpdate(doc);
  const t0 = performance.now();
  const r = diffStates(before, after);
  const ms = performance.now() - t0;
  assert.ok(ms < 1000, `took ${ms.toFixed(0)}ms`);
  assert.equal(r.stats.changed, 80);
  assert.equal(r.blocks.length, 2000);
});
