import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { aiTools } from './ai-tools.js';

/** A stand-in for the real API: records what it was asked, answers what it's told. */
async function withServer(handler, fn) {
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, body, cookie: req.headers.cookie });
      handler(req, res, body);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    return await fn(`http://127.0.0.1:${server.address().port}`, seen);
  } finally {
    server.close();
  }
}

const json = (res, obj, code = 200) => {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
};

test('a tool call becomes an API call carrying the caller’s cookie', async () => {
  await withServer(
    (_req, res) => json(res, [{ id: 'd1', title: 'Roadmap', snippet: 'ship <b>search</b>' }]),
    async (base, seen) => {
      const tools = aiTools({ base, headers: { Cookie: 'md_session=abc' } });
      const out = await tools.run('search_docs', JSON.stringify({ query: 'ship it' }));
      assert.equal(seen[0].url, '/api/search?q=ship%20it');
      assert.equal(seen[0].cookie, 'md_session=abc', 'the user’s own access, not the server’s');
      assert.equal(out[0].id, 'd1');
    },
  );
});

test('read_doc truncates, so one huge doc cannot eat the whole context', async () => {
  await withServer(
    (_req, res) => json(res, { id: 'd1', title: 'Big', text: 'x'.repeat(50000) }),
    async (base) => {
      const out = await aiTools({ base }).run('read_doc', JSON.stringify({ id: 'd1' }));
      assert.equal(out.text.length, 12000);
      assert.equal(out.title, 'Big');
    },
  );
});

test('write_doc defaults to append rather than overwriting the user’s doc', async () => {
  await withServer(
    (_req, res) => json(res, { ok: true }),
    async (base, seen) => {
      const tools = aiTools({ base });
      await tools.run('write_doc', JSON.stringify({ id: 'd1', markdown: '# Hi' }));
      assert.deepEqual(JSON.parse(seen[0].body), { markdown: '# Hi', mode: 'append' });
      await tools.run('write_doc', JSON.stringify({ id: 'd1', markdown: 'x', mode: 'replace' }));
      assert.equal(JSON.parse(seen[1].body).mode, 'replace');
    },
  );
});

test('a failing call comes back as a result the model can read, not a throw', async () => {
  await withServer(
    (_req, res) => json(res, { error: 'forbidden' }, 403),
    async (base) => {
      const tools = aiTools({ base });
      assert.deepEqual(await tools.run('read_doc', '{"id":"nope"}'), { error: 'forbidden' });
      assert.match((await tools.run('read_doc', '{bad json')).error, /valid JSON/);
      assert.match((await tools.run('no_such_tool', '{}')).error, /unknown tool/);
    },
  );
});
