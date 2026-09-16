# metanoiadocs-runner

Your MetanoiaDocs agent has a queue. This runs it on your machine.

Assign a task to an agent account — or `@mention` one in a comment — and the
work lands on a queue. This polls that queue, hands each run to a coding CLI
(Claude Code, Codex, opencode, GitHub Copilot CLI, or a command of your own),
and posts back what the CLI printed as a comment on the task's page.

Nothing here listens on a port. The workspace never reaches into your machine;
this reaches out. An agent behind a laptop firewall works exactly as well as one
on a server, and the instance never holds a key to anything of yours.

## Setup

**1. Make the agent an account.** Invite it like a person (Settings → Members →
Invite), sign in as it once, then have an admin mark it an agent: Settings →
Members → ⋯ → **Mark as an agent**. Its edits then carry a bot glyph everywhere
in the workspace, which is the point of marking it.

**2. Get its token.** Signed in as the agent, go to Settings → API tokens →
Create. It is shown once.

**3. Run it.**

```bash
npx metanoiadocs-runner \
  --url https://docs.example.com \
  --token mdp_… \
  --agent claude \
  --cwd ~/code/our-repo
```

Leave it running. Assign it something.

## Options

Every flag has an environment variable, so a systemd unit or a `.env` needs no
command line at all.

| Flag | Env | Default | |
|---|---|---|---|
| `--url` | `METANOIA_URL` | — | Your instance, no trailing slash |
| `--token` | `METANOIA_TOKEN` | — | The agent account's API token |
| `--agent` | `METANOIA_AGENT` | `claude` | `claude`, `codex`, `opencode`, `copilot` |
| `--command` | `METANOIA_COMMAND` | — | Run this instead of a preset |
| `--cwd` | `METANOIA_CWD` | `.` | Where to run it — usually your repo |
| `--interval` | `METANOIA_INTERVAL` | `10` | Seconds between polls when idle |
| `--timeout` | `METANOIA_TIMEOUT` | `30` | Minutes before a run is killed |
| `--once` | — | — | Take at most one run, then exit |

## The presets

Each preset is a program and the flags that make it run unattended. The prompt
always arrives on **stdin**, so a preset never has to quote anything.

| Preset | Command |
|---|---|
| `claude` | `claude -p --permission-mode acceptEdits` |
| `codex` | `codex exec -` |
| `opencode` | `opencode run` |
| `copilot` | `copilot -p --allow-all-tools` |

These are a starting point, not a contract — CLI flags move. If yours differs,
or you want something else entirely, `--command` replaces the lot:

```bash
npx metanoiadocs-runner --command "npx -y @you/your-agent --yolo"
```

Anything that reads a prompt on stdin and prints its answer works. A shell
script counts.

## What the agent is told

```markdown
# Fix the date picker

- Database: Web
- Status: todo · Type: bug
- Due: 2026-10-01

## The page

<the task's page, as text>

## What to do

This task has been assigned to you. Do it, then say what you did.

Reply with what you did, in Markdown. It is posted as a comment on the page.
```

An `@mention` replaces the last part with what was actually said, and who said
it. Everything is read fresh when the run is claimed, so a task renamed while it
sat in the queue arrives with its current name.

## Several agents

One process, one agent account. Run several — different accounts, different
repos, different CLIs — and they never see each other's work. Several processes
on the *same* account is also fine: each poll claims a different run, so two
runners on one account are just two lanes.

## If something goes wrong

- **`claude is not on your PATH`** — the preset names a CLI you have not
  installed. Install it, or point `--command` at what you do have.
- **`This token belongs to a person`** — the account has not been marked an
  agent. An admin does it in Settings → Members.
- **A run that never finishes** — the instance hands a claimed run back to the
  next poller after 30 minutes (`AGENT_RUN_STALE_MIN` on the server). Closing
  your laptop mid-run loses nothing.
- **The report failed but the work happened** — same rule: the run is still
  claimed, goes stale, and comes round again.

## Licence

MIT, like the rest of MetanoiaDocs.
