import test from 'node:test';
import assert from 'node:assert/strict';
import { actorVia } from './actor.js';

const NONCE = 'a'.repeat(43);
const req = (headers) => ({ headers });

test('the copilot is believed only when it echoes this process’s nonce', () => {
  assert.equal(actorVia(req({ 'x-actor-via': 'ai', 'x-actor-nonce': NONCE }), NONCE), 'ai');
});

test('a client claiming to be the copilot is not believed', () => {
  // The whole point: a header alone must not let a caller blame the AI, nor
  // let one stamp its own edits 'human' to hide that the AI made them.
  assert.equal(actorVia(req({ 'x-actor-via': 'ai', 'x-actor-nonce': 'guessed' }), NONCE), 'human');
  assert.equal(actorVia(req({ 'x-actor-via': 'ai' }), NONCE), 'human');
  assert.equal(actorVia(req({ 'x-actor-via': 'ai', 'x-actor-nonce': '' }), NONCE), 'human');
});

test('a nonce of the right length but the wrong value is still refused', () => {
  assert.equal(actorVia(req({ 'x-actor-via': 'ai', 'x-actor-nonce': 'b'.repeat(43) }), NONCE), 'human');
});

test('an ordinary request is a person', () => {
  assert.equal(actorVia(req({}), NONCE), 'human');
  assert.equal(actorVia(req({ 'x-actor-nonce': NONCE }), NONCE), 'human');
});
