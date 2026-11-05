// Remote MCP endpoint: POST /mcp, streamable HTTP.
//
// Why this exists: the stdio server in mcp/ can only be used by something that
// can spawn a process on the same host. A hosted agent platform (Bahini, Claude
// web, anything multi-tenant) can only connect *out* over HTTP, so without this
// route the workspace is unreachable to them.
//
// Stateless by design — a fresh McpServer and transport per request, no session
// table. Each request carries its own credentials, several server replicas can
// serve the same client, and there is no session to leak or expire.

import express from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import { createMetanoiaMcpServer } from './mcp-tools.js';
import { zoneOf } from './timezone.js';

/**
 * The app-wide JSON parser, except on /mcp. Its 100 KB limit would refuse
 * upload_attachment (a base64 file inside a tool call) long before the file
 * cap; /mcp gets its own larger parser in registerMcpRoute.
 */
const globalJson = express.json();
export const jsonUnlessMcp = (req, res, next) => (req.path === '/mcp' ? next() : globalJson(req, res, next));

/** 15 MB: a 10 MB attachment is ~13.4 MB of base64. */
const mcpJson = express.json({ limit: '15mb' });

/** A body the parser refused is the client's mistake: say so (413 for too large), not 500. */
export function bodyError(err, _req, res, next) {
  const status = Number(err?.status);
  if (status >= 400 && status < 500 && !res.headersSent) {
    return res.status(status).json({ error: status === 413 ? 'Request body too large.' : 'Bad request body.' });
  }
  return next(err);
}

export function registerMcpRoute(app, { requireUser, port }) {
  const base = `http://127.0.0.1:${port}`;

  // Every tool call is a loopback call back through this same API, carrying the
  // caller's own credentials. That is deliberate: the MCP surface gets exactly
  // the authorization the REST routes already enforce, and adding a route later
  // does not create a second, weaker path to the same data.
  const handle = async (req, res) => {
    const headers = {};
    if (req.headers.authorization) headers.Authorization = req.headers.authorization;
    if (req.headers.cookie) headers.Cookie = req.headers.cookie;

    const server = createMetanoiaMcpServer({ base, headers, zone: zoneOf(req.user) });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    // Close both when the client hangs up, or a long-lived SSE reply leaks the
    // server object for as long as the process lives.
    res.on('close', () => {
      transport.close().catch(() => {});
      server.close().catch(() => {});
    });
    try {
      await server.connect(transport);
      // express.json() already consumed the body; the transport cannot re-read
      // the stream, so hand it the parsed object.
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error('[mcp] request failed', err?.message || err);
      if (!res.headersSent) res.status(500).json({ error: 'mcp request failed' });
    }
  };

  app.post('/mcp', requireUser, mcpJson, handle);

  // Stateless mode has no server-initiated stream and no session to delete.
  // Answer rather than fall through to the SPA catch-all, which would hand an
  // MCP client an HTML page and a very confusing parse error.
  const noStream = (_req, res) =>
    res.status(405).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed. This endpoint is stateless: use POST.' },
      id: null,
    });
  app.get('/mcp', noStream);
  app.delete('/mcp', noStream);
}
