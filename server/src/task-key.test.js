import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveKey, parseKeyQuery, stripKey, uniqueKey, usableTitle, withKey } from './task-key.js';

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

// Every task is created with an empty title and named a moment later, so this
// is the state the board draws most often for a brand-new row.
test('an unnamed task is left alone, so the app can call it Untitled', () => {
  assert.equal(withKey('MD', 14, ''), '');
  assert.equal(withKey('MD', 14, '   '), '', 'whitespace is emptiness, as btrim sees it');
  // Including one that already carries a key and nothing else.
  assert.equal(withKey('MD', 14, 'MD-14: '), '');
  assert.equal(withKey('OPS', 14, 'MD-14:'), '');
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

// Searching. A key is only worth having if typing it finds the task.
test('a query that is a key is read as one, however it was typed', () => {
  assert.deepEqual(parseKeyQuery('MD-14'), { key: 'MD', num: 14 });
  assert.deepEqual(parseKeyQuery('md-14'), { key: 'MD', num: 14 });
  assert.deepEqual(parseKeyQuery('MD 14'), { key: 'MD', num: 14 });
  assert.deepEqual(parseKeyQuery('md14'), { key: 'MD', num: 14 });
  assert.deepEqual(parseKeyQuery('  MD-14  '), { key: 'MD', num: 14 });
  // Half a pasted title is still a key.
  assert.deepEqual(parseKeyQuery('MD-14:'), { key: 'MD', num: 14 });
});

test('an ordinary search is not mistaken for a key', () => {
  assert.equal(parseKeyQuery('login redirect'), null);
  assert.equal(parseKeyQuery('2026'), null, 'a key starts with a letter');
  assert.equal(parseKeyQuery(''), null);
  assert.equal(parseKeyQuery('MD-'), null, 'a key without a number names no task');
  assert.equal(parseKeyQuery('VERYLONGKEY-1'), null, 'nine letters is not a key');
});

// The hole this closes: a public form checked the title it was handed, stored
// the title withKey gives back, and those are not the same string. A
// submission of exactly "MD-14:" passed the check and landed as a row with no
// name, from an endpoint anyone with the link can reach.
test('a title that is only a key is not a title', () => {
  assert.equal(usableTitle('MD-14:'), false);
  assert.equal(usableTitle('MD-14:   '), false);
  assert.equal(usableTitle('MD-14: '), false);
  assert.equal(usableTitle(''), false);
  assert.equal(usableTitle('   '), false);
  assert.equal(usableTitle(null), false);
});

test('an ordinary title is usable, key or no key', () => {
  assert.equal(usableTitle('Fix login'), true);
  assert.equal(usableTitle('MD-14: Fix login'), true);
  assert.equal(usableTitle('Bug: login redirects twice'), true);
});
