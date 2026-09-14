import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { aiTools } from './ai-tools.js';
import { MCP_TOOL_NAMES } from './mcp-tools.js';

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

test('the copilot is offered the whole MCP surface, not a second smaller table', async () => {
  await withServer(
    (_req, res) => json(res, []),
    async (base) => {
      const tools = aiTools({ base });
      try {
        const specs = await tools.specs();
        assert.deepEqual(specs.map((s) => s.function.name).sort(), [...MCP_TOOL_NAMES].sort());
        const search = specs.find((s) => s.function.name === 'search_docs');
        assert.equal(search.type, 'function');
        assert.equal(search.function.parameters.type, 'object');
        assert.ok(search.function.parameters.properties.query, 'the schema survives the conversion');
        assert.ok(!('$schema' in search.function.parameters), 'draft keywords some providers reject');
      } finally {
        await tools.close();
      }
    },
  );
});

test('a tool call becomes an API call carrying the caller’s cookie', async () => {
  await withServer(
    (_req, res) => json(res, [{ id: 'd1', title: 'Roadmap', snippet: 'ship <b>search</b>' }]),
    async (base, seen) => {
      const tools = aiTools({ base, headers: { Cookie: 'md_session=abc' } });
      try {
        const out = await tools.run('search_docs', JSON.stringify({ query: 'ship it' }));
        assert.equal(seen[0].url, '/api/search?q=ship%20it');
        assert.equal(seen[0].cookie, 'md_session=abc', 'the user’s own access, not the server’s');
        assert.equal(out[0].id, 'd1');
        assert.equal(out[0].snippet, 'ship search', 'search markup is not for the model');
      } finally {
        await tools.close();
      }
    },
  );
});

test('read_doc truncates, so one huge doc cannot eat the whole context', async () => {
  await withServer(
    (_req, res) => json(res, { id: 'd1', title: 'Big', text: 'x'.repeat(50000) }),
    async (base) => {
      const tools = aiTools({ base });
      try {
        const out = await tools.run('read_doc', JSON.stringify({ id: 'd1' }));
        assert.equal(out.text.length, 12000);
        assert.equal(out.title, 'Big');
      } finally {
        await tools.close();
      }
    },
  );
});

test('write_doc leaves the mode to the API, which appends unless told otherwise', async () => {
  await withServer(
    (_req, res) => json(res, { ok: true }),
    async (base, seen) => {
      const tools = aiTools({ base });
      try {
        await tools.run('write_doc', JSON.stringify({ id: 'd1', markdown: '# Hi' }));
        assert.equal(seen[0].url, '/api/docs/d1/content');
        assert.notEqual(JSON.parse(seen[0].body).mode, 'replace', 'never overwrite by default');
        await tools.run('write_doc', JSON.stringify({ id: 'd1', markdown: 'x', mode: 'replace' }));
        assert.equal(JSON.parse(seen[1].body).mode, 'replace');
      } finally {
        await tools.close();
      }
    },
  );
});

test('a failing call comes back as a result the model can read, not a throw', async () => {
  await withServer(
    (_req, res) => json(res, { error: 'forbidden' }, 403),
    async (base) => {
      const tools = aiTools({ base });
      try {
        assert.deepEqual(await tools.run('read_doc', '{"id":"nope"}'), { error: 'forbidden' });
        assert.match((await tools.run('read_doc', '{bad json')).error, /valid JSON/);
        assert.match((await tools.run('no_such_tool', '{}')).error, /no_such_tool/);
      } finally {
        await tools.close();
      }
    },
  );
});
