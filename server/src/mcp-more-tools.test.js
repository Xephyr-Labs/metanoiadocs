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

import { attachmentDisposition, keyMatchesBytes } from './blob-rules.js';
import { resolveVerdict } from './comment-resolve.js';
import { aiTools } from './ai-tools.js';
import { bodyError, jsonUnlessMcp } from './mcp-http.js';

test('a blob key must be the sha256 of its bytes, in either encoding', () => {
  const b = Buffer.from('hello');
  const d = createHash('sha256').update(b).digest();
  assert.ok(keyMatchesBytes(d.toString('hex'), b));
  assert.ok(keyMatchesBytes(d.toString('base64url'), b));
  assert.equal(keyMatchesBytes(d.toString('hex'), Buffer.from('other')), false);
  assert.equal(keyMatchesBytes('original', b), false);
});

test('a download name keeps its own letters via filename*', () => {
  assert.equal(attachmentDisposition('plan.pdf'), `attachment; filename="plan.pdf"; filename*=UTF-8''plan.pdf`);
  const h = attachmentDisposition('রিপোর্ট "x".pdf');
  assert.match(h, /filename\*=UTF-8''%E0%A6/);
  assert.doesNotMatch(h, /"x"/);
  assert.equal(attachmentDisposition(''), 'attachment');
});

test('resolving: never a suggestion card; untrusted only its own threads; editors any page thread', () => {
  const base = { authorId: 'a', userId: 'b', taskId: null, untrusted: false, canEditPage: true };
  assert.equal(resolveVerdict({ ...base, kind: 'suggestion' }).status, 409);
  assert.equal(resolveVerdict({ ...base, kind: 'comment' }), null);
  assert.equal(resolveVerdict({ ...base, kind: 'comment', untrusted: true }).status, 403);
  assert.equal(resolveVerdict({ ...base, kind: 'comment', untrusted: true, userId: 'a' }), null);
  assert.equal(resolveVerdict({ ...base, kind: 'comment', canEditPage: false }).status, 403);
  assert.equal(resolveVerdict({ ...base, kind: 'comment', taskId: 't' }).status, 403);
  assert.equal(resolveVerdict({ ...base, kind: 'suggestion', userId: 'a' }).status, 409);
});

test('Ask AI is not offered delete_doc or restore_doc, and cannot call them', async () => {
  const t = aiTools({ base: 'http://x', headers: {} });
  try {
    const names = (await t.specs()).map((s) => s.function.name);
    assert.ok(names.includes('upload_attachment'));
    assert.ok(!names.includes('delete_doc') && !names.includes('restore_doc'));
    assert.match((await t.run('delete_doc', '{"id":"d"}')).error, /not available/);
  } finally {
    await t.close();
  }
});

test('an oversized body is a 413, not a 500', () => {
  const res = { statusCode: 0, headersSent: false, status(s) { this.statusCode = s; return this; }, json(b) { this.body = b; } };
  assert.equal(bodyError({ status: 413, type: 'entity.too.large' }, {}, res, () => assert.fail()), undefined);
  assert.equal(res.statusCode, 413);
  let passed = false;
  bodyError(new Error('boom'), {}, res, () => { passed = true; });
  assert.ok(passed);
});

test('a ~2 MB attachment goes through POST /mcp (the global 100 KB parser does not see /mcp)', async (t) => {
  const express = (await import('express')).default;
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
  const { registerMcpRoute } = await import('./mcp-http.js');
  const app = express();
  app.use(jsonUnlessMcp);
  let stored = 0;
  app.put('/api/blob/:key', express.raw({ type: '*/*', limit: '25mb' }), (req, res) => { stored = req.body.length; res.json({ ok: true }); });
  app.post('/api/docs/:id/content', (req, res) => res.json({ ok: true }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const port = server.address().port;
  registerMcpRoute(app, { requireUser: (req, res, next) => next(), port });
  app.use(bodyError);
  t.after(() => new Promise((r) => server.close(r)));
  const client = new Client({ name: 't', version: '0' }, { capabilities: {} });
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), { requestInit: { headers: { Authorization: 'Bearer t' } } }));
  t.after(() => client.close());
  const bytes = Buffer.alloc(2 * 1024 * 1024, 7);
  const r = await client.callTool({ name: 'upload_attachment', arguments: { id: 'd1', filename: 'big.bin', mime: 'application/octet-stream', contentBase64: bytes.toString('base64') } });
  assert.equal(r.isError, undefined, r.content?.[0]?.text);
  assert.equal(stored, bytes.length);
  // and other routes keep the small limit
  const big = await fetch(`http://127.0.0.1:${port}/api/docs/x/content`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ a: 'x'.repeat(200000) }) });
  assert.equal(big.status, 413);
});

test('read_comments hands an agent each voice note with its transcript, other files as they are', async () => {
  const voice = { key: 'a'.repeat(64), name: 'Voice note.webm', mime: 'audio/webm', size: 9 };
  const pdf = { key: 'b'.repeat(64), name: 'plan.pdf', mime: 'application/pdf', size: 9 };
  const r = await call('read_comments', { id: 'd1' }, (url) =>
    url.endsWith('/transcript')
      ? { status: 'done', text: 'Move the launch to Friday.' }
      : [{ id: 'c1', author_name: 'Ana', body: '', attachments: [voice, pdf], resolved: false }]);
  const [c] = JSON.parse(r.text);
  assert.equal(c.body, '🎤 Voice note');
  assert.deepEqual(c.files[0].transcript, { status: 'done', text: 'Move the launch to Friday.' });
  assert.equal(c.files[1].transcript, undefined);
  assert.deepEqual(r.seen.map((s) => s.url), ['http://x/api/docs/d1/comments', `http://x/api/blob/${voice.key}/transcript`]);
});
