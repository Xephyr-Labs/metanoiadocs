import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';

import { attachmentMarkdown, createMetanoiaMcpServer, MAX_ATTACHMENT_BYTES } from './mcp-tools.js';

// A tool handler called directly, with fetch stubbed to answer `data` (a function sees the call).
async function call(name, args, data = { ok: true }) {
  const seen = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    seen.push({ url: String(url), method: init.method || 'GET', headers: init.headers || {}, body: init.body });
    const d = typeof data === 'function' ? data(String(url), init) : data;
    return { ok: true, status: 200, text: async () => JSON.stringify(d) };
  };
  try {
    const server = createMetanoiaMcpServer({ base: 'http://x', headers: { Authorization: 'Bearer t' } });
    const res = await server._registeredTools[name].handler(args, {});
    return { res, text: res.content[0].text, seen };
  } finally {
    globalThis.fetch = realFetch;
  }
}

test('resolve_comment and reopen_comment use the comment route with the caller\'s auth', async () => {
  const r = await call('resolve_comment', { commentId: 'c1' });
  assert.equal(r.seen[0].url, 'http://x/api/comments/c1/resolve');
  assert.equal(r.seen[0].method, 'POST');
  assert.equal(r.seen[0].headers.Authorization, 'Bearer t');
  assert.deepEqual(JSON.parse(r.seen[0].body), { resolved: true });
  const o = await call('reopen_comment', { commentId: 'c1' });
  assert.deepEqual(JSON.parse(o.seen[0].body), { resolved: false });
});

test('delete_doc is the soft-delete route, restore_doc the restore route, list_trash the listing', async () => {
  const d = await call('delete_doc', { id: 'd1' });
  assert.equal(d.seen[0].method, 'DELETE');
  assert.equal(d.seen[0].url, 'http://x/api/docs/d1');
  assert.match(d.text, /trash/i);
  const r = await call('restore_doc', { id: 'd1' });
  assert.equal(r.seen[0].url, 'http://x/api/docs/d1/restore');
  const l = await call('list_trash', {}, { retentionDays: 30, rows: [{ id: 'd1', title: 'T', deleted_at: 'x', purge_at: 'y', can_delete: true }] });
  assert.equal(l.seen[0].url, 'http://x/api/docs/trash');
  assert.equal(JSON.parse(l.text).pages[0].id, 'd1');
});

test('an image becomes an image line, any other file a link carrying its name', () => {
  assert.equal(attachmentMarkdown('abc', 'a b.png', 'image/png'), '![a b.png](/api/blob/abc)');
  assert.equal(attachmentMarkdown('abc', 'plan.pdf', 'application/pdf'), '[plan.pdf](/api/blob/abc?name=plan.pdf)');
  // a name cannot break out of the markdown
  assert.equal(attachmentMarkdown('abc', 'x](evil) [y.pdf', 'application/pdf'), '[x evil y.pdf](/api/blob/abc?name=x%20evil%20y.pdf)');
});

test('upload_attachment stores the blob under its sha256, then appends through write_doc', async () => {
  const bytes = Buffer.from('hello');
  const key = createHash('sha256').update(bytes).digest('hex');
  const r = await call('upload_attachment', { id: 'd1', filename: 'h.png', mime: 'image/png', contentBase64: bytes.toString('base64') });
  assert.equal(r.seen[0].method, 'PUT');
  assert.equal(r.seen[0].url, `http://x/api/blob/${key}`);
  assert.equal(r.seen[0].headers['Content-Type'], 'image/png');
  assert.equal(r.seen[0].headers.Authorization, 'Bearer t');
  assert.equal(r.seen[1].url, 'http://x/api/docs/d1/content');
  assert.deepEqual(JSON.parse(r.seen[1].body), { markdown: `![h.png](/api/blob/${key})`, mode: 'append' });
  assert.equal(r.text, 'Done.');
});

test('upload_attachment passes a suggestion through rather than claiming the file landed', async () => {
  const sug = { ok: true, suggested: true, reviewUrl: '/d/d1?review=s1', approverName: 'Ada', changes: 1 };
  const r = await call('upload_attachment', { id: 'd1', filename: 'h.png', mime: 'image/png', contentBase64: 'aGk=' }, (url) => (url.endsWith('/content') ? sug : { ok: true }));
  assert.match(r.text, /^Suggested 1 change for Ada/);
});

test('upload_attachment refuses an oversize or non-base64 file before any request', async () => {
  const big = Buffer.alloc(MAX_ATTACHMENT_BYTES + 1).toString('base64');
  const a = await call('upload_attachment', { id: 'd1', filename: 'b.bin', mime: 'application/octet-stream', contentBase64: big });
  assert.equal(a.res.isError, true);
  assert.equal(a.seen.length, 0);
  const b = await call('upload_attachment', { id: 'd1', filename: 'b.bin', mime: 'application/octet-stream', contentBase64: '!!!' });
  assert.equal(b.res.isError, true);
  assert.equal(b.seen.length, 0);
});
