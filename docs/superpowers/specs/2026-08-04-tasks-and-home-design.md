# Tasks module + Home dashboard — design

Date: 2026-08-04

## Problem

Two gaps:

1. Project management lives outside the product. A separate `taskgantt` Node
   service on the Affine VM decodes Yjs blobs out of Postgres and renders a
   gantt, dashboard, my-tasks and calendar. It is read-only by construction —
   Affine has no generic CRDT write path — so every edit means opening the
   source doc. It also duplicates auth, users and styling.
2. There is no home. On sign-in the app drops the user straight into a
   document: `applyRows()` picks `mn-last-doc`, else the first root doc
   (`web-react/src/store/workspace.tsx`). There is no place that answers "what
   happened, what is mine, what was I doing".

Kaneo (github.com/usekaneo/kaneo) is the reference for shape: projects hold
tasks, tasks carry status/assignee/dates, views are board-first.

## Decisions

- **Tasks are first-class Postgres rows**, not Yjs cells. metanoiadocs owns its
  database, so a plain REST table gets editable board/table/gantt/calendar with
  no CRDT machinery and no schema-drift risk on a BlockSuite bump.
- **Existing boards are imported once** from metanoiadocs' *own* `doc_states`
  (the migrated docs already carry the `affine:database` blocks). The Affine
  deployment and the `taskgantt` service are not touched and keep running.
- **Activity is derived**, not logged. A UNION over existing tables gives a feed
  that works retroactively over all migrated content and adds no write to the
  hot save path. The one gap — plain doc saves have no actor — is closed with a
  single `docs.updated_by` column, not an audit table.
- **No new frontend dependency.** No router (a `view` field in the workspace
  store), no gantt library (CSS grid + one SVG overlay).

## Schema

Appended to `initSchema()` in `server/src/db.js`, idempotent like the rest.

```sql
projects(id, name, icon, color, doc_id→docs, position,
         created_by→users, created_at, archived_at)

tasks(id, project_id→projects CASCADE, title,
      status 'todo'|'doing'|'review'|'done',
      assignee_id→users, start_at, due_at,
      priority, progress 0-100, points, milestone bool,
      doc_id→docs, parent_id→tasks CASCADE, position,
      created_by, created_at, updated_at, done_at, deleted_at)

task_deps(task_id→tasks CASCADE, depends_on_id→tasks CASCADE, PK both)

ALTER TABLE docs ADD COLUMN updated_by → users
```

Four fixed statuses, not per-project custom columns. Custom columns get added
when someone asks for them.

Indexes: `tasks(project_id, status, position)`, `tasks(assignee_id, due_at)`
where not deleted, `task_deps(depends_on_id)`.

## Server

`server/src/index.js` is already ~1350 lines. Two new modules register their own
routes rather than growing it.

**`server/src/tasks.js`**

| Route | Purpose |
|---|---|
| `GET/POST /api/projects` | list (with task counts) / create |
| `PATCH/DELETE /api/projects/:id` | rename, recolor, archive |
| `GET /api/projects/:id/tasks` | board payload incl. deps |
| `GET /api/tasks?assignee=me&due=week&status=` | cross-project queries |
| `POST /api/tasks` | create |
| `PATCH /api/tasks/:id` | status, assignee, dates, progress, position — drag-drop is this |
| `DELETE /api/tasks/:id` | soft delete |
| `POST/DELETE /api/tasks/:id/deps` | dependency edges |

`PATCH` sets `done_at` when status flips to/from `done`, and rejects a
dependency edge that would close a cycle.

**`server/src/home.js`** — `GET /api/home`, one round trip for the whole
dashboard:

```
{ stats, myTasks: {overdue, today, week}, recentDocs, activity, projects }
```

`activity` is a UNION ALL over `doc_versions` (actor = `created_by`),
`comments`, `tasks` (created / status change), and `docs` (created, and updated
via the new `updated_by`), ordered by timestamp, limit 30.

## Import

`server/src/board-decode.js` — ESM port of `/opt/taskgantt/decode.js`. Same Yjs
walk: find the `affine:database` block with date columns, read
`prop:columns` / `prop:cells` / `sys:children`, resolve select options and
dependency names. One change: rows without dates are kept (they belong on the
board even if not on the gantt).

`server/scripts/import-boards.mjs` — reads local `doc_states`, one doc with a
dated database block becomes one project (`projects.doc_id` = that doc).
Idempotent on `doc_id`; `--dry-run` prints the plan; `--force` re-imports.
Assignee cells hold *Affine* user ids that do not exist locally, so they are
resolved through an optional `--assignee-map` JSON and otherwise left NULL and
reported.

## Frontend

**Navigation.** `workspace.tsx` gains `view: 'home' | 'doc' | 'project'` and
`activeProjectId`. `select(docId)` switches to `'doc'`. Boot lands on `'home'`
unconditionally; `mn-last-doc` survives only as the "Continue where you left
off" card. `App.tsx` switches the main surface on `view`. Sidebar gains a Home
row and a Projects section.

**Home** (`components/home/`) — card grid:

- stat tiles: my open · overdue · due this week · docs touched this week
- Jump back in — recent doc cards
- My tasks — grouped overdue / today / this week
- Activity — who did what, when, click-through to doc or task
- Projects — cards with a progress ring and status counts

**Project** (`components/project/`) — `SegmentedControl` over Board | Table |
Gantt | Calendar, all fed by one `useProject(id)` hook so a mutation refreshes
every view at once.

- Board: status columns, pointer drag, `PATCH` on drop
- Table: dense grid, inline edit
- Gantt: `lib/gantt.ts` maps dates to `{x, width}`; bars are positioned divs,
  dependency arrows and the today line are one SVG overlay. Progress fill and
  overdue colouring carry over from taskgantt
- Calendar: month grid keyed by due date

## Out of scope

Per-project custom columns · time tracking · sprints and story points
(`vikunja-jira` owns that) · realtime task sync (refetch on mutate) ·
assignment notifications · retiring `taskgantt`.

## Tests

- `node --test`: board decoder against a fixture blob; dependency-cycle guard;
  activity query shape
- `vitest`: `lib/gantt.ts` date→pixel math (the only non-obvious pure function)
- `import-boards.mjs --dry-run` against the live DB before the real run
