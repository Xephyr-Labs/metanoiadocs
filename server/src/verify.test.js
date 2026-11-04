import assert from 'node:assert/strict';
import { test } from 'node:test';

import { REVIEW_AFTER, markStale, pendingNotices, sweepVerifications, verifyState } from './verify.js';

const DAY = 86400000;
const at = '2026-01-01T00:00:00.000Z';
const row = (o = {}) => ({ verified_by: 'u1', verified_at: at, verify_every: 90, verify_stale_at: null, ...o });
const later = (days, extra = 0) => new Date(Date.parse(at) + days * DAY + extra);

test('a page nobody vouched for is unverified and says nothing else', () => {
  assert.deepEqual(verifyState({ verified_by: null, verified_at: null, verify_every: 90 }, later(500)), { state: 'unverified' });
});

test('verified until the interval is up, needs review from that instant', () => {
  assert.equal(verifyState(row(), later(0)).state, 'verified');
  assert.equal(verifyState(row(), later(89, DAY - 1)).state, 'verified');
  const due = verifyState(row(), later(90));
  assert.deepEqual([due.state, due.reason], ['needs_review', 'expired']);
});

test('each interval counts its own days', () => {
  assert.equal(verifyState(row({ verify_every: 30 }), later(29)).state, 'verified');
  assert.equal(verifyState(row({ verify_every: 30 }), later(30)).state, 'needs_review');
  assert.equal(verifyState(row({ verify_every: 180 }), later(179)).state, 'verified');
  assert.equal(verifyState(row({ verify_every: 180 }), later(180)).state, 'needs_review');
});

test('"never" does not expire, and reports no due date', () => {
  const s = verifyState(row({ verify_every: 0 }), later(5000));
  assert.equal(s.state, 'verified');
  assert.equal(s.dueAt, null);
});

test('an edit by someone else flags the page at once, with the reason', () => {
  const s = verifyState(row({ verify_stale_at: later(2).toISOString() }), later(3));
  assert.deepEqual([s.state, s.reason], ['needs_review', 'edited']);
});

test('an edit wins over expiry as the reason only when the page is not yet expired', () => {
  assert.equal(verifyState(row({ verify_stale_at: later(2).toISOString() }), later(100)).reason, 'expired');
});

test('a "never" page is still flagged by someone else\'s edit', () => {
  assert.equal(verifyState(row({ verify_every: 0, verify_stale_at: later(1).toISOString() }), later(2)).state, 'needs_review');
});

test('an unknown or missing interval falls back to the default 90 days', () => {
  assert.equal(verifyState(row({ verify_every: null }), later(89)).state, 'verified');
  assert.equal(verifyState(row({ verify_every: null }), later(90)).state, 'needs_review');
  assert.equal(REVIEW_AFTER, 90);
});

test('the stale marker only ever ignores the verifier and saves with no actor', () => {
  const sql = markStale(3);
  assert.match(sql, /\$3::text IS NOT NULL/);
  assert.match(sql, /\$3::text IS DISTINCT FROM verified_by/);
  assert.match(sql, /verify_stale_at IS NULL/);
});

test('only an unnoticed page that needs review is up for a notice, to its owner', () => {
  const now = later(100);
  const rows = [
    { id: 'a', ...row(), verify_owner: 'boss', verify_notified_at: null },
    { id: 'b', ...row(), verify_owner: null, verify_notified_at: null },
    { id: 'c', ...row(), verify_notified_at: later(95).toISOString() },
    { id: 'd', ...row({ verified_at: later(95).toISOString() }), verify_notified_at: null },
  ];
  assert.deepEqual(pendingNotices(rows, now).map((n) => [n.id, n.ownerId, n.reason]), [['a', 'boss', 'expired'], ['b', 'u1', 'expired']]);
});

// A database small enough to hold one page: the claim UPDATE succeeds once.
function fakeDb(pageRows) {
  const claimed = new Set();
  return {
    async query(sql, params) {
      if (/^\s*SELECT/i.test(sql)) return { rows: pageRows.filter((r) => !claimed.has(r.id)) };
      if (/UPDATE docs SET verify_notified_at/i.test(sql)) {
        if (claimed.has(params[0])) return { rowCount: 0 };
        claimed.add(params[0]);
        return { rowCount: 1 };
      }
      throw new Error('unexpected query ' + sql);
    },
  };
}

test('the sweep tells the owner once, however often it runs', async () => {
  const sent = [];
  const db = fakeDb([{ id: 'a', title: 'Runbook', ...row(), verify_owner: 'boss', verify_notified_at: null }]);
  const notify = async (n) => { sent.push(n); };
  const now = later(100);
  assert.equal(await sweepVerifications({ db, notify, now }), 1);
  assert.equal(await sweepVerifications({ db, notify, now }), 0);
  assert.equal(await sweepVerifications({ db, notify, now: later(200) }), 0);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].ownerId, 'boss');
});

test('two sweeps racing for the same page still notify once', async () => {
  const sent = [];
  const page = { id: 'a', title: 'Runbook', ...row(), verify_notified_at: null };
  const db = fakeDb([page]);
  // both read the page before either has claimed it
  const stale = { query: async (sql, p) => (/^\s*SELECT/i.test(sql) ? { rows: [page] } : db.query(sql, p)) };
  const notify = async (n) => { sent.push(n); };
  await Promise.all([sweepVerifications({ db: stale, notify, now: later(100) }), sweepVerifications({ db: stale, notify, now: later(100) })]);
  assert.equal(sent.length, 1);
});

test('verify_doc and read_doc are exposed to agents, in both servers', async () => {
  const { readFileSync } = await import('node:fs');
  const { MCP_TOOL_NAMES } = await import('./mcp-tools.js');
  assert.ok(MCP_TOOL_NAMES.includes('verify_doc'));
  const standalone = readFileSync(new URL('../../mcp/src/index.js', import.meta.url), 'utf8');
  assert.match(standalone, /registerTool\(\s*'verify_doc'/);
  assert.match(readFileSync(new URL('./mcp-tools.js', import.meta.url), 'utf8'), /`verification` says whether/);
});

test('verify_doc calls the verify route as the caller, resolving the owner by name', async () => {
  const { createMetanoiaMcpServer } = await import('./mcp-tools.js');
  const seen = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    seen.push({ url: String(url), method: init.method || 'GET', auth: init.headers?.Authorization, body: init.body });
    const data = String(url).endsWith('/users') ? [{ id: 'u9', name: 'Ada Lovelace', username: 'ada', email: 'ada@x.io' }] : { state: 'verified' };
    return { ok: true, status: 200, text: async () => JSON.stringify(data) };
  };
  try {
    const server = createMetanoiaMcpServer({ base: 'http://x', headers: { Authorization: 'Bearer t' } });
    await server._registeredTools.verify_doc.handler({ id: 'd1', every: 30, owner: 'ada' }, {});
    const put = seen.find((s) => s.method === 'PUT');
    assert.equal(put.url, 'http://x/api/docs/d1/verify');
    assert.equal(put.auth, 'Bearer t');
    assert.deepEqual(JSON.parse(put.body), { every: 30, ownerId: 'u9' });
    await server._registeredTools.verify_doc.handler({ id: 'd1', remove: true }, {});
    assert.equal(seen.at(-1).method, 'DELETE');
  } finally {
    globalThis.fetch = realFetch;
  }
});
