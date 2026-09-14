import test from 'node:test';
import assert from 'node:assert/strict';
import { actorVia } from './actor.js';
import { aiTools } from './ai-tools.js';

/**
 * Every write the copilot makes must arrive carrying proof it was the copilot,
 * and that proof must be what the server checks. Tested together because each
 * half is useless alone: headers nothing verifies, or a check nothing sends.
 *
 * Driven through aiTools.run(), which is the same entry the model's tool calls
 * go through — not a private hook that could drift away from the real path.
 */
test('a copilot write announces itself, and the server believes only that', async () => {
  const NONCE = 'n'.repeat(43);
  const seen = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    seen.push({ url: String(url), headers: init.headers || {} });
    return new Response(JSON.stringify({ ok: true }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    const tools = aiTools({
      base: 'http://127.0.0.1:9999',
      headers: { 'X-Actor-Via': 'ai', 'X-Actor-Nonce': NONCE },
    });
    await tools.run('add_tag', JSON.stringify({ id: 'd1', name: 'x' }));
  } finally {
    globalThis.fetch = realFetch;
  }

  assert.ok(seen.length > 0, 'the tool reached the API');
  const h = seen[0].headers;
  assert.equal(h['X-Actor-Via'], 'ai', 'it announces itself as the copilot');
  assert.equal(h['X-Actor-Nonce'], NONCE, 'and proves it');

  // What the server makes of exactly those headers, as sent.
  assert.equal(
    actorVia({ headers: { 'x-actor-via': h['X-Actor-Via'], 'x-actor-nonce': h['X-Actor-Nonce'] } }, NONCE),
    'ai',
  );
  // Strip the proof and the very same request is a person again.
  assert.equal(actorVia({ headers: { 'x-actor-via': 'ai' } }, NONCE), 'human');
});
