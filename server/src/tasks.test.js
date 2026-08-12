import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_KINDS, kindKey } from './tasks.js';

test('kindKey slugs a typed label', () => {
  assert.equal(kindKey('Spike'), 'spike');
  assert.equal(kindKey('Tech Debt'), 'tech-debt');
  assert.equal(kindKey('  Customer Request!  '), 'customer-request');
});

test('kindKey never collides with a key already in the project', () => {
  assert.equal(kindKey('Bug', ['epic', 'story', 'task', 'bug']), 'bug-2');
  assert.equal(kindKey('Bug', ['bug', 'bug-2', 'bug-3']), 'bug-4');
});

test('kindKey survives a label with nothing sluggable in it', () => {
  // '📌' and '???' would otherwise produce an empty primary key.
  assert.equal(kindKey('📌'), 'type');
  assert.equal(kindKey('???', ['type']), 'type-2');
});

test('the seeded defaults are unique and exactly one groups children', () => {
  const keys = DEFAULT_KINDS.map((k) => k.key);
  assert.equal(new Set(keys).size, keys.length);
  assert.deepEqual(DEFAULT_KINDS.filter((k) => k.is_group).map((k) => k.key), ['epic']);
});
