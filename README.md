<div align="center">

<img src="assets/logo.svg" width="76" height="76" alt="" />

# MetanoiaDocs

**The docs and project workspace you run yourself.**

Real-time collaborative pages · boards, tables, gantt and calendars · comments that reach people ·<br/>an API and an agent queue for the machines. **Free, unlimited members, forever.**

<a href="https://github.com/Xephyr-Labs/metanoiadocs/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/Xephyr-Labs/metanoiadocs/actions/workflows/ci.yml/badge.svg"></a> <a href="https://hub.docker.com/r/hmsajjad/metanoiadocs"><img alt="Docker pulls" src="https://img.shields.io/docker/pulls/hmsajjad/metanoiadocs?logo=docker&label=docker%20pulls"></a> <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue.svg"></a> <img alt="Self-hosted" src="https://img.shields.io/badge/self--hosted-one%20container-brightgreen.svg"> <img alt="Seat limits: none" src="https://img.shields.io/badge/seat%20limits-none-blueviolet.svg">

<a href="https://railway.com/new/template?template=https%3A%2F%2Fgithub.com%2FXephyr-Labs%2Fmetanoiadocs"><img src="https://railway.com/button.svg" alt="Deploy on Railway" height="40" /></a> <a href="docs/coolify.md"><img src="assets/coolify-button.svg" alt="Deploy on Coolify" height="40" /></a> <a href="docs/helm.md"><img src="assets/kubernetes-button.svg" alt="Deploy on Kubernetes" height="40" /></a> <a href="#-quick-start"><img src="assets/docker-button.svg" alt="Self-host with Docker" height="40" /></a>

<sub><a href="#-quick-start">Quick start</a> · <a href="#%EF%B8%8F-deploy-it-somewhere">Deploy</a> · <a href="#-whats-in-the-box">Features</a> · <a href="server/openapi.yaml">API</a> · <a href="CONTRIBUTING.md">Contributing</a></sub>

</div>

<br/>

<p align="center">
  <img src="assets/screenshots/doc-comments.png" alt="A launch plan open in MetanoiaDocs, with a comment thread in the side panel" width="1000" />
</p>

MetanoiaDocs is an open-source alternative to Notion and AFFiNE that runs on your
own machine. It pairs the [BlockSuite](https://github.com/toeverything/blocksuite)
block editor with an original Node + Postgres backend: live multi-cursor editing,
projects with real task views, comments that reach people, and an MCP server and
run queue so your AI agents can work in the same place your team does — with **no
proprietary server code and no per-seat pricing, ever**.

One image, one Postgres, one port. `docker compose up -d` and invite the team.

---

## 👀 A look around

<table>
  <tr>
    <td width="50%" valign="top">
      <img src="assets/screenshots/home.png" alt="Home dashboard with recent pages, task counts, my tasks and team activity" />
      <p align="center"><sub><b>Home</b> — what you were doing, what's due, what the team just did.</sub></p>
    </td>
    <td width="50%" valign="top">
      <img src="assets/screenshots/board.png" alt="Kanban board with epics, stories and bugs across four columns" />
      <p align="center"><sub><b>Board</b> — epics, stories and bugs with points, progress and dependencies.</sub></p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <img src="assets/screenshots/gantt.png" alt="Gantt view with dependency arrows and a milestone" />
      <p align="center"><sub><b>Gantt</b> — hand-rolled, dependency arrows included, no third-party chart library.</sub></p>
    </td>
    <td width="50%" valign="top">
      <img src="assets/screenshots/table.png" alt="Editable task table with status, assignees, dates and progress" />
      <p align="center"><sub><b>Table</b> — every cell writes straight through. Multiple assignees per task.</sub></p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <img src="assets/screenshots/calendar.png" alt="Month calendar with multi-day task cards carrying status and area chips" />
      <p align="center"><sub><b>Calendar</b> — the whole span, not just the due date. Drag an edge to move it; weeks grow to fit.</sub></p>
    </td>
    <td width="50%" valign="top">
      <img src="assets/screenshots/inbox.png" alt="Inbox dialog listing an assignment and two comment mentions" />
      <p align="center"><sub><b>Inbox</b> — mentions, assignments and replies, in-app, by email, and as Web Push when the tab is closed.</sub></p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <img src="assets/screenshots/doc-dark.png" alt="The same launch plan in dark mode" />
      <p align="center"><sub><b>Dark mode</b> — full parity, one toggle (⌘J).</sub></p>
    </td>
    <td width="50%" valign="top" align="center">
      <img src="assets/screenshots/mobile-doc.png" alt="The launch plan on a phone" width="46%" />
      <img src="assets/screenshots/mobile-home.png" alt="Home on a phone" width="46%" />
      <p align="center"><sub><b>Phone</b> — the same app, responsive; installable as a PWA.</sub></p>
    </td>
  </tr>
</table>

<sub>Everything in these screenshots is a fictional demo workspace seeded for the README.</sub>

## ✨ What's in the box

| Area | What you get |
|---|---|
| **Write together** | Live multi-cursor pages over Yjs · a full block editor · threaded comments and @-mentions · version history you can restore from · a design canvas that files and searches like a document |
| **Plan the work** | Kanban, backlog, table, gantt, calendar and gallery over one set of tasks · sprints, points, dependencies, milestones · every project is a database and every row is a page · automations and quick actions |
| **Find and organise** | Nested pages, folders, tags, favorites and pins · hybrid full-text and fuzzy search behind ⌘K · related pages and extracted tasks computed in Postgres, with no LLM and no external calls |
| **Let the machines in** | An MCP server · a REST API with an OpenAPI description · signed webhooks · an agent run queue your own machine works · provenance on every write, so you can see which edits a machine made |
| **Run it yourself** | One container and one Postgres · a schema that migrates itself on boot · invite-only auth · Web Push · import and export · public read-only share links |

<details>
<summary><b>Write together</b> — the full list</summary>

<br/>

- **Real-time collaboration** — live multi-cursor editing and presence over Yjs (Hocuspocus). Open a page and you see where everyone already is, not just where they move next. No save button.
- **Rich block editor** — headings, lists, to-dos, tables, databases, code, LaTeX, images, embeds, toggles, columns, callouts, mermaid.
- **Reading controls** — Serif or Mono, smaller text, full width — per person, from the page menu.
- **Comments & @-mentions** — threaded, block-anchored; tag a teammate for an in-app, email, and push notification. Tag yourself to leave a reminder.
- **Version history** — automatic snapshots as you write; browse them rendered, restore in place (the restore is itself undoable), or open any version as a copy.
- **Designs** — a canvas beside the docs: shapes, connectors, frames, freehand, images, PNG export. A design *is* a document, so it shares, files, searches and versions like one.

</details>

<details>
<summary><b>Plan the work</b> — the full list</summary>

<br/>

- **Projects** — kanban, backlog, table, gantt, calendar and gallery over one set of tasks; sprints, epics/stories/bugs, points, dependencies, milestones, several assignees per task.
- **Tasks across projects** — one view of everything assigned to you, or anyone, filtered by project, status, kind, or the focus areas tagged on a task's page. Filters are chips; saved per view.
- **Deadline reminders** — a one-line summary of what is pending each morning, then a nudge the day before something is due, on the day, and every day it stays late. Whoever handed the work over hears about the day it lands and the days it slips, with the name of whoever is carrying it. In-app, push, and one email a day rather than one per task.
- **Databases** — a project is a database and every row is a page. Add columns (text, number, select, date, checkbox, person, URL, file, relation) and embed a live view of one in any document with `/database`.
- **Automations** — "when a task enters Done, set progress to 100 and move it to the active sprint". Rules run on a move a person made, never on each other, so two rules cannot loop. A rule set to run by hand is a quick action, offered as a button on every task.
- **Task ↔ page linking** — a task can link to the page that specifies it, and a page shows the tasks that point at it.

</details>

<details>
<summary><b>Find and organise</b> — the full list</summary>

<br/>

- **Sidebar** — nested pages, folders (each with its own page and link), colored tags, favorites, and team-wide pins.
- **Search** — hybrid full-text + fuzzy search, and a ⌘K palette for pages and commands.
- **Ambient intelligence** — per-doc related pages, tag and link suggestions, extracted tasks / decisions / deadlines, duplicate and stale detection. Computed in Postgres on save. **No LLM, no external calls.**
- **Import** — drop in `.md` or `.docx` (front matter, nested lists, tables, inline marks and images survive).
- **Export** — any page as **Markdown**, **Word** or **PDF**; any canvas as **PNG**.
- **Public share links** — publish any page read-only, enforced by the server.

</details>

<details>
<summary><b>Let the machines in</b> — the full list</summary>

<br/>

- **MCP server** — Claude Desktop/Code, Cursor and friends can search, read and write your docs *as you* over the [Model Context Protocol](https://modelcontextprotocol.io), stdio or remote HTTP. See [`mcp/`](mcp/).
- **Agents that take tasks** — assign a task to an agent account, or `@mention` one in a comment, and the work goes on a queue. [`runner/`](runner/) polls that queue on *your* machine and hands each run to Claude Code, Codex, opencode, Copilot CLI or any command of yours; the reply comes back as a comment. Nothing here reaches into your machine — the runner reaches out.
- **Webhooks** — POST every workspace event to a URL you control, signed with HMAC-SHA256 over a timestamped payload, retried, with a delivery log that says whether a hook quietly stopped working.
- **REST API** — the whole surface above, described in [`server/openapi.yaml`](server/openapi.yaml) and served by a running instance at `/api/openapi.yaml`.
- **AI governance** — every change records whether a person, an agent account, or the copilot made it, and the workspace shows which. See [AI governance](#-ai-governance).
- **AI assist** — optional OpenAI-compatible copilot with page context and tools, configured in Settings. Bring your own key; it is off by default.

</details>

<details>
<summary><b>Run it yourself</b> — the full list</summary>

<br/>

- **Invite-only auth** — username/password or magic link; admins invite by email.
- **One container** — serves the UI, the REST API and the `/sync` WebSocket from one origin. Postgres is the only dependency.
- **Idempotent schema** — created and migrated on every boot; there are no migration steps.
- **Web Push** — VAPID keys generate themselves on first use and live in the database.

</details>

## 🤖 AI governance

Agents and copilots write to this workspace. So the workspace records **who
wrote what** — and "who" has two different answers, because one column cannot
carry both.

**Which account.** An agent signs in with a personal access token and writes as
a normal user. Marking the account is enough to tell it apart, and only an admin
can do it — never on themselves. An account calling itself a person is the claim
worth protecting.

**Which hand.** Ask AI forwards *your* cookie and calls the same routes you do,
so there is no second account to mark: the edit is yours either way. Every write
therefore records whether you typed it or the copilot made it for you.

That flag is never taken from the client. A bare header would let any caller
stamp their edits "human", or blame the copilot for something it did not do — so
the copilot proves itself with a nonce minted at boot and never sent to a
browser. Anything else is a person, whatever it claims.

<table>
  <tr>
    <td width="50%" valign="top">
      <img src="assets/screenshots/ai-provenance.png" alt="Activity feed showing a sparkle beside an edit made with Ask AI and a bot glyph beside an agent account, with other entries unmarked" />
      <p align="center"><sub><b>Provenance</b> — a sparkle for a copilot edit, a bot for an agent account. A person typing gets no mark: the exception is the signal.</sub></p>
    </td>
    <td width="50%" valign="top">
      <img src="assets/screenshots/ai-governance.png" alt="Members settings with an agent account marked, and the admin menu open on Mark as a person" />
      <p align="center"><sub><b>Control</b> — admins see which accounts are agents and change it from the member list.</sub></p>
    </td>
  </tr>
</table>

Nothing here phones home. The marks are computed from your own database, and the
MCP server and copilot are both off until you turn them on.

## 🚀 Quick start

Requires [Docker](https://docs.docker.com/get-docker/) with Compose. Nothing to
clone, nothing to build — pull the published image:

```bash
curl -fsSL https://raw.githubusercontent.com/Xephyr-Labs/metanoiadocs/main/docker-compose.deploy.yml -o docker-compose.yml
docker compose up -d
```

Open **http://localhost:8092**. A fresh instance has no accounts, so the first
visit shows a **setup screen** — the account you create there is the admin.
Nobody can sign in before that, and the screen is gone the moment the admin exists.

<details>
<summary><b>Plain <code>docker run</code>, no Compose</b></summary>

```bash
docker pull hmsajjad/metanoiadocs:latest

docker network create metanoia

docker run -d --name metanoia-db --network metanoia \
  -e POSTGRES_USER=metanoia \
  -e POSTGRES_PASSWORD=change-me \
  -e POSTGRES_DB=metanoiadocs \
  -v metanoia-data:/var/lib/postgresql/data \
  postgres:16-alpine

docker run -d --name metanoiadocs --network metanoia -p 8092:3000 \
  -e DATABASE_URL=postgresql://metanoia:change-me@metanoia-db:5432/metanoiadocs \
  -e BASE_URL=http://localhost:8092 \
  hmsajjad/metanoiadocs:latest
```

The `metanoia-data` volume holds your documents — the containers are disposable,
that isn't. Already have a Postgres? Point `DATABASE_URL` at it, drop `--network`,
and give the database user rights to create tables.
</details>

<details>
<summary><b>Build from source</b></summary>

```bash
git clone https://github.com/Xephyr-Labs/metanoiadocs.git && cd metanoiadocs
cp .env.example .env
docker compose up -d --build
```

The bundled `docker-compose.yaml` builds the image locally instead of pulling it.
Unattended installs can skip the setup screen by setting `ADMIN_EMAIL` and
`ADMIN_PASSWORD` before the first boot.
</details>

To invite teammates: **Settings → Members → Invite** by email. With
`AUTH_DEV_MODE=true` (the default) the sign-in and invite links are printed to
`docker compose logs server`, so you can try the whole flow before wiring up SMTP.

For production, put a TLS reverse proxy (Caddy, nginx, Traefik) in front of `:8092`
and set `BASE_URL` to your `https://` domain. Push notifications need HTTPS.

## ☁️ Deploy it somewhere

<div align="center">

<a href="https://railway.com/new/template?template=https%3A%2F%2Fgithub.com%2FXephyr-Labs%2Fmetanoiadocs"><img src="https://railway.com/button.svg" alt="Deploy on Railway" height="40" /></a> <a href="docs/coolify.md"><img src="assets/coolify-button.svg" alt="Deploy on Coolify" height="40" /></a> <a href="docs/helm.md"><img src="assets/kubernetes-button.svg" alt="Deploy on Kubernetes" height="40" /></a> <a href="#-quick-start"><img src="assets/docker-button.svg" alt="Self-host with Docker" height="40" /></a>

</div>

<br/>

| Host | What you get | Guide |
|---|---|---|
| **Railway** | Railway builds the Dockerfile and runs it. Add a Postgres, point `DATABASE_URL` and `BASE_URL` at it, and there is no server to maintain. | [docs/railway.md](docs/railway.md) |
| **Coolify** | The same two containers on a box you own. Coolify generates the domain, the TLS certificate and the database password. | [docs/coolify.md](docs/coolify.md) |
| **Kubernetes** | One Deployment, one Service, optionally one Postgres — the chart in [`charts/metanoiadocs`](charts/metanoiadocs). | [docs/helm.md](docs/helm.md) |
| **Docker** | The quick start above. One image, one Postgres, one port. | [above](#-quick-start) |

Whichever you pick, set **`BASE_URL`** to the address people actually type. Emailed
sign-in links and Web Push notifications are both built from it, so a value that
does not match produces links that go nowhere.

## ⚙️ Configuration

Everything is an environment variable (see [`.env.example`](.env.example)):

| Variable | Default | Purpose |
|---|---|---|
| `DB_PASSWORD` | `metanoia` | Password for the bundled Postgres. Set it for real deployments. |
| `BASE_URL` | `http://localhost:8092` | Public URL used in emailed links and push notifications. |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | — | Together, create the admin at first boot instead of showing the setup screen. |
| `AUTH_DEV_MODE` | `true` | Log sign-in/invite links instead of emailing them. |
| `ALLOWED_EMAIL_DOMAINS` | `*` | Comma-separated allowlist for sign-in; `*` = any, empty = deny-all. |
| `TRASH_RETENTION_DAYS` | `30` | How long trashed pages are kept before they are purged. |
| `REMINDER_HOUR` | `8` | Hour of the server's day the task reminders and the daily summary go out. |
| `STALE_MONTHS` | `6` | A doc untouched this long gets a "stale" badge in the intelligence rail. |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | generated | Bring your own Web Push keys; otherwise a pair is made on first use and stored in the database. |
| `SMTP_HOST` … `SMTP_FROM` | — | SMTP for real emails, needed once `AUTH_DEV_MODE=false`. |
| `AGENT_RUN_STALE_MIN` | `30` | Minutes before a claimed agent run nobody reported on goes back on the queue. |

## 🧱 Architecture

```
                 ┌─────────────────────────── server (:8092) ───────────────────────────┐
Browser ── HTTPS ─┤  Express — REST API  ·  Hocuspocus /sync (Yjs)  ·  static React SPA   │
  AI agent ─ MCP ─┤  /mcp (streamable HTTP, personal API tokens)                          │
                 └───────────────────────────────┬──────────────────────────────────────┘
                                                 │
                                   Postgres (docs, Yjs state, tasks, users, push subscriptions …)
```

| Path | What it is |
|---|---|
| `web-react/` | React 18 + Vite + TypeScript + Tailwind + Radix; BlockSuite 0.22.4 editor; PWA with a push-capable service worker. |
| `server/` | Express + Postgres + Hocuspocus (Yjs) sync; magic-link/password auth; the intelligence layer (`intelligence.js`), search, exports, notifications and Web Push. |
| `mcp/` | Stdio MCP server exposing the workspace to AI agents via personal API tokens. The same tools are served over HTTP at `/mcp`. |
| `runner/` | Zero-dependency CLI that runs an agent account's queued work on your own machine. `npx metanoiadocs-runner`. |
| `charts/` | Helm chart — one Deployment, one Service, optionally one Postgres. |
| `docker-compose.yaml` | `db` + `server`, building the image from source. |
| `docker-compose.deploy.yml` | The same stack pulling the published [`hmsajjad/metanoiadocs`](https://hub.docker.com/r/hmsajjad/metanoiadocs) image — the one-command deploy above. |

Per-doc intelligence signals are computed synchronously on each save and
backfilled for existing docs on the first boot after upgrading.

## 🛠️ Development

Run the two halves directly, with hot reload:

```bash
# 1. Postgres (or the compose one):  docker compose up -d db
# 2. API + sync
cd server && npm install && DATABASE_URL=postgres://… npm start   # :8092
# 3. UI — the Vite dev server proxies /api and /sync to :8092
cd web-react && npm install && npm run dev                        # :5173
```

Tests: `npm test` in `web-react/` (vitest) and `node --test src/*.test.js` in
`server/`. CI runs both and publishes the image on every merge to `main`.

Design work in this repo follows a small written system — one type family, a
neutral chrome with the accent reserved for meaning, every control designed for
all its states. The tokens live in `web-react/src/index.css`.

## 📱 Mobile

MetanoiaDocs is a responsive web app. Add it to your home screen as a **PWA** —
the shell works offline and push notifications arrive with the app closed. The
same build can be wrapped with Capacitor for the app stores. (The editor core is
web-only, so a React Native port isn't practical.)

## 🤝 Contributing

Issues and PRs are welcome — bug fixes, features, docs, all of it.
[CONTRIBUTING.md](CONTRIBUTING.md) covers the setup, what the code looks like
and how a change gets merged. Be kind; we follow a
[Code of Conduct](CODE_OF_CONDUCT.md).

Found a vulnerability? Report it privately — see [SECURITY.md](SECURITY.md), not
a public issue.

## 📄 License

[MIT](LICENSE) © Xephyr Labs and the MetanoiaDocs contributors.
Bundles [BlockSuite](https://github.com/toeverything/blocksuite) (MIT) — see [NOTICE](NOTICE).
