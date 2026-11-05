// list_versions / restore_version: an agent undoes its own page write by
// putting a saved version back, instead of rewriting the page from memory.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMetanoiaMcpServer } from './mcp-tools.js';

async function call(tool, args, data, status = 200) {
  const seen = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    seen.push({ url: String(url), method: init.method || 'GET' });
    return { ok: status < 400, status, text: async () => JSON.stringify(data) };
  };
  try {
    const server = createMetanoiaMcpServer({ base: 'http://x', headers: { Authorization: 'Bearer t' } });
    const res = await server._registeredTools[tool].handler(args, {});
    return { text: res.content[0].text, isError: res.isError, seen };
  } finally {
    globalThis.fetch = realFetch;
  }
}

test('list_versions reads the page history, newest first, with who saved each one', async () => {
  const rows = [{ id: 'v2', label: 'Before replace', created_at: '2026-11-05T22:04:00Z', author: 'Andy' }];
  const w = await call('list_versions', { id: 'd1' }, rows);
  assert.deepEqual(w.seen, [{ url: 'http://x/api/docs/d1/versions', method: 'GET' }]);
  assert.match(w.text, /v2/);
  assert.match(w.text, /Before replace/);
});

test('restore_version puts a version back in place and names the undo point', async () => {
  const w = await call('restore_version', { id: 'd1', versionId: 'v2' }, { ok: true, undoVersionId: 'v9', live: true });
  assert.deepEqual(w.seen, [{ url: 'http://x/api/docs/d1/versions/v2/restore-in-place', method: 'POST' }]);
  assert.match(w.text, /v9/);
});

test('restore_version passes a refusal through as an error', async () => {
  const w = await call('restore_version', { id: 'd1', versionId: 'v2' }, { error: 'forbidden' }, 403);
  assert.equal(w.isError, true);
});
