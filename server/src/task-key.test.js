import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveKey, stripKey, uniqueKey, withKey } from './task-key.js';

test('a key is the initials of a multi-word name', () => {
  assert.equal(deriveKey('Metanoia Docs'), 'MD');
  assert.equal(deriveKey('Uraan AI Platform'), 'UAP');
});

test('a one-word name gives its first three letters', () => {
  assert.equal(deriveKey('Backend'), 'BAC');
});

test('a name with nothing to take initials from still yields a usable key', () => {
  assert.equal(deriveKey(''), 'P');
  assert.equal(deriveKey('日本語'), 'P');
  assert.match(deriveKey('2026 Roadmap'), /^[A-Za-z][A-Za-z0-9]{0,7}$/);
});

test('a key never outgrows the column', () => {
  assert.ok(deriveKey('One Two Three Four Five Six Seven').length <= 8);
});

test('the second project wanting a key gets a numbered one', () => {
  assert.equal(uniqueKey('MD', []), 'MD');
  assert.equal(uniqueKey('MD', ['MD']), 'MD2');
  assert.equal(uniqueKey('MD', ['MD', 'MD2']), 'MD3');
});

test('a taken key is taken whatever case it was stored in', () => {
  assert.equal(uniqueKey('MD', ['md']), 'MD2');
});

test('the digits eat into a long key rather than extending it', () => {
  assert.equal(uniqueKey('ABCDEFGH', ['ABCDEFGH']).length, 8);
});

test('a title is given its key', () => {
  assert.equal(withKey('MD', 14, 'Fix login redirect'), 'MD-14: Fix login redirect');
});

// The whole hazard of storing the key inside the title: it comes back on the
// next edit, and the next, until the row reads "MD-14: MD-14: MD-14: …".
test('re-saving a title does not stack a second key on it', () => {
  const once = withKey('MD', 14, 'Fix login redirect');
  assert.equal(withKey('MD', 14, once), once);
  assert.equal(withKey('MD', 14, withKey('MD', 14, once)), once);
});

test('changing a project key renames rather than appends', () => {
  assert.equal(withKey('OPS', 14, 'MD-14: Fix login redirect'), 'OPS-14: Fix login redirect');
});

test('a task that has no number yet keeps a bare title', () => {
  assert.equal(withKey('MD', null, 'Fix login redirect'), 'Fix login redirect');
  assert.equal(withKey(null, 14, 'Fix login redirect'), 'Fix login redirect');
});

test('a colon in the title is not mistaken for a key', () => {
  assert.equal(stripKey('Bug: login redirects twice'), 'Bug: login redirects twice');
  assert.equal(stripKey('TODO 2026: plan the quarter'), 'TODO 2026: plan the quarter');
});

test('a key someone typed themselves is stripped like any other', () => {
  assert.equal(stripKey('MD-14: Fix login'), 'Fix login');
  assert.equal(stripKey('MD-14:Fix login'), 'Fix login');
});
