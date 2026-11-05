import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chunkText, rrf, retryDelayMs, wantsMeaning } from './semantic.js';

test('chunkText keeps a short page whole', () => {
  assert.deepEqual(chunkText('Pricing\n\nPlus costs 499 BDT.'), ['Pricing\n\nPlus costs 499 BDT.']);
  assert.deepEqual(chunkText('  \n '), []);
});

test('chunkText splits at paragraphs, every chunk within the budget, nothing lost', () => {
  const paras = Array.from({ length: 12 }, (_, i) => `Paragraph ${i} ` + 'word '.repeat(60).trim());
  const chunks = chunkText(paras.join('\n\n'), 1000, 0);
  assert.ok(chunks.length > 1);
  for (const c of chunks) assert.ok(c.length <= 1000, `chunk of ${c.length}`);
  for (const p of paras) assert.ok(chunks.some((c) => c.includes(p)), 'paragraph kept whole');
});

test('chunkText hard-cuts one unbroken run', () => {
  const chunks = chunkText('x'.repeat(2500), 1000, 0);
  assert.deepEqual(chunks.map((c) => c.length), [1000, 1000, 500]);
});

test('chunkText overlap carries the previous tail from a word boundary', () => {
  // The 12-char tail is "a gamma delta" minus its cut word: "gamma delta".
  assert.deepEqual(chunkText('alpha beta gamma delta. one two three four five. ', 25, 12),
    ['alpha beta gamma delta', 'gamma delta one two three four five.']);
});

test('rrf ranks an id found by both lists above ids found by one', () => {
  assert.deepEqual(rrf([['a', 'b', 'c'], ['x', 'b']]), ['b', 'a', 'x', 'c']);
  assert.deepEqual(rrf([[], ['x']]), ['x']);
});

test('retryDelayMs backs off from 30 min, doubling, capped at a day', () => {
  assert.equal(retryDelayMs(1), 30 * 60_000);
  assert.equal(retryDelayMs(2), 60 * 60_000);
  assert.equal(retryDelayMs(3), 120 * 60_000);
  assert.equal(retryDelayMs(30), 24 * 60 * 60_000);
});

test('wantsMeaning: phrases and non-Latin words, not short keyword stubs', () => {
  assert.equal(wantsMeaning('pri'), false);
  assert.equal(wantsMeaning('pricing'), false);
  assert.equal(wantsMeaning('MD-14'), false);
  assert.equal(wantsMeaning('pricing tiers'), true);
  assert.equal(wantsMeaning('what did we decide'), true);
  assert.equal(wantsMeaning('মূল্য'), true);
});
