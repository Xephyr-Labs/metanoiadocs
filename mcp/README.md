# MetanoiaDocs MCP server

Exposes your MetanoiaDocs workspace to AI agents (Claude Desktop, Claude Code, Cursor, …)
over the [Model Context Protocol](https://modelcontextprotocol.io). The agent can search,
read, create, and edit your docs — **as you**, respecting team/private access.

## Tools

| Tool | What it does |
|---|---|
| `search_docs` | Full-text search → id, title, snippet |
| `list_docs` | List accessible docs |
| `read_doc` | A doc's title + plain-text content |
| `create_doc` | New doc from markdown (headings, lists, to-dos, quotes, code, dividers → real blocks) |
| `write_doc` | Append or replace a doc's content with markdown |
| `comment_on_doc` | Add a comment (supports `@username` mentions) |
| `set_visibility` | Switch a doc between team / private (owner only) |
| `add_tag` | Tag a doc |
| `list_members` | Workspace members (for @-mentions) |

## Setup

1. **Get a token** — in MetanoiaDocs: **Settings → API tokens → Create**. Copy it (shown once).
2. **Install:**
   ```bash
   cd mcp && npm install
   ```
3. **Configure your agent.** Point it at this server with two env vars:
   - `METANOIA_URL` — your instance, e.g. `https://docs.yourteam.com` (no trailing slash)
   - `METANOIA_TOKEN` — the token from step 1

### Claude Desktop / Claude Code (`claude_desktop_config.json` or MCP config)

```json
{
  "mcpServers": {
    "metanoiadocs": {
      "command": "node",
      "args": ["/absolute/path/to/metanoiadocs/mcp/src/index.js"],
      "env": {
        "METANOIA_URL": "https://docs.yourteam.com",
        "METANOIA_TOKEN": "mtn_xxxxxxxxxxxxxxxxxxxxxxxx"
      }
    }
  }
}
```

Restart the agent — the MetanoiaDocs tools appear.

## Notes

- Every action runs as the token's user; the token carries that user's permissions. Revoke it any time in Settings.
- `write_doc` / `create_doc` build real BlockSuite blocks from markdown. Writes to a doc that's *currently open* in someone's editor appear on their next open/reload.
- Transport is stdio (the agent spawns the process). No network service to host.
