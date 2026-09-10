import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_KINDS, kindKey, wantedAssignees } from './tasks.js';

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

test('wantedAssignees tells "no change" apart from "nobody"', () => {
  // No assignee field at all: dragging a card must not clear its people.
  assert.equal(wantedAssignees({ status: 'doing' }), undefined);
  assert.deepEqual(wantedAssignees({ assigneeIds: [] }), []);
  assert.deepEqual(wantedAssignees({ assigneeId: null }), []);
  assert.deepEqual(wantedAssignees({ assigneeId: '' }), []);
});

test('wantedAssignees keeps the order it was given and drops repeats', () => {
  assert.deepEqual(wantedAssignees({ assigneeIds: ['b', 'a', 'b'] }), ['b', 'a']);
  assert.deepEqual(wantedAssignees({ assigneeIds: ['a', 1, null, 'c'] }), ['a', 'c']);
});

test('wantedAssignees reads the older single field as a list of one', () => {
  assert.deepEqual(wantedAssignees({ assigneeId: 'u1' }), ['u1']);
  // The list wins when a client sends both.
  assert.deepEqual(wantedAssignees({ assigneeIds: ['u2'], assigneeId: 'u1' }), ['u2']);
});

test('wantedAssignees caps a list that would not fit a row', () => {
  const many = Array.from({ length: 40 }, (_, i) => `u${i}`);
  assert.equal(wantedAssignees({ assigneeIds: many }).length, 20);
});

test('the seeded defaults are unique and exactly one groups children', () => {
  const keys = DEFAULT_KINDS.map((k) => k.key);
  assert.equal(new Set(keys).size, keys.length);
  assert.deepEqual(DEFAULT_KINDS.filter((k) => k.is_group).map((k) => k.key), ['epic']);
});
