import test from 'node:test';
import assert from 'node:assert/strict';
import { writePolicy } from './approval.js';

test('writePolicy: person direct, Ask AI and untrusted agent suggest, trusted agent direct', () => {
  const person = { kind: 'person' }, agent = { kind: 'agent' };
  assert.equal(writePolicy({ user: person, via: 'human', token: null }), 'direct');
  assert.equal(writePolicy({ user: person, via: 'human', token: { trusted: true } }), 'direct');
  assert.equal(writePolicy({ user: person, via: 'ai', token: null }), 'suggest');
  assert.equal(writePolicy({ user: agent, via: 'human', token: { trusted: false } }), 'suggest');
  assert.equal(writePolicy({ user: agent, via: 'human', token: null }), 'suggest'); // agent on a cookie: still gated
  assert.equal(writePolicy({ user: agent, via: 'human', token: { trusted: true } }), 'direct');
  assert.equal(writePolicy({ user: agent, via: 'ai', token: { trusted: true } }), 'suggest'); // Ask AI never trusted
});
