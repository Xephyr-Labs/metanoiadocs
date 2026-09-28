import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isDeadToken, isFcmToken } from './fcm.js';

test('accepts FCM-shaped tokens and rejects anything else', () => {
  assert.ok(isFcmToken('cXyZ123:APA91b' + 'a'.repeat(140)));
  assert.ok(!isFcmToken(''));
  assert.ok(!isFcmToken('short'));
  assert.ok(!isFcmToken('has spaces '.repeat(10)));
  assert.ok(!isFcmToken({ token: 'x'.repeat(50) }));
});

test('only a gone token is deleted, not a bad request', () => {
  assert.ok(isDeadToken(404, ''));
  assert.ok(isDeadToken(400, '{"error":{"details":[{"errorCode":"UNREGISTERED"}]}}'));
  assert.ok(!isDeadToken(400, '{"error":{"status":"INVALID_ARGUMENT"}}'));
  assert.ok(!isDeadToken(503, 'unavailable'));
});
