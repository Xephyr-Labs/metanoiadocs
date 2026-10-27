import test from 'node:test';
import assert from 'node:assert/strict';
import { recordOpen, registerDocOpenRoutes } from './doc-opens.js';

test('recordOpen issues one upsert that refreshes opened_at', async () => {
  const calls = [];
  await recordOpen({ query: async (sql, p) => { calls.push([sql, p]); } }, 'u1', 'd1');
  assert.equal(calls.length, 1);
  assert.match(calls[0][0], /INSERT INTO doc_opens/);
  assert.match(calls[0][0], /ON CONFLICT \(user_id, doc_id\) DO UPDATE SET opened_at = now\(\)/);
  assert.deepEqual(calls[0][1], ['u1', 'd1']);
});

function run(grant) {
  const routes = {};
  const calls = [];
  const app = { post: (path, ...h) => { routes[path] = h[h.length - 1]; } };
  registerDocOpenRoutes(app, {
    requireUser: () => {}, wrap: (fn) => fn,
    pool: { query: async (sql) => { calls.push(sql); } },
    grantOn: async () => grant,
  });
  const res = { code: null, status(c) { this.code = c; return this; }, json() { return this; }, end() { return this; } };
  return routes['/api/docs/:id/opened']({ params: { id: 'd1' }, user: { id: 'u1' } }, res).then(() => ({ res, calls }));
}

test('opened route: 403 without a grant, nothing written', async () => {
  const { res, calls } = await run(null);
  assert.equal(res.code, 403);
  assert.equal(calls.length, 0);
});

test('opened route: 204 with a grant, one upsert', async () => {
  const { res, calls } = await run('viewer');
  assert.equal(res.code, 204);
  assert.equal(calls.length, 1);
});
