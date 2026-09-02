// The MetanoiaDocs tool surface, shared by every MCP transport.
//
// Tools call the workspace's own REST API rather than the database, so a tool
// can never see more than the caller's token already grants: the same route,
// the same auth, the same visibility rules. The caller's credentials arrive as
// headers and are forwarded verbatim.
//
// `mcp/` still ships a standalone stdio server for people who want to run one
// locally; server/src/mcp-http.test.js asserts the two tool lists stay
// identical, so this file and that one cannot drift apart unnoticed.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

const ok = (obj) => ({
  content: [{ type: 'text', text: typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2) }],
});
const fail = (e) => ({ isError: true, content: [{ type: 'text', text: `Error: ${e.message || e}` }] });

/**
 * @param {object} opts
 * @param {string} opts.base      Origin to call, no trailing slash (e.g. http://127.0.0.1:3000).
 * @param {Record<string,string>} opts.headers  Auth headers forwarded on every call.
 */
export function createMetanoiaMcpServer({ base, headers = {} }) {
  const origin = String(base || '').replace(/\/+$/, '');

  async function api(path, { method = 'GET', body } = {}) {
    const res = await fetch(`${origin}/api${path}`, {
      method,
      headers: {
        ...headers,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (!res.ok) throw new Error((data && data.error) || `HTTP ${res.status}`);
    return data;
  }

  const server = new McpServer({ name: 'metanoiadocs', version: '1.0.0' });

  server.registerTool(
    'search_docs',
    {
      title: 'Search docs',
      description:
        'Full-text search across the docs you can access. Returns id, title, and a snippet for each match.',
      inputSchema: { query: z.string().describe('Search terms') },
    },
    async ({ query }) => {
      try {
        const rows = await api(`/search?q=${encodeURIComponent(query)}`);
        return ok(
          rows.map((r) => ({
            id: r.id,
            title: r.title,
            snippet: (r.snippet || '').replace(/<\/?b>/g, ''),
          }))
        );
      } catch (e) {
        return fail(e);
      }
    }
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
        return ok(
          rows.map((r) => ({
            id: r.id,
            title: r.title,
            visibility: r.visibility,
            favorite: r.favorite,
            updated_at: r.updated_at,
          }))
        );
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    'read_doc',
    {
      title: 'Read a doc',
      description: "Get a doc's title and its plain-text content by id.",
      inputSchema: { id: z.string().describe('Document id') },
    },
    async ({ id }) => {
      try {
        return ok(await api(`/docs/${encodeURIComponent(id)}/text`));
      } catch (e) {
        return fail(e);
      }
    }
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
        visibility: z
          .enum(['team', 'private'])
          .optional()
          .describe('team (default) = whole workspace; private = only you'),
      },
    },
    async ({ title, content, visibility }) => {
      try {
        const doc = await api('/docs', { method: 'POST', body: { title, content, visibility } });
        return ok({ id: doc.id, title: doc.title, visibility: doc.visibility });
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    'write_doc',
    {
      title: 'Write to a doc',
      description:
        "Append or replace a doc's content with markdown. mode=append (default) adds to the end; mode=replace overwrites. Changes appear when the doc is next opened.",
      inputSchema: {
        id: z.string().describe('Document id'),
        markdown: z.string().describe('Markdown content'),
        mode: z.enum(['append', 'replace']).optional(),
      },
    },
    async ({ id, markdown, mode }) => {
      try {
        await api(`/docs/${encodeURIComponent(id)}/content`, {
          method: 'POST',
          body: { markdown, mode },
        });
        return ok('Done.');
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    'comment_on_doc',
    {
      title: 'Comment on a doc',
      description: 'Add a comment to a doc. Use @username to mention and notify a member.',
      inputSchema: {
        id: z.string().describe('Document id'),
        body: z.string().describe('Comment text'),
      },
    },
    async ({ id, body }) => {
      try {
        const r = await api(`/docs/${encodeURIComponent(id)}/comments`, {
          method: 'POST',
          body: { body },
        });
        return ok({ commentId: r.id });
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    'set_visibility',
    {
      title: 'Set doc visibility',
      description: 'Set a doc to team (everyone) or private (only you). You must own the doc.',
      inputSchema: { id: z.string(), visibility: z.enum(['team', 'private']) },
    },
    async ({ id, visibility }) => {
      try {
        await api(`/docs/${encodeURIComponent(id)}/visibility`, {
          method: 'PUT',
          body: { visibility },
        });
        return ok(`Set to ${visibility}.`);
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    'add_tag',
    {
      title: 'Tag a doc',
      description: 'Attach a tag to a doc (creates the tag if it does not exist).',
      inputSchema: { id: z.string(), name: z.string().describe('Tag name') },
    },
    async ({ id, name }) => {
      try {
        await api(`/docs/${encodeURIComponent(id)}/tags`, { method: 'POST', body: { name } });
        return ok(`Tagged with "${name}".`);
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    'list_members',
    {
      title: 'List members',
      description:
        'List workspace members (name, username, email, role) — useful for @-mentions, and for the email share_doc needs.',
      inputSchema: {},
    },
    async () => {
      try {
        const rows = await api('/users');
        return ok(
          rows.map((u) => ({ name: u.name, username: u.username, email: u.email, role: u.role }))
        );
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    'list_folders',
    {
      title: 'List folders',
      description:
        'List the workspace folders (id, name, parent, how many docs are in each). Use this to find the folder id that move_doc needs.',
      inputSchema: {},
    },
    async () => {
      try {
        const rows = await api('/folders');
        return ok(
          rows.map((f) => ({
            id: f.id,
            name: f.name,
            parentId: f.parent_id,
            documents: f.document_count,
          }))
        );
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    'move_doc',
    {
      title: 'Move a doc to a folder',
      description:
        'Move a doc into a folder, or out to the top level. Get folder ids from list_folders.',
      inputSchema: {
        id: z.string().describe('Document id'),
        folderId: z
          .string()
          .nullable()
          .optional()
          .describe('Destination folder id; null or omitted moves it to the top level'),
      },
    },
    async ({ id, folderId }) => {
      try {
        await api(`/docs/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          body: { folderId: folderId ?? null },
        });
        return ok(folderId ? 'Moved.' : 'Moved to the top level.');
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    'link_docs',
    {
      title: 'Nest one doc under another',
      description:
        "Link an existing doc under another one: a reference to the child is appended to the parent's body, and the child then appears nested under it in the sidebar. The parent must have been opened at least once.",
      inputSchema: {
        parentId: z.string().describe('The doc that gains the reference'),
        childId: z.string().describe('The doc to nest under it'),
      },
    },
    async ({ parentId, childId }) => {
      try {
        const r = await api(`/docs/${encodeURIComponent(parentId)}/links`, {
          method: 'POST',
          body: { childId },
        });
        return ok(r?.already ? 'Already linked.' : 'Linked.');
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    'share_doc',
    {
      title: 'Share a doc with a teammate',
      description:
        'Grant a workspace member editor access to a doc by their email. You must own the doc, and they must have signed in at least once. Use list_members to find the email.',
      inputSchema: {
        id: z.string().describe('Document id'),
        email: z.string().describe("The member's email address"),
      },
    },
    async ({ id, email }) => {
      try {
        await api(`/docs/${encodeURIComponent(id)}/share`, { method: 'POST', body: { email } });
        return ok(`Shared with ${email}.`);
      } catch (e) {
        return fail(e);
      }
    }
  );

  return server;
}

/** Tool names this server registers, in registration order. Used by the drift test. */
export const MCP_TOOL_NAMES = [
  'search_docs',
  'list_docs',
  'read_doc',
  'create_doc',
  'write_doc',
  'comment_on_doc',
  'set_visibility',
  'add_tag',
  'list_members',
  'list_folders',
  'move_doc',
  'link_docs',
  'share_doc',
];
