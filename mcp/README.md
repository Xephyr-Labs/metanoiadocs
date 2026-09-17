# MetanoiaDocs MCP server

Exposes your MetanoiaDocs workspace to AI agents (Claude Desktop, Claude Code, Cursor, …)
over the [Model Context Protocol](https://modelcontextprotocol.io). The agent can search,
read, create, and edit your docs **and work the task boards** — **as you**, respecting
team/private access.

## Tools

| Tool | What it does |
|---|---|
| `search_docs` | Full-text search → id, title, snippet |
| `list_docs` | List accessible docs |
| `list_folders` | Workspace folders (for `move_doc`) |
| `move_doc` | Move a doc into a folder, or out to the top level |
| `link_docs` | Nest one doc under another (parent gains a reference to it) |
| `share_doc` | Grant a member editor access by email (owner only) |
| `read_doc` | A doc's title + plain-text content |
| `create_doc` | New doc from markdown (headings, lists, to-dos, quotes, code, dividers → real blocks) |
| `write_doc` | Append or replace a doc's content with markdown |
| `comment_on_doc` | Add a comment (supports `@username` mentions) |
| `set_visibility` | Switch a doc between team / private (owner only) |
| `add_tag` | Tag a doc |
| `list_members` | Workspace members (for @-mentions and `share_doc`) |

### Task boards

| Tool | What it does |
|---|---|
| `list_boards` | The boards, with task / done / overdue counts |
| `create_board` | New board — `mode: tasks` (work) or `data` (a plain table) |
| `archive_board` | Archive a board, or restore one by id |
| `list_tasks` | Filter by assignee, board, status, overdue, due window, title |
| `create_task` | Add a task and assign it (assignees are notified) |
| `update_task` | Status, assignees, title, dates, progress, points, sprint |
| `delete_task` | Move a task and its page to the trash |
| `list_sprints` | A board's sprints, with task and point totals |
| `create_sprint` | Add a sprint (starts `planned`) |
| `update_sprint` | Rename, move dates, or set `planned` / `active` / `done` |
| `delete_sprint` | Remove a sprint; its tasks return to the backlog |
| `add_task_dependency` | Mark a task as blocked by another |
| `remove_task_dependency` | Drop that link |
| `workspace_overview` | The home dashboard as data — stats, your tasks, activity |

People and boards are named the way you would say them: `assignee: "sam"`, a
username, an email, or `board: "Lattu"`. An ambiguous name is refused rather
than guessed. Dates are `YYYY-MM-DD`, and a task due **today** is not overdue.

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
