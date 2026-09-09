/**
 * The tools the in-app copilot may call.
 *
 * Same loopback pattern as the MCP surface (mcp-tools.js): every tool calls
 * this server's own REST API carrying the caller's own cookie, so the copilot
 * gets exactly the access the signed-in user already has and adding a tool here
 * cannot create a second, weaker path to the data.
 *
 * It is a separate, much smaller table than the MCP one rather than a shared
 * abstraction: the schemas are a different shape (OpenAI function-calling JSON
 * vs MCP/zod), and a chat sidebar wants four tools where an agent wants
 * fourteen. Two short tables beat one indirection layer.
 */

/** A doc pasted whole into the prompt is mostly waste past this point. */
const MAX_DOC_CHARS = 12000;

const TOOLS = [
  {
    name: 'search_docs',
    description:
      'Full-text search across every doc this user can read. Use it to answer questions about documents other than the one open. Returns id, title and a matching snippet — read_doc for the full text.',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Search terms' } },
      required: ['query'],
    },
    call: (api, { query }) => api(`/search?q=${encodeURIComponent(String(query || ''))}`),
  },
  {
    name: 'read_doc',
    description: "Read a doc's full plain text by id. Get ids from search_docs.",
    parameters: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Document id' } },
      required: ['id'],
    },
    call: async (api, { id }) => {
      const d = await api(`/docs/${encodeURIComponent(String(id))}/text`);
      return { ...d, text: String(d?.text || '').slice(0, MAX_DOC_CHARS) };
    },
  },
  {
    name: 'write_doc',
    description:
      "Change a doc's content. mode=append (default) adds markdown to the end; mode=replace overwrites the whole body. Markdown headings, lists, to-dos, quotes and code fences become real editor blocks. Only call this when the user has asked for the document to be changed.",
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Document id' },
        markdown: { type: 'string', description: 'Markdown content' },
        mode: { type: 'string', enum: ['append', 'replace'] },
      },
      required: ['id', 'markdown'],
    },
    call: (api, { id, markdown, mode }) =>
      api(`/docs/${encodeURIComponent(String(id))}/content`, {
        method: 'POST',
        body: { markdown: String(markdown || ''), mode: mode === 'replace' ? 'replace' : 'append' },
      }),
  },
  {
    name: 'create_doc',
    description: 'Create a new document from a title and optional markdown body. Returns its id.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        content: { type: 'string', description: 'Markdown body (optional)' },
      },
      required: ['title'],
    },
    call: async (api, { title, content }) => {
      const d = await api('/docs', { method: 'POST', body: { title: String(title || 'Untitled'), content } });
      return { id: d?.id, title: d?.title };
    },
  },
];

/**
 * @param {object} opts
 * @param {string} opts.base     Origin to call, no trailing slash.
 * @param {Record<string,string>} opts.headers  Auth headers forwarded on every call.
 */
export function aiTools({ base, headers = {} }) {
  const origin = String(base || '').replace(/\/+$/, '');

  async function api(path, { method = 'GET', body } = {}) {
    const res = await fetch(`${origin}/api${path}`, {
      method,
      headers: { ...headers, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
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

  return {
    specs: TOOLS.map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.parameters },
    })),

    /**
     * Run one tool call. Never throws: a failure has to come back as a result
     * the model can read and recover from, not as an exception that kills the
     * stream the user is watching.
     */
    async run(name, argsJson) {
      const tool = TOOLS.find((t) => t.name === name);
      if (!tool) return { error: `unknown tool "${name}"` };
      let args;
      try {
        args = argsJson ? JSON.parse(argsJson) : {};
      } catch {
        return { error: 'arguments were not valid JSON' };
      }
      try {
        return await tool.call(api, args);
      } catch (e) {
        return { error: e.message || String(e) };
      }
    },
  };
}
