import test from 'node:test';
import assert from 'node:assert/strict';
import { parseGitHubUrl, fetchGitHubItem, registerGitHubRoutes } from './github.js';

test('only canonical GitHub issue/PR URLs are accepted', () => {
  assert.deepEqual(parseGitHubUrl('https://github.com/acme/docs/pull/42#discussion'), {
    owner: 'acme', repo: 'docs', kind: 'pull', number: 42, url: 'https://github.com/acme/docs/pull/42',
  });
  for (const url of ['http://github.com/a/b/issues/1', 'https://github.com.evil.test/a/b/issues/1', 'https://user@github.com/a/b/issues/1', 'https://github.com/a/b/issues/0', 'https://github.com/a/b/issues/1/more', 'https://github.com/a/b/issues/9007199254740993', 'https://github.com/a/%2e%2e/issues/1']) {
    assert.throws(() => parseGitHubUrl(url), /GitHub/);
  }
});

test('fetch is restricted to api.github.com and never follows redirects', async () => {
  const calls = [];
  const item = await fetchGitHubItem(parseGitHubUrl('https://github.com/acme/docs/issues/3'), {
    fetchImpl: async (url, opts) => { calls.push({ url, opts }); return { ok: true, json: async () => ({ title: 'Fix editor', state: 'open', html_url: 'https://evil.test' }) }; },
  });
  assert.equal(calls[0].url, 'https://api.github.com/repos/acme/docs/issues/3');
  assert.equal(calls[0].opts.redirect, 'error');
  assert.equal(item.url, 'https://github.com/acme/docs/issues/3');
  assert.equal(item.title, 'Fix editor');
  assert.equal(item.state, 'open');
});

test('workspace token is only sent to explicitly allowed repositories', async () => {
  let called = false;
  await assert.rejects(fetchGitHubItem(parseGitHubUrl('https://github.com/other/repo/issues/1'), {
    env: { GITHUB_TOKEN: 'secret', GITHUB_REPOSITORIES: 'acme/docs' },
    fetchImpl: async () => { called = true; },
  }), /allowed/);
  assert.equal(called, false);
  await fetchGitHubItem(parseGitHubUrl('https://github.com/Acme/docs/issues/1'), {
    env: { GITHUB_TOKEN: 'secret', GITHUB_REPOSITORIES: 'acme/docs' },
    fetchImpl: async (_url, opts) => {
      assert.equal(opts.headers.Authorization, 'Bearer secret');
      return { ok: true, json: async () => ({ title: 'Private issue', state: 'closed' }) };
    },
  });
});

test('pull requests carry merge/draft and latest reviewer counts', async () => {
  const responses = [
    { title: 'Ship', state: 'open', draft: false, requested_reviewers: [{ login: 'ana' }], merged: false },
    [{ user: { login: 'bob' }, state: 'CHANGES_REQUESTED', submitted_at: '2026-11-01' },
      { user: { login: 'bob' }, state: 'APPROVED', submitted_at: '2026-11-02' },
      { user: { login: 'cat' }, state: 'CHANGES_REQUESTED', submitted_at: '2026-11-03' }],
  ];
  const item = await fetchGitHubItem(parseGitHubUrl('https://github.com/acme/docs/pull/4'), {
    fetchImpl: async () => ({ ok: true, json: async () => responses.shift(), headers: new Headers() }),
  });
  assert.equal(item.state, 'open');
  assert.deepEqual(item.reviews, { approved: 1, changesRequested: 1, requested: 1, partial: false });
});

test('GitHub errors never echo response bodies or credentials', async () => {
  for (const status of [401, 403, 404, 429, 500]) {
    await assert.rejects(fetchGitHubItem(parseGitHubUrl('https://github.com/acme/docs/issues/1'), {
      fetchImpl: async () => ({ ok: false, status, json: async () => ({ message: 'secret' }) }),
    }), (e) => !e.message.includes('secret') && e.status >= 400);
  }
});

function harness({ task = { id: 't1' }, grant = 'editor' } = {}) {
  const routes = {}; const queries = [];
  const app = Object.fromEntries(['get', 'post', 'delete'].map((verb) => [verb, (path, ...handlers) => { routes[`${verb} ${path}`] = handlers.at(-1); }]));
  registerGitHubRoutes(app, {
    requireUser() {}, needsPerson() {}, wrap: (fn) => fn,
    grantOn: async () => grant,
    pool: { query: async (sql, params) => {
      queries.push({ sql, params });
      if (sql.includes('FROM tasks')) return { rows: task ? [task] : [] };
      return { rows: [] };
    } },
    fetchImpl: async () => ({ ok: true, json: async () => ({ title: 'Issue', state: 'open' }) }),
    env: {},
  });
  const res = { statusCode: 200, status(n) { this.statusCode = n; return this; }, json(body) { this.body = body; return this; } };
  return { routes, queries, res };
}

test('missing tasks cannot acquire links', async () => {
  const h = harness({ task: null });
  await h.routes['post /api/tasks/:id/github']({ params: { id: 'missing' }, user: { id: 'u' }, body: { url: 'https://github.com/a/b/issues/1' } }, h.res);
  assert.equal(h.res.statusCode, 404);
  assert.equal(h.queries.some((q) => q.sql.includes('INSERT')), false);
});

test('task pages with view-only access cannot be linked', async () => {
  const h = harness({ task: { id: 't1', doc_id: 'private' }, grant: 'viewer' });
  await h.routes['post /api/tasks/:id/github']({ params: { id: 't1' }, user: { id: 'u' }, body: { url: 'https://github.com/a/b/issues/1' } }, h.res);
  assert.equal(h.res.statusCode, 403);
  assert.equal(h.queries.some((q) => q.sql.includes('INSERT')), false);
});

test('inaccessible task pages cannot disclose linked metadata', async () => {
  const h = harness({ task: { id: 't1', doc_id: 'private' }, grant: null });
  await h.routes['get /api/tasks/:id/github']({ params: { id: 't1' }, user: { id: 'u' } }, h.res);
  assert.equal(h.res.statusCode, 404);
});
