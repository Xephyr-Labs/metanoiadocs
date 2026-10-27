import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createMetanoiaMcpServer } from './mcp-tools.js';

// A tool handler called directly, with fetch stubbed to answer `data`.
async function call(name, args, data) {
  const seen = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    seen.push({ url: String(url), headers: init.headers || {} });
    return { ok: true, status: 200, text: async () => JSON.stringify(data) };
  };
  try {
    const server = createMetanoiaMcpServer({ base: 'http://x', headers: { Authorization: 'Bearer t' } });
    const res = await server._registeredTools[name].handler(args, {});
    return { text: res.content[0].text, seen };
  } finally {
    globalThis.fetch = realFetch;
  }
}

test('write_doc and read_doc say who asked, keeping the caller\'s auth', async () => {
  const w = await call('write_doc', { id: 'd1', markdown: 'x', onBehalfOf: 'ada@x.io' }, { ok: true });
  assert.equal(w.seen[0].headers['X-On-Behalf-Of'], 'ada@x.io');
  assert.equal(w.seen[0].headers.Authorization, 'Bearer t');
  assert.equal(w.text, 'Done.');
  const r = await call('read_doc', { id: 'd1', onBehalfOf: 'ada' }, { markdown: '' });
  assert.equal(r.seen[0].headers['X-On-Behalf-Of'], 'ada');
  const none = await call('read_doc', { id: 'd1' }, { markdown: '' });
  assert.equal('X-On-Behalf-Of' in none.seen[0].headers, false);
});

test('a suggested write_doc names the reviewer and links to the review', async () => {
  const before = process.env.BASE_URL;
  process.env.BASE_URL = 'https://docs.example.com';
  try {
    const w = await call('write_doc', { id: 'd1', markdown: 'x' },
      { ok: true, suggested: true, suggestionId: 's1', reviewUrl: '/d/d1?review=s1', approverName: 'Ada', changes: 3 });
    assert.equal(w.text, 'Suggested 3 changes for Ada to review: https://docs.example.com/d/d1?review=s1');
  } finally {
    if (before === undefined) delete process.env.BASE_URL; else process.env.BASE_URL = before;
  }
});
