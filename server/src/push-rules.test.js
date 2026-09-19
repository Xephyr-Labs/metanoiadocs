import test from 'node:test';
import assert from 'node:assert/strict';
import { hostOf, isGone, linkFor } from './push-rules.js';

test('a 404 or 410 means the subscription is dead and the row should go', () => {
  assert.equal(isGone(404), true);
  assert.equal(isGone(410), true);
});

test('every other failure keeps the row — a 500 is the push service having a bad day', () => {
  for (const code of [0, 400, 401, 403, 413, 429, 500, 503, undefined]) {
    assert.equal(isGone(code), false, `${code} should not delete the subscription`);
  }
});

test('a notification opens the page it is about', () => {
  assert.equal(linkFor({ docId: 'abc' }), '/d/abc');
});

test('one with no page opens the database the row lives in', () => {
  // A task's page is made the first time somebody opens the task, so most of
  // the notifications about one are raised before any page exists.
  assert.equal(linkFor({ docId: null, projectId: 'proj-1' }), '/db/proj-1');
});

test('the page wins when there is one, so the alert lands on what it is about', () => {
  assert.equal(linkFor({ docId: 'abc', projectId: 'proj-1' }), '/d/abc');
});

test('one with nothing addressable opens the dashboard rather than /d/null', () => {
  assert.equal(linkFor({ docId: null }), '/');
  assert.equal(linkFor({}), '/');
});

test('only the push service host is ever shown, never the endpoint itself', () => {
  assert.equal(
    hostOf('https://fcm.googleapis.com/fcm/send/c0ffee-secret-token'),
    'fcm.googleapis.com'
  );
  assert.equal(hostOf('not a url'), 'unknown');
});
