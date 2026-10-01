import test from 'node:test';
import assert from 'node:assert/strict';
import { guestName, hashKey, keyMatches, makeRateLimiter, shareAccess } from './guest-comments.js';

test('a guest name is trimmed, one line, and short', () => {
  assert.equal(guestName('  Sam   Lee '), 'Sam Lee');
  assert.equal(guestName('Sam\nLee\u0007'), 'Sam Lee');
  assert.equal(guestName('x'.repeat(100)).length, 60);
});

test('no name is no name', () => {
  for (const raw of ['', '   ', null, undefined, '\n\t']) assert.equal(guestName(raw), null);
});

test('a link is view-only unless it says comment', () => {
  assert.equal(shareAccess('comment'), 'comment');
  for (const v of ['view', 'edit', undefined, null, 'COMMENT']) assert.equal(shareAccess(v), 'view');
});

test('only the key a comment was made with matches it', () => {
  const stored = hashKey('secret-key');
  assert.ok(keyMatches('secret-key', stored));
  assert.ok(!keyMatches('secret-kez', stored));
  assert.ok(!keyMatches('', stored));
  assert.ok(!keyMatches(undefined, stored));
  assert.ok(!keyMatches('secret-key', null));
});

test('a link is limited per window, then frees up again', () => {
  const allow = makeRateLimiter({ limit: 2, windowMs: 1000 });
  assert.ok(allow('doc', 0));
  assert.ok(allow('doc', 10));
  assert.ok(!allow('doc', 20));
  assert.ok(allow('other', 20), 'each link has its own budget');
  assert.ok(allow('doc', 1015), 'the window slides');
});
