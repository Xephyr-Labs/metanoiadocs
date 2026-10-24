# Spaces: design

Date: 2026-10-23. Status: proposed.

## Why

metanoiadocs is one shared workspace. As the team grows, every person's sidebar, Home, Tasks view and search fill with every other team's projects, tasks and pages. A **space** is a named area that a team's work lives in, as in Notion teamspaces or Confluence spaces. People see the spaces they work in, and the rest stays out of the way but can still be found.

**Spaces organise. They do not restrict.** Anyone signed in can still open anything in any space. Hiding is already handled by private pages, which keep working unchanged.

## Goals

- Every page, folder and project (database or board) belongs to exactly one space. A task belongs to its project's space.
- The sidebar lists the spaces you have **joined**, Notion style, each as a collapsible section holding that space's pages, folders and projects.
- People join the spaces they care about. Spaces they haven't joined stay out of their sidebar, Home and Tasks view, but are still browsable and searchable.
- Moving work between spaces is one action.
- Existing content and people carry over with no visible loss.

## Non-goals

- Private or closed spaces, or any access rule tied to a space. Private pages already cover hiding.
- Per-space roles or permissions, and per-space guests.
- Per-space settings beyond name, icon and description.
- Per-space tags or people lists. Both stay workspace-wide.

## Anti-goals (a failure even if everything else works)

- Anything someone could see before this change becomes invisible to them. In particular, a task assigned to you, or a mention of you, must never disappear because it sits in a space you haven't joined.
- Content lost or orphaned by the migration or by a move.
- A space check added to an access path. Page access (`grantOn` in `server/src/index.js`) must not change.

## Decisions made with the owner

1. **Sidebar shows all joined spaces, stacked, Notion style.** It is not one-space-at-a-time.
2. **People join spaces.** Only joined spaces appear in the sidebar.
   - **Browse spaces:** a "Spaces" entry at the foot of the sidebar opens a list of every space (icon, name, description, member count, Join or Joined). You can leave a space from its section menu.
   - **Being added:** a space's creator can add people while creating it, and any member can add people later.
   - **Creating:** the creator joins their own space automatically.
   - **Landing in an unjoined space:** a page reached by link, search or mention opens normally, and the breadcrumb shows a "Join *Space*" button next to the space name.
   - **New users** join the default space automatically.
3. **Home and the Tasks view show joined spaces only**, plus anything assigned to you or created by you wherever it lives.
4. **Inbox is unchanged.** It shows everything addressed to you from every space.
5. **Search and the Cmd+K palette** show results from joined spaces first, then results from other spaces under an "Other spaces" heading.
6. Everything else below marked *(my call)* was decided by the designer, and the owner raised no objection.

## Current state (verified in code, branch base `origin/main` 009443a)

- **One workspace by design.** `server/src/db.js` notes "Single workspace, so no workspace_id column". No org, team or space table exists.
- **Access control exists only on docs.**
  - `docs.visibility` is `team` or `private`.
  - `doc_access` holds per-user grants.
  - `grantOn()` is in `index.js`.
  - Folders, projects and tasks have no access control.
- **The sidebar is built on the client.**
  - Data comes from `GET /api/docs`, `GET /api/folders` and `GET /api/projects` (`web-react/src/store/workspace.tsx`).
  - Sections are derived in `workspace.tsx` and `components/sidebar/Sidebar.tsx`: Home, Inbox, Tasks, All documents, Recent, Pinned, Favorites, Projects, Designs, Folders plus unfiled pages, Private, Public links, Shared with me, Tags, Templates.
- **Pages nest** through `docs.parent_id`. A child copies its parent's `folder_id` and `visibility` when it is created.
- **Folders nest** through `folders.parent_id`.
- **Projects nest** through `projects.parent_id`.
- **`projects.doc_id`** is an optional source page.
- **A task's own page** is a doc with `kind = 'task'`, linked through `tasks.doc_id`.
- **Pins are workspace-wide** (`pins` table, no `user_id`). **Favorites are per user.**
- **Page templates** are docs with `is_template = true`.

## Design

### Data (all additive, applied by the idempotent `initSchema`)

**New tables:**
- `spaces`:
  - `id TEXT PK`, `name TEXT NOT NULL`, `icon TEXT NOT NULL DEFAULT '🗂️'`, `description TEXT NOT NULL DEFAULT ''`
  - `is_default BOOLEAN NOT NULL DEFAULT false`, with a unique partial index so at most one is default
  - `created_by TEXT REFERENCES users ON DELETE SET NULL`, `created_at`
- `space_members`:
  - `space_id REFERENCES spaces ON DELETE CASCADE`, `user_id REFERENCES users ON DELETE CASCADE`
  - `position INT` (this person's sidebar order), `joined_at`
  - Primary key `(space_id, user_id)`

**New columns:**
- `docs.space_id`, `folders.space_id`, `projects.space_id`: each `TEXT REFERENCES spaces(id)`. They are nullable during the migration, and every write path sets them afterwards.
- `pins.space_id`, for per-space pins.
- `docs.template_everywhere BOOLEAN NOT NULL DEFAULT false`.

**Migration** (one `data_migrations` marker):
- Create the default space "General".
- Set `space_id` to it on every existing doc, folder, project and pin.
- Add every existing user to it.

**Tasks have no `space_id`.** A task's space is its project's space, read through a join, so the two can never disagree.

### Invariants, enforced on the server at every create and move

| Item | Its space is… |
|---|---|
| A sub-page | its parent page's space |
| A page in a folder | the folder's space |
| A sub-folder | its parent folder's space |
| A sub-project | its parent project's space |
| A task's page (`kind = 'task'`) | its project's space |
| A project's source page (`projects.doc_id`) | its project's space |

- **Any other new page, folder or project** goes into the `spaceId` the client sends (the space whose section it was created from). Otherwise it goes to the default space.
- **One server helper resolves the space for a write** and is unit tested. Its rules are the table above.
- **Templates:** a page made from a template goes into the space it is created in, not the template's space.

### Moving

**Endpoints:**
- `POST /api/docs/:id/space`
- `POST /api/folders/:id/space`
- `POST /api/projects/:id/space`

Each takes `{ spaceId }`.

**What moves with what:**
- **A page** moves with all its sub-pages. If its folder is in another space, the page leaves the folder and sits at the top of the target space.
- **A folder** moves with its sub-folders and every page inside them, sub-pages included.
- **A project** moves with its sub-projects, its source page, and every task's page.

**Who can move:**
- A page: anyone who can edit it.
- A folder or project: any signed-in user. Neither has an owner today.

Every move runs in one transaction.

**Links:** links, mentions, comments, favorites, backlinks and share links do not change on a move. Pins on the moved items are dropped *(my call: a pin was chosen for its old space)*.

**Which rule wins for a sub-page** *(my call)*:
- **A top-level page** (`parent_id` null) takes its folder's space, or the space it was created in when it has no folder.
- **A sub-page always takes its parent's space.** Its `folder_id` decides nothing about its space.
- Live data can hold a sub-page whose `folder_id` names a folder other than its parent's. When that folder ends up in a different space from the page, the sub-page's `folder_id` is cleared.
- **What a folder move takes:**
  - every top-level page filed in the folder or its sub-folders, with each page's whole sub-tree
  - not a sub-page whose parent lives outside the folder: it stays with its parent, and its `folder_id` is cleared
- At migration time everything is in General, so no conflict can exist yet.

**Existing reparent paths that cross spaces become moves** *(my call, Notion behaviour)*:
- These paths are covered:
  - nesting a page under a page in another space
  - filing a page into a folder in another space (`PATCH /api/docs/:id` with `folderId`)
  - reparenting a folder or a project under one in another space
  - dragging between space sections in the sidebar
  - the MCP equivalents
- Each one performs the full space move above (sub-tree, pins, folder clearing) in the same transaction. They are never refused, and the space is never changed for the single item alone.
- In the UI, a cross-space drag shows the same confirmation as "Move to space" before it happens.
- All of this goes through one shared server function, so every path behaves the same.

**Pages that belong to a project** *(my call)*:
- A task's own page (`kind = 'task'`) and a project's source page (`projects.doc_id`) cannot be moved on their own. The endpoint answers 409 with "Move the database instead", and the UI offers that.
- When a project moves, only its `kind = 'task'` pages go with it, plus its source page. An ordinary page that a task links to through `tasks.doc_id` is not a task page, and it stays where it is.

**Permissions inside a moved sub-tree** *(my call; a space restricts nothing, so moving never changes who can open what)*:
- You need edit rights on the item you move: the root page, or any signed-in user for a folder or project, as above.
- Everything beneath it moves too, including pages you can't edit or can't see, such as someone else's private page filed in that folder. Leaving them behind would split the tree, and moving them exposes nothing.
- The confirmation counts only what you can see. When more items move than you can see, it adds "and some pages you can't see", without saying how many.

### Membership and space management

**Endpoints:**
- `GET /api/spaces` lists every space with `joined`, `member_count` and, for joined spaces, `position`.
- `POST /api/spaces` creates a space. Any signed-in user can do it. The body is `{ name, icon?, description?, memberIds? }`. The creator is joined first.
- `PATCH /api/spaces/:id` edits name, icon or description. Only the creator or a workspace admin can do it.
- `DELETE /api/spaces/:id` deletes a space. Only the creator or an admin can do it, the space must be empty (no docs, folders or projects, trash included), and the default space can never be deleted.
- `POST /api/spaces/:id/join` and `POST /api/spaces/:id/leave`. Leaving is allowed even when you are the last member: spaces don't restrict, so an empty-membered space still shows in Browse.
- `POST /api/spaces/:id/members { userIds }`: any member adds others.
- `PUT /api/spaces/order { ids }`: this person's sidebar order.

New users join the default space when their account is created, whether by first-run setup, invite registration or magic link.

### Reading: what changes where

**No change to `grantOn`, `doc_access`, the sync server's access check, guest links, share links or Inbox.**

| Reader | Change |
|---|---|
| `GET /api/docs`, `/api/folders`, `/api/projects` | Each row gains `space_id`. They still return everything the user could see before; the client groups by space. |
| Sidebar | See UI below. |
| Home (`server/src/home.js`) | Activity, recent docs, project cards and stats are limited to the user's joined spaces. My-tasks and anything assigned to or created by the user stay unfiltered. |
| Tasks view (`/api/tasks`, `ALL_TASKS_SQL`) | Limited to joined spaces, OR assigned to me, OR created by me. Each task row gains `space_id`. |
| Search (`/api/search`) and the palette | Every result gains `space_id` and `in_joined_space`. Results are ordered with joined first, then relevance. The palette shows an "Other spaces" group heading. |
| Page templates (`server/src/templates.js`) | The picker offers templates from the space you are creating in, plus every template marked `template_everywhere`. Only an admin can set `template_everywhere`. |
| Pins | Shown inside each space's section, from `pins.space_id`. |
| Reminders, digest, calendar feed, Inbox, notifications | No change. They are already about the person, not the workspace. |
| Webhooks and automations | Event payloads gain `space_id`. Nothing is filtered. |
| MCP (`server/src/mcp-tools.js` and `mcp/src/index.js` in this work. Andy's copy, `container/agent-runner/src/metanoia-mcp-stdio.ts` in nanoclaw, is a follow-up change shipped **after** this server is deployed. Every new parameter is optional and defaults to the default space, so Andy keeps working unchanged in between) *(my call)* | New `list_spaces` tool. Optional `spaceId` filter on `list_docs`, `search_docs` and `list_boards`. Optional `spaceId` on `create_doc` and the board-create tool (default space if omitted). `workspace_overview` groups by space. Agents see every space. |

### UI

**Sidebar, top to bottom:**
1. Home, Inbox, Tasks, All documents
2. Recent, Favorites
3. Private: your private pages across all spaces, as now
4. Shared with me
5. A section per joined space, in the person's order. Each section has:
   - its icon and name
   - a hover `+` to add a page, folder or project
   - a `⋯` menu: rename, icon, description, add people, leave, and delete when allowed
   - inside: Pinned, then Projects, then Folders and unfiled pages, then Designs, the same grouping as today but scoped to the space
6. Spaces: browse all spaces (with a "New space" button)
7. Tags, Templates

**Within a space section:**
- Private pages in that space also appear here, with a lock *(my call: Notion shows a private page in exactly one place, but our private pages already live in a tree with folders, and pulling them out would break that tree)*.
- Collapsed state is remembered per browser, as other sidebar sections are today.
- Sections can be reordered by dragging. That stores `space_members.position`.

**Other screens:**
- **Breadcrumb:** pages, folders and databases show the space as their first crumb. In a space you haven't joined, a small "Join" button sits next to it.
- **Space page:** clicking a space name opens a simple overview with description, members, pinned items and recent activity. *(my call: the minimum Confluence-like space home; richer layouts later.)*
- **Move to space:** a menu item on pages, folders and databases, with a space picker and a confirmation naming how many items come along (e.g. "Moves 12 pages and 40 tasks").
- **Create-space dialog:** name, icon, description, add people.
- **All documents and the Tasks view** gain a space filter chip (joined spaces by default, "All spaces" available).

## Testing

- **Server unit tests** (pure, `node --test`, matching the repo's style):
  - the space-resolution helper's rules
  - the move-subtree collection (which ids move with a page, folder or project)
  - the search ordering by joined space
- **Browser checks** in `e2e/spaces/`, modelled on `e2e/voice-notes/`, against a throwaway stack:
  - migration lands everything in General
  - create, join and leave a space
  - the sidebar shows joined spaces only
  - each create-path inherits the right space
  - every move kind takes its subtree
  - a task assigned to you in an unjoined space still shows in Tasks and Home
  - search order and the "Other spaces" group
  - breadcrumb Join
  - templates per space and everywhere
  - delete refused when not empty
- **Regression:** the existing web (607) and server (417) suites stay green.

## Deploy

- Additive schema plus one data migration. Take the usual `pg_dump -Fc` backup first and verify its table of contents.
- After deploy, verify:
  - every doc, folder and project has a `space_id`
  - every user is a member of General
  - row counts are unchanged

## Left to the builder

- Exact visual design within the existing tokens and sidebar components.
- Space ids, positions and ordering details.
- Whether the space page reuses the Home cards.
- How the move confirmation counts are computed.

## Later (not in this work)

- Closed or private spaces.
- Per-space permissions or roles.
- Space-level settings.
- Turning existing folders into spaces in bulk.
