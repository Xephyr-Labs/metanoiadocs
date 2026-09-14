/**
 * The tools the in-app copilot may call.
 *
 * These are not a second, smaller tool table — they are *the* MCP surface
 * (mcp-tools.js), the same one Claude and any other MCP client get at POST
 * /mcp. The copilot connects to it over an in-memory transport, so a tool
 * added for MCP is a tool the copilot can use the same day, with one
 * description to keep honest instead of two that drift.
 *
 * Access is unchanged by this: every MCP tool calls this server's own REST API
 * carrying the caller's own cookie, so the copilot gets exactly what the
 * signed-in user already has.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { createMetanoiaMcpServer } from './mcp-tools.js';

/** A doc pasted whole into the prompt is mostly waste past this point. */
const MAX_TOOL_CHARS = 12000;

/**
 * JSON Schema the MCP SDK emits carries draft keywords ($schema, additionalProperties)
 * that some OpenAI-compatible providers reject outright rather than ignore.
 * Function-calling only needs the shape.
 */
function toFunctionParameters(schema) {
  const { $schema, additionalProperties, ...rest } = schema || {};
  return { type: 'object', properties: {}, ...rest };
}

/**
 * @param {object} opts
 * @param {string} opts.base     Origin to call, no trailing slash.
 * @param {Record<string,string>} opts.headers  Auth headers forwarded on every call.
 */
export function aiTools({ base, headers = {} }) {
  let server = null;
  let client = null;
  let connecting = null;

  function connect() {
    if (connecting) return connecting;
    connecting = (async () => {
      server = createMetanoiaMcpServer({ base, headers });
      const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
      client = new Client({ name: 'metanoiadocs-copilot', version: '1.0.0' });
      await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
      return client;
    })();
    return connecting;
  }

  return {
    /** Every MCP tool, as OpenAI function-calling specs. */
    async specs() {
      const c = await connect();
      const { tools } = await c.listTools();
      return tools.map((t) => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: toFunctionParameters(t.inputSchema),
        },
      }));
    },

    /**
     * Run one tool call. Never throws: a failure has to come back as a result
     * the model can read and recover from, not as an exception that kills the
     * stream the user is watching.
     */
    async run(name, argsJson) {
      let args;
      try {
        args = argsJson ? JSON.parse(argsJson) : {};
      } catch {
        return { error: 'arguments were not valid JSON' };
      }
      try {
        const c = await connect();
        const result = await c.callTool({ name, arguments: args });
        const text = (result.content || [])
          .filter((p) => p.type === 'text')
          .map((p) => p.text)
          .join('\n');
        if (result.isError) return { error: text.replace(/^Error:\s*/, '') || 'tool failed' };
        let out;
        try {
          out = JSON.parse(text);
        } catch {
          return { text: text.slice(0, MAX_TOOL_CHARS) };
        }
        // read_doc hands back a whole document; one long one must not eat the
        // context every later round needs.
        if (out && typeof out.text === 'string') out.text = out.text.slice(0, MAX_TOOL_CHARS);
        return out;
      } catch (e) {
        return { error: e.message || String(e) };
      }
    },

    /** Tear the in-memory pair down with the request that opened it. */
    async close() {
      if (!connecting) return;
      try {
        await connecting;
      } catch {
        /* never connected — nothing to close */
      }
      await Promise.allSettled([client?.close(), server?.close()]);
    },
  };
}
