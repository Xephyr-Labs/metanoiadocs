import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mentionHandles } from './mentions.js';

test('finds handles and lowercases them', () => {
  assert.deepEqual(mentionHandles('hey @Lamisa.Saba and @shafin'), ['lamisa.saba', 'shafin']);
});

test('drops a trailing full stop, which is sentence punctuation not part of the name', () => {
  assert.deepEqual(mentionHandles('ask @lamisa.'), ['lamisa']);
});

test('keeps dots inside a handle', () => {
  assert.deepEqual(mentionHandles('@shafin.yeasar please'), ['shafin.yeasar']);
});

test('reports each person once however often they are named', () => {
  assert.deepEqual(mentionHandles('@andy @andy @Andy'), ['andy']);
});

test('an email address yields its domain, which resolves to nobody', () => {
  // Documented rather than special-cased: the domain is picked up as a handle,
  // but no user is called "xephyrlabs.com", so the lookup finds nothing and
  // nothing is sent. Worth knowing before someone adds a matching username.
  assert.deepEqual(mentionHandles('write to lamisa@xephyrlabs.com'), ['xephyrlabs.com']);
});

test('ignores an @ that starts nothing', () => {
  assert.deepEqual(mentionHandles('rates rose 5% @ close, then @ noon'), []);
});

test('is empty for nothing at all', () => {
  assert.deepEqual(mentionHandles(''), []);
  assert.deepEqual(mentionHandles(null), []);
});
