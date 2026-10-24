import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createMetanoiaMcpServer } from './mcp-tools.js';

// Calls a tool handler directly, with fetch stubbed to answer from `routes`.
async function call(name, args, routes) {
  const seen = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    seen.push({ url: String(url), method: init.method || 'GET', body: init.body && JSON.parse(init.body) });
    const path = String(url).replace(/^https?:\/\/[^/]+\/api/, '');
    const data = routes[path] ?? routes[path.split('?')[0]];
    return { ok: true, status: 200, text: async () => JSON.stringify(data) };
  };
  try {
    const server = createMetanoiaMcpServer({ base: 'http://x', headers: {} });
    const res = await server._registeredTools[name].handler(args, {});
    return { res, seen, data: JSON.parse(res.content[0].text) };
  } finally {
    globalThis.fetch = realFetch;
  }
}

const docs = [
  { id: 'a', title: 'A', visibility: 'team', favorite: false, updated_at: 't', space_id: 's1' },
  { id: 'b', title: 'B', visibility: 'team', favorite: false, updated_at: 't', space_id: 's2' },
];

test('list_docs: no spaceId returns everything, spaceId filters', async () => {
  const all = await call('list_docs', {}, { '/docs': docs });
  assert.deepEqual(all.data.map((d) => d.id), ['a', 'b']);
  const one = await call('list_docs', { spaceId: 's2' }, { '/docs': docs });
  assert.deepEqual(one.data.map((d) => d.id), ['b']);
});

test('create_doc sends spaceId in the body', async () => {
  const r = await call('create_doc', { title: 'T', spaceId: 's2' }, { '/docs': { id: 'n', title: 'T', visibility: 'team' } });
  assert.equal(r.seen[0].method, 'POST');
  assert.equal(r.seen[0].body.spaceId, 's2');
});

test('search_docs passes spaceId to the route', async () => {
  const r = await call('search_docs', { query: 'a b', spaceId: 's 1' }, { '/search': [] });
  assert.match(r.seen[0].url, /\/search\?q=a%20b&spaceId=s%201$/);
});

test('list_spaces maps to id, name, icon, description, joined', async () => {
  const r = await call('list_spaces', {}, {
    '/spaces': [{ id: 's1', name: 'General', icon: '🏠', description: 'd', is_default: true, member_count: 3, joined: true, position: 0 }],
  });
  assert.deepEqual(r.data, [{ id: 's1', name: 'General', icon: '🏠', description: 'd', joined: true }]);
});
