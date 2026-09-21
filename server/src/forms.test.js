import test from 'node:test';
import assert from 'node:assert/strict';
import { allow, resetLimit } from './forms.js';

test('a form accepts submissions up to its limit and then refuses', () => {
  resetLimit('t1');
  for (let i = 0; i < 3; i++) assert.equal(allow('t1', 1000, 3), true, `submission ${i + 1}`);
  assert.equal(allow('t1', 1000, 3), false, 'the fourth is refused');
});

test('the window reopens', () => {
  resetLimit('t2');
  assert.equal(allow('t2', 0, 1), true);
  assert.equal(allow('t2', 0, 1), false);
  // An hour later.
  assert.equal(allow('t2', 60 * 60 * 1000 + 1, 1), true);
});

// One noisy form must not close another. The limit protects the database
// behind a link, so it is per link.
test('one form running out does not affect another', () => {
  resetLimit('a');
  resetLimit('b');
  assert.equal(allow('a', 0, 1), true);
  assert.equal(allow('a', 0, 1), false);
  assert.equal(allow('b', 0, 1), true);
});
