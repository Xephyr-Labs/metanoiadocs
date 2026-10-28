import test from 'node:test';
import assert from 'node:assert/strict';
import { aiCompleter } from './ai-complete.js';

const CFG = { enabled: true, baseUrl: 'http://ai', apiKey: 'k', model: 'm' };
const clientWith = (create) => () => ({ chat: { completions: { create } } });

test('aiComplete: 503 when Ask AI is not configured', async () => {
  for (const cfg of [null, { ...CFG, enabled: false }, { ...CFG, apiKey: '' }]) {
    const complete = aiCompleter(async () => cfg, clientWith(async () => assert.fail('called')));
    await assert.rejects(complete({ messages: [] }), (e) => e.status === 503);
  }
});

test('aiComplete: returns the message content, never the reasoning', async () => {
  let sent;
  const complete = aiCompleter(async () => CFG, clientWith(async (body) => {
    sent = body;
    return { choices: [{ message: { reasoning_content: 'hmm [1]', content: '[]' } }] };
  }));
  assert.equal(await complete({ messages: [{ role: 'user', content: 'x' }], maxTokens: 99 }), '[]');
  assert.equal(sent.model, 'm');
  assert.equal(sent.max_tokens, 99);
  assert.equal(sent.stream, undefined);
});

test('aiComplete: a provider that never answers is a 504', async () => {
  const complete = aiCompleter(async () => CFG, clientWith((_body, { signal }) => new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(new Error('aborted')));
  })), 20);
  await assert.rejects(complete({ messages: [] }), (e) => e.status === 504);
});
