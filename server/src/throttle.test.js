import test from 'node:test';
import assert from 'node:assert/strict';
import { lockedFor, noteFailure, clearFailures, LOCK_AFTER, LOCK_MS } from './throttle.js';

// Each test uses its own key — the Map is module state, shared across the file.
const T0 = 1_700_000_000_000;

test('a key is free until it has failed LOCK_AFTER times', () => {
  const k = 'free';
  for (let i = 0; i < LOCK_AFTER - 1; i++) {
    noteFailure(k, T0);
    assert.equal(lockedFor(k, T0), 0, `still free after ${i + 1} failures`);
  }
  noteFailure(k, T0);
  assert.ok(lockedFor(k, T0) > 0, 'locked on the LOCK_AFTER-th failure');
});

test('the lock reports whole minutes remaining and expires with the window', () => {
  const k = 'window';
  for (let i = 0; i < LOCK_AFTER; i++) noteFailure(k, T0);
  assert.equal(lockedFor(k, T0), 15);
  assert.equal(lockedFor(k, T0 + 14 * 60_000), 1, 'a minute left rounds to 1');
  assert.equal(lockedFor(k, T0 + LOCK_MS), 0, 'free the moment the window ends');
});

test('each failure pushes the window out — a slow drip cannot outwait the lock', () => {
  const k = 'sliding';
  for (let i = 0; i < LOCK_AFTER; i++) noteFailure(k, T0 + i * 60_000);
  // The count survived because no gap exceeded LOCK_MS, and the deadline moved
  // with the last attempt rather than the first.
  assert.ok(lockedFor(k, T0 + LOCK_AFTER * 60_000) > 0);
});

test('a gap longer than the window starts the count over', () => {
  const k = 'stale';
  for (let i = 0; i < LOCK_AFTER - 1; i++) noteFailure(k, T0);
  noteFailure(k, T0 + LOCK_MS + 1);
  assert.equal(lockedFor(k, T0 + LOCK_MS + 1), 0, 'one fresh failure, not eight');
});

test('a correct password clears the record', () => {
  const k = 'cleared';
  for (let i = 0; i < LOCK_AFTER; i++) noteFailure(k, T0);
  assert.ok(lockedFor(k, T0) > 0);
  clearFailures(k);
  assert.equal(lockedFor(k, T0), 0);
});

test('keys are independent — locking one account frees none and locks no other', () => {
  const a = 'acct-a';
  const b = 'acct-b';
  for (let i = 0; i < LOCK_AFTER; i++) noteFailure(a, T0);
  assert.ok(lockedFor(a, T0) > 0);
  assert.equal(lockedFor(b, T0), 0);
});
