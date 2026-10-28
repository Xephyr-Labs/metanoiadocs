import assert from 'node:assert/strict';
import { test } from 'node:test';

import { readFileSync } from 'node:fs';
import { createMetanoiaMcpServer, suggestedMessage } from './mcp-tools.js';

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

test('write_doc keeps the caller\'s auth and names no reviewer', async () => {
  const w = await call('write_doc', { id: 'd1', markdown: 'x' }, { ok: true });
  assert.equal(w.seen[0].headers.Authorization, 'Bearer t');
  assert.equal('X-On-Behalf-Of' in w.seen[0].headers, false);
  assert.equal(w.text, 'Done.');
});

test('a suggestion with no named approver is for anyone who can edit the page', () => {
  assert.equal(suggestedMessage({ changes: 2, approverName: null, reviewUrl: '/d/d1?review=s1' }, 'https://h'),
    'Suggested 2 changes for anyone who can edit the page to review: https://h/d/d1?review=s1');
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

test('one change is "1 change"', () => {
  assert.equal(suggestedMessage({ changes: 1, approverName: 'Ada', reviewUrl: '/d/d1?review=s1' }, 'https://h'),
    'Suggested 1 change for Ada to review: https://h/d/d1?review=s1');
});

test('the standalone stdio package builds the same message', () => {
  const line = (file) => readFileSync(new URL(file, import.meta.url), 'utf8').match(/^\s*`Suggested .*$/m)?.[0].trim();
  assert.ok(line('./mcp-tools.js'));
  assert.equal(line('../../mcp/src/index.js'), line('./mcp-tools.js'));
});
