import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { deliver, signPayload, subscribes, validWebhookUrl } from './webhooks.js';

test('only http(s) is somewhere we will POST', () => {
  assert.equal(validWebhookUrl('https://example.com/hook'), true);
  assert.equal(validWebhookUrl('http://ci:8080/x'), true);
  assert.equal(validWebhookUrl('file:///etc/passwd'), false);
  assert.equal(validWebhookUrl('not a url'), false);
  assert.equal(validWebhookUrl(''), false);
});

test('the signature covers the timestamp, so a delivery cannot be replayed later', () => {
  const body = '{"event":"task.created"}';
  const a = signPayload('s3cret', 1000, body);
  const b = signPayload('s3cret', 2000, body);
  assert.notEqual(a, b);
  // And it is reproducible by a receiver holding the same secret.
  const expect = crypto.createHmac('sha256', 's3cret').update(`1000.${body}`).digest('hex');
  assert.equal(a, `sha256=${expect}`);
});

test('an empty event list means every event', () => {
  assert.equal(subscribes({ events: [] }, 'task.created'), true);
  assert.equal(subscribes({ events: null }, 'doc.updated'), true);
  assert.equal(subscribes({ events: ['task.created'] }, 'task.created'), true);
  assert.equal(subscribes({ events: ['task.created'] }, 'doc.updated'), false);
});

test('a 2xx is delivered on the first attempt', async () => {
  let calls = 0;
  const out = await deliver({ url: 'https://x/h', secret: 's' }, 'task.created', { id: '1' }, {
    fetchImpl: async () => { calls++; return { ok: true, status: 204 }; },
  });
  assert.deepEqual(out, { ok: true, statusCode: 204, attempts: 1 });
  assert.equal(calls, 1);
});

test('deliver makes exactly one attempt — the worker owns the retry schedule', async () => {
  // It used to loop internally, which meant the schedule lived in this
  // function's stack and died with the process. One attempt, recorded, requeued
  // by the worker if it is worth another go.
  let calls = 0;
  const out = await deliver({ url: 'https://x/h', secret: 's' }, 'task.created', { id: '1' }, {
    fetchImpl: async () => { calls++; return { ok: false, status: 500 }; },
  });
  assert.equal(calls, 1);
  assert.equal(out.attempts, 1);
  assert.equal(out.ok, false);
  assert.equal(out.statusCode, 500);
});

test('a 4xx reports its status so the worker knows not to retry it', async () => {
  const out = await deliver({ url: 'https://x/h', secret: 's' }, 'task.created', { id: '1' }, {
    fetchImpl: async () => ({ ok: false, status: 410 }),
  });
  assert.equal(out.ok, false);
  assert.equal(out.statusCode, 410);
});

test('a network failure reports no status, which is what makes it retryable', async () => {
  const out = await deliver({ url: 'https://x/h', secret: 's' }, 'task.created', { id: '1' }, {
    fetchImpl: async () => { throw new Error('fetch failed'); },
  });
  assert.equal(out.statusCode, null);
  assert.equal(out.error, 'fetch failed');
});

test('the signed body carries the event and the payload the receiver was promised', async () => {
  let seen = null;
  await deliver({ url: 'https://x/h', secret: 'k' }, 'run.finished', { id: 'r1' }, {
    fetchImpl: async (_url, init) => { seen = init; return { ok: true, status: 200 }; },
  });
  const parsed = JSON.parse(seen.body);
  assert.equal(parsed.event, 'run.finished');
  assert.deepEqual(parsed.data, { id: 'r1' });
  assert.equal(seen.headers['X-Metanoia-Event'], 'run.finished');
  assert.equal(
    seen.headers['X-Metanoia-Signature'],
    signPayload('k', Number(seen.headers['X-Metanoia-Timestamp']), seen.body)
  );
});
