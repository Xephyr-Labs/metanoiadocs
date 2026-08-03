#!/usr/bin/env node
// MetanoiaDocs MCP server. Exposes your MetanoiaDocs workspace to AI agents over
// stdio. Configure with two env vars:
//   METANOIA_URL   e.g. https://docs.yourteam.com   (no trailing slash)
//   METANOIA_TOKEN a personal access token (Settings → API tokens)
// Every tool runs as that token's user, respecting team/private access.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const BASE = (process.env.METANOIA_URL || '').replace(/\/+$/, '');
const TOKEN = process.env.METANOIA_TOKEN || '';
if (!BASE || !TOKEN) {
  console.error('metanoiadocs-mcp: set METANOIA_URL and METANOIA_TOKEN in the environment.');
  process.exit(1);
}

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const msg = (data && data.error) || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

const ok = (obj) => ({ content: [{ type: 'text', text: typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2) }] });
const fail = (e) => ({ isError: true, content: [{ type: 'text', text: `Error: ${e.message || e}` }] });

const server = new McpServer({ name: 'metanoiadocs', version: '1.0.0' });

server.registerTool(
  'search_docs',
  {
    title: 'Search docs',
    description: 'Full-text search across the docs you can access. Returns id, title, and a snippet for each match.',
    inputSchema: { query: z.string().describe('Search terms') },
  },
  async ({ query }) => {
    try {
      const rows = await api(`/search?q=${encodeURIComponent(query)}`);
      return ok(rows.map((r) => ({ id: r.id, title: r.title, snippet: (r.snippet || '').replace(/<\/?b>/g, '') })));
    } catch (e) { return fail(e); }
  },
);

server.registerTool(
  'list_docs',
  {
    title: 'List docs',
    description: 'List the docs you can access (id, title, visibility, favorite, last updated).',
    inputSchema: {},
  },
  async () => {
    try {
      const rows = await api('/docs');
      return ok(rows.map((r) => ({ id: r.id, title: r.title, visibility: r.visibility, favorite: r.favorite, updated_at: r.updated_at })));
    } catch (e) { return fail(e); }
  },
);

server.registerTool(
  'read_doc',
  {
    title: 'Read a doc',
    description: 'Get a doc\'s title and its plain-text content by id.',
    inputSchema: { id: z.string().describe('Document id') },
  },
  async ({ id }) => {
    try { return ok(await api(`/docs/${encodeURIComponent(id)}/text`)); } catch (e) { return fail(e); }
  },
);

server.registerTool(
  'create_doc',
  {
    title: 'Create a doc',
    description:
      'Create a new document. `content` is markdown — headings (#), bullet/numbered lists, to-dos (- [ ]), quotes (>), fenced code (```), and dividers (---) become real editor blocks. Returns the new doc id.',
    inputSchema: {
      title: z.string().describe('Document title'),
      content: z.string().optional().describe('Markdown body (optional)'),
      visibility: z.enum(['team', 'private']).optional().describe('team (default) = whole workspace; private = only you'),
    },
  },
  async ({ title, content, visibility }) => {
    try {
      const doc = await api('/docs', { method: 'POST', body: { title, content, visibility } });
      return ok({ id: doc.id, title: doc.title, visibility: doc.visibility });
    } catch (e) { return fail(e); }
  },
);

server.registerTool(
  'write_doc',
  {
    title: 'Write to a doc',
    description:
      'Append or replace a doc\'s content with markdown. mode=append (default) adds to the end; mode=replace overwrites. Changes appear when the doc is next opened.',
    inputSchema: {
      id: z.string().describe('Document id'),
      markdown: z.string().describe('Markdown content'),
      mode: z.enum(['append', 'replace']).optional(),
    },
  },
  async ({ id, markdown, mode }) => {
    try { await api(`/docs/${encodeURIComponent(id)}/content`, { method: 'POST', body: { markdown, mode } }); return ok('Done.'); }
    catch (e) { return fail(e); }
  },
);

server.registerTool(
  'comment_on_doc',
  {
    title: 'Comment on a doc',
    description: 'Add a comment to a doc. Use @username to mention and notify a member.',
    inputSchema: { id: z.string().describe('Document id'), body: z.string().describe('Comment text') },
  },
  async ({ id, body }) => {
    try { const r = await api(`/docs/${encodeURIComponent(id)}/comments`, { method: 'POST', body: { body } }); return ok({ commentId: r.id }); }
    catch (e) { return fail(e); }
  },
);

server.registerTool(
  'set_visibility',
  {
    title: 'Set doc visibility',
    description: 'Set a doc to team (everyone) or private (only you). You must own the doc.',
    inputSchema: { id: z.string(), visibility: z.enum(['team', 'private']) },
  },
  async ({ id, visibility }) => {
    try { await api(`/docs/${encodeURIComponent(id)}/visibility`, { method: 'PUT', body: { visibility } }); return ok(`Set to ${visibility}.`); }
    catch (e) { return fail(e); }
  },
);

server.registerTool(
  'add_tag',
  {
    title: 'Tag a doc',
    description: 'Attach a tag to a doc (creates the tag if it does not exist).',
    inputSchema: { id: z.string(), name: z.string().describe('Tag name') },
  },
  async ({ id, name }) => {
    try { await api(`/docs/${encodeURIComponent(id)}/tags`, { method: 'POST', body: { name } }); return ok(`Tagged with "${name}".`); }
    catch (e) { return fail(e); }
  },
);

server.registerTool(
  'list_members',
  {
    title: 'List members',
    description: 'List workspace members (name, username, role) — useful for @-mentions.',
    inputSchema: {},
  },
  async () => {
    try { const rows = await api('/users'); return ok(rows.map((u) => ({ name: u.name, username: u.username, role: u.role }))); }
    catch (e) { return fail(e); }
  },
);

await server.connect(new StdioServerTransport());
console.error('metanoiadocs-mcp connected via stdio →', BASE);
