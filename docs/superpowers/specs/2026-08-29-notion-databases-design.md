# Notion-style databases, task pages, and pinning

Date: 2026-08-29

## Problem

The tasks module stores rows in Postgres and edits them in a modal. A row is a
record and nothing more: it cannot hold a document body, it cannot carry a
column the schema did not anticipate, and it cannot be pointed at another row.
Databases also cannot be composed — there is no way to put a view of one
database inside a page, or to nest a smaller database under a larger one.

Separately, only documents can be starred. Folders, which are the other half of
the sidebar tree, have no equivalent, so a person who organises by folder has
nothing to pin.

This design brings the tasks module up to the Notion model along three axes —
a row is a page, a database carries arbitrary properties, and databases compose
— and extends the existing favorites mechanism to folders.

## Decisions taken before design

- Build on the existing `projects`/`tasks` tables rather than a parallel
  generic database subsystem. A project *is* a database; a task *is* a row.
  The board, table, gantt and calendar views already exist and keep working.
- A row opens as a side peek with an editable document body, and can be opened
  full screen. The peek replaces `TaskDialog`.
- Property types for this version: text, number, select, multi-select, date,
  checkbox, person, url, relation. Rollup and formula are deferred.
- Composition works two ways: an embeddable view block for any page, and
  sub-databases nested in the sidebar.
- Pinning extends the per-user `favorites` table to folders. It is not a new,
  workspace-wide concept.

## Data model

All changes go in `initSchema` in `server/src/db.js`, which is idempotent and
runs on every boot. No separate migration runner.

### Sub-databases

```sql
ALTER TABLE projects ADD COLUMN IF NOT EXISTS parent_id TEXT
  REFERENCES projects(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS projects_parent_idx ON projects(parent_id, position);
```

`NULL` means top level, matching how `folders.parent_id` and `docs.parent_id`
already work. Cascade on delete: a sub-database has no meaning without its
parent, and its rows are already cascaded from `projects`.

Depth is not limited by the schema. The create and move routes reject a cycle
using the same depth-first walk `wouldFolderCycle` performs for folders; that
helper is folder-specific, so the projects version lives beside it in
`server/src/tasks.js`.

### Custom properties

```sql
CREATE TABLE IF NOT EXISTS db_props (
  id                TEXT PRIMARY KEY,
  project_id        TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  key               TEXT NOT NULL,
  label             TEXT NOT NULL,
  type              TEXT NOT NULL DEFAULT 'text',
  options           JSONB NOT NULL DEFAULT '[]',
  target_project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  position          INT NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS db_props_key_idx ON db_props(project_id, key);
```

`type` is one of `text`, `number`, `select`, `multi_select`, `date`,
`checkbox`, `person`, `url`, `relation`. `options` holds the choice list for
`select` and `multi_select` as `[{ id, label, color }]`, reusing the shared tag
palette names so the existing colour tokens apply. `target_project_id` is set
only for `relation` and names the database being pointed at.

The property row follows the `task_kinds` precedent already in this schema:
per-project, editable by anyone who can see the project, seeded with nothing.

### Property values

```sql
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS props JSONB NOT NULL DEFAULT '{}';
```

One JSONB object per row, keyed by `db_props.id`. Scalars are stored as
themselves; `multi_select` is an array of option ids; `person` is a user id;
`date` is an ISO date string.

This is deliberately not an entity-attribute-value table. Reading a row needs
no join, adding a property needs no migration, and deleting a property is a
metadata delete plus a lazy key drop. The ceiling is that filtering *across*
databases on a property value is a JSONB scan; a GIN index on `tasks.props`, or
a real EAV table, is the upgrade path if that ever gets measured as slow. The
column carries a `ponytail:` comment saying exactly that.

Values for a deleted property are not scrubbed synchronously. The delete route
issues `UPDATE tasks SET props = props - $propId WHERE project_id = $1`, which
is one statement over the rows of a single project — cheap enough to do inline.

### Relations

Relations are edges, not JSON:

```sql
CREATE TABLE IF NOT EXISTS task_relations (
  prop_id TEXT NOT NULL REFERENCES db_props(id) ON DELETE CASCADE,
  from_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  to_id   TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  PRIMARY KEY (prop_id, from_id, to_id)
);
CREATE INDEX IF NOT EXISTS task_relations_to_idx ON task_relations(to_id);
```

Keeping edges in a table rather than inside `props` is what makes deleting a
row safe: the foreign key removes every edge that pointed at it, so no page
ever renders a link to a row that no longer exists. The reverse index is there
because the back-reference ("which rows point at me") is the direction a row
page queries on every open.

Relations are one-directional in storage and shown in both directions in the
UI. A separate mirrored property on the target database is not created.

### Row pages

`tasks.doc_id` already exists and is already patchable; nothing new is needed on
`tasks`. What is new is that the document is created on demand and marked as a
row page:

`docs.kind` already exists with `'doc' | 'design'`; a row page is `kind = 'task'`. It behaves like any other document — same
sharing, comments, version history, search, trash — but is not a loose page in
the sidebar, because it belongs to its row. The client already filters
`kind !== 'design'` out of the root lists in `store/workspace.tsx`; row pages
join that filter. Full-text search deliberately still includes them.

The document is created lazily, the first time somebody opens the row, so
importing a thousand rows does not create a thousand empty documents.

## Server

### Property routes — `server/src/tasks.js`

- `GET /api/projects/:id/props` — ordered by `position`.
- `POST /api/projects/:id/props` — `{ label, type, options?, targetProjectId? }`.
  `key` is slugified from the label and de-duplicated per project. Rejects an
  unknown type with 400, and a `relation` without a resolvable
  `targetProjectId` with 400.
- `PATCH /api/props/:id` — label, options, position, `target_project_id`.
  Changing `type` is allowed only between compatible types (`text` ↔ `url`,
  `select` ↔ `multi_select`); anything else returns 400 rather than silently
  destroying values.
- `DELETE /api/props/:id` — deletes the row, strips the key from
  `tasks.props`, and lets the cascade clear `task_relations`.

### Row routes

- `PATCH /api/tasks/:id` gains `props`, which is a **shallow merge**
  (`props = props || $patch`), so two people editing different properties of
  the same row do not clobber each other. An explicit `null` value removes a
  key.
- `POST /api/tasks/:id/relations` `{ propId, toId }` and
  `DELETE /api/tasks/:id/relations` `{ propId, toId }`. Both validate that the
  property is a relation belonging to the row's project and that `toId` lives
  in `target_project_id`.
- `GET /api/tasks/:id` returns the row plus `props`, outgoing relations grouped
  by property, and incoming relations (back-references) grouped by source
  database.
- `POST /api/tasks/:id/page` creates the row's document if it has none and
  returns `{ docId }`. Idempotent: a second call returns the same id. It
  reuses `createDocRow` in `server/src/index.js` (exported for this) with
  `kind: 'task'`, the row's title, and the caller as owner, then sets
  `tasks.doc_id` in the same transaction.

### Title synchronisation

A row and its page show the same title in two places, so both writes are
mirrored, each in exactly one place:

- `PATCH /api/tasks/:id` with a title also updates `docs.title` when
  `tasks.doc_id` is set.
- The existing document title write path updates the owning row's title when a
  task points at that document.

Each direction writes only when the value actually differs, which is what stops
the pair looping.

### Database tree

`GET /api/projects` returns `parent_id`, and gains `POST /api/projects/:id/move`
`{ parentId, position }` for reparenting. Cycles are rejected with 400.

## Frontend

### Row peek and row page

`components/project/TaskPeek.tsx` replaces `TaskDialog.tsx`, which is deleted.
The peek is a right-hand panel: title, the built-in fields the dialog already
edits (type, status, assignee, sprint, dates, points, dependencies), then the
custom properties, then the document body. The body mounts the same
BlockSuite editor the app uses everywhere, through `editor/LazyEditor`, against
the row's document; opening the peek is what triggers `POST /api/tasks/:id/page`.
A ↗ button calls `showDoc(docId)` and opens the row full screen.

On phones the peek is a bottom sheet, which is what `Modal`'s existing `sheet`
mode already gives.

### Property editors

`components/project/props/` holds one small component per property type and a
`PropertyValue` switch that picks between them. A `PropsDialog` — modelled on
the existing `TaskKindsDialog` — adds, renames, reorders and deletes columns.
`TaskTable` renders custom columns after the built-in ones.

Person and relation pickers reuse the existing user list and a filtered row
search against the target database.

### Sidebar

The Projects section renders the database tree recursively, matching
`FolderTree`'s existing indentation and disclosure behaviour. The row menu
gains "New sub-database". Dragging a database onto another is out of scope for
this version; the move route exists, so it can be added later without server
work.

### Embedded database block

A new block flavour, `metanoia:database`, built exactly like
`web-react/src/editor/chart/`: a `FlavourExtension`, a `BlockViewExtension`
choosing the page or edgeless custom element, and a `SlashMenuConfigExtension`
for `/database`. Its model carries `{ projectId, view }` where view is one of
the existing tab names. The lit host mounts a React root and renders the
existing `Board` or `TaskTable` inside it, so the embedded view is the same
component as the full one and stays in sync with it by construction.

Inserting the block opens a picker for the target database and initial view.
An embed pointing at a deleted database renders an inline "database not found"
placeholder rather than throwing.

## Pinning

```sql
ALTER TABLE favorites ADD COLUMN IF NOT EXISTS folder_id TEXT
  REFERENCES folders(id) ON DELETE CASCADE;
ALTER TABLE favorites ALTER COLUMN doc_id DROP NOT NULL;
ALTER TABLE favorites DROP CONSTRAINT IF EXISTS favorites_pkey;
```

The existing `(user_id, doc_id)` primary key cannot express "one of two
targets", so it is dropped in favour of:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS favorites_doc_idx
  ON favorites(user_id, doc_id) WHERE doc_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS favorites_folder_idx
  ON favorites(user_id, folder_id) WHERE folder_id IS NOT NULL;
ALTER TABLE favorites ADD CONSTRAINT favorites_one_target
  CHECK ((doc_id IS NULL) <> (folder_id IS NULL));
```

Dropping the primary key and adding the constraint are guarded by
`schema_migrations`, following `normalizeLegacyFolderImport`, because neither
statement is naturally idempotent.

- `PUT /api/folders/:id/favorite` mirrors the document route in
  `server/src/index.js`.
- `GET /api/folders` returns `favorite` per folder for the calling user.
- The sidebar's existing Favorites section lists documents and folders
  together, folders first. The star appears in the folder row menu and in the
  `FolderView` header, matching how a document exposes it in `TopBar`.

The section keeps the name "Favorites" rather than becoming "Pinned", because
that is the word already used in the top bar, the command palette and the
document menu.

## Testing

Server. The suite is `node --test` with no database harness — no existing
server test touches `pool` — so each rule below lives in an exported pure
function that gets a unit test, and the route calling it is verified by a
documented `curl` check rather than an automated one:

- `db_props` CRUD, including the rejected type change and the 400 on a
  relation without a target.
- Deleting a property strips its key from `tasks.props` and drops its edges.
- Deleting a row removes edges pointing at it in both directions.
- `POST /api/tasks/:id/page` twice returns the same document id.
- Title sync in both directions settles instead of ping-ponging.
- A project cycle (`A` under `B` under `A`) is rejected.
- Toggling a folder favorite twice returns to the unpinned state, and the
  check constraint rejects a row with both targets.

Web:

- Property value parse/format per type, including a `multi_select` value whose
  option was deleted.
- The workspace store excludes `kind === 'task'` pages from the root lists but
  keeps them reachable by id.

## What this does not include

- Rollup and formula properties.
- Per-view saved filters and sorts.
- Dragging a database onto another in the sidebar.
- A mirrored relation property on the target database.
- Cross-database property filtering with an index behind it.
