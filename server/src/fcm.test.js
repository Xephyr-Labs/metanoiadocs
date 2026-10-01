import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ALERTS_CHANNEL, fcmMessage, isDeadToken, isFcmToken } from './fcm.js';

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

test('an alert is posted loud: high priority, on the app’s own channel', () => {
  const m = fcmMessage('tok', { title: 'T', body: 'B', tag: 'row-1', url: '/d/x' });
  assert.equal(m.token, 'tok');
  assert.deepEqual(m.notification, { title: 'T', body: 'B' });
  assert.deepEqual(m.data, { url: '/d/x' });
  assert.equal(m.android.priority, 'HIGH');
  assert.equal(m.android.notification.channel_id, ALERTS_CHANNEL);
  assert.equal(m.android.notification.tag, 'row-1');
});
