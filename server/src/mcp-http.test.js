import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import { MCP_TOOL_NAMES, createMetanoiaMcpServer } from './mcp-tools.js';

const standalone = fileURLToPath(new URL('../../mcp/src/index.js', import.meta.url));

test('MCP_TOOL_NAMES matches what the server actually registers', () => {
  const server = createMetanoiaMcpServer({ base: 'http://127.0.0.1:1', headers: {} });
  const registered = Object.keys(server._registeredTools ?? {});
  assert.deepEqual(registered.sort(), [...MCP_TOOL_NAMES].sort());
});

// The standalone stdio package in mcp/ is published on its own and cannot
// import this module (the Docker image only copies server/). A tool added to
// one and not the other means an agent sees a different surface depending on
// how it connected — this test is what stops that going unnoticed.
test('the standalone stdio package exposes the same tools', () => {
  const source = readFileSync(standalone, 'utf8');
  const names = [...source.matchAll(/server\.registerTool\(\s*'([a-z_]+)'/g)].map((m) => m[1]);
  assert.deepEqual(names.sort(), [...MCP_TOOL_NAMES].sort());
});

// A real client over the real transport. The wiring this proves — stateless
// transport, express.json() body hand-off, loopback call carrying the caller's
// own Authorization header — is exactly what a unit test of the tool functions
// would miss.
test('POST /mcp serves initialize, tools/list and a tool call', async (t) => {
  const express = (await import('express')).default;
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StreamableHTTPClientTransport } = await import(
    '@modelcontextprotocol/sdk/client/streamableHttp.js'
  );
  const { registerMcpRoute } = await import('./mcp-http.js');

  const app = express();
  app.use(express.json());
  let seenAuth = null;
  // Stand-in for the real API route the search_docs tool calls back into.
  app.get('/api/search', (req, res) => {
    seenAuth = req.headers.authorization ?? null;
    res.json([{ id: 'doc1', title: 'Retention policy', snippet: 'keep for <b>30</b> days' }]);
  });
  const requireUser = (req, res, next) =>
    req.headers.authorization ? next() : res.status(401).json({ error: 'unauthorized' });

  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const port = server.address().port;
  // Registered after listen only so the test knows the port; order does not
  // matter to express.
  registerMcpRoute(app, { requireUser, port });
  t.after(() => new Promise((r) => server.close(r)));

  const url = new URL(`http://127.0.0.1:${port}/mcp`);
  const unauthorized = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  assert.equal(unauthorized.status, 401, 'no credentials must not reach the tool surface');

  const client = new Client({ name: 'test', version: '0' }, { capabilities: {} });
  await client.connect(
    new StreamableHTTPClientTransport(url, {
      requestInit: { headers: { Authorization: 'Bearer test-token' } },
    })
  );
  t.after(() => client.close());

  const { tools } = await client.listTools();
  assert.deepEqual(
    tools.map((x) => x.name).sort(),
    [...MCP_TOOL_NAMES].sort()
  );

  const result = await client.callTool({ name: 'search_docs', arguments: { query: 'retention' } });
  assert.equal(result.isError, undefined);
  assert.match(result.content[0].text, /Retention policy/);
  assert.match(result.content[0].text, /keep for 30 days/, 'snippet markup is stripped');
  assert.equal(seenAuth, 'Bearer test-token', "the caller's own credentials are forwarded");
});
