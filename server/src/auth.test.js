import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mayReplacePassword } from './auth.js';

/**
 * The one place in the app where a password can be set without proving the old
 * one. Worth pinning: loosening it by accident is an account takeover, and
 * tightening it by accident locks out everyone who forgot their password —
 * which is the only reason the route exists.
 */

test('a session begun by a sign-in link may set a password with no old one', () => {
  assert.equal(mayReplacePassword({ sessionVia: 'link', passwordMatches: false }), true);
});

test('a password session may not — the mailbox is what it never proved', () => {
  assert.equal(mayReplacePassword({ sessionVia: null, passwordMatches: false }), false);
});

test('a password session that produced the right password may, as it always could', () => {
  assert.equal(mayReplacePassword({ sessionVia: null, passwordMatches: true }), true);
});

test('only the exact marker counts as a link', () => {
  for (const via of ['', 'password', 'LINK', 'link ', undefined, 0, true]) {
    assert.equal(mayReplacePassword({ sessionVia: via, passwordMatches: false }), false, String(via));
  }
});

test('a truthy non-true match is not a match', () => {
  assert.equal(mayReplacePassword({ sessionVia: null, passwordMatches: 'yes' }), false);
});
