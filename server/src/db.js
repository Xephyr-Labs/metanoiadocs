import pg from 'pg';
import crypto from 'node:crypto';
import { KEY_PREFIX, deriveKey, uniqueKey } from './task-key.js';

export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

// One place that owns the schema. Idempotent, so it runs on every boot.
export async function initSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id          TEXT PRIMARY KEY,
      email       TEXT UNIQUE NOT NULL,
      name        TEXT NOT NULL DEFAULT '',
      avatar_url  TEXT,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token      TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
    -- How this session was started: 'link' for one begun by a sign-in link,
    -- NULL for a password login. A link is proof of the mailbox, which is what
    -- lets its session set a new password without proving the old one — the
    -- whole point of forgetting it. Cleared once used, so the session cannot
    -- keep doing it.
    ALTER TABLE sessions ADD COLUMN IF NOT EXISTS via TEXT;

    -- Username + password auth (added alongside magic-link, not replacing it).
    ALTER TABLE users ADD COLUMN IF NOT EXISTS username TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;
    -- Workspace-level role: 'admin' (can invite) or 'collaborator'.
    ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'collaborator';

    -- Is this account a person or something running on their behalf?
    --
    -- An agent authenticates with a personal access token, so every row it
    -- writes is stamped with a users.id exactly like a human's. Without this
    -- column "who changed this" has no answer the interface can give: the
    -- activity feed, the doc byline and the task attribution all read the same
    -- as a colleague typing. Defaulting to 'person' keeps every existing
    -- account exactly as it was.
    ALTER TABLE users ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'person';

    -- The IANA zone this person's browser last reported (e.g. Asia/Dhaka).
    --
    -- Every day boundary in the app is a decision about somebody: whether a
    -- task is due today, whether it is a day late, whether 8am has arrived for
    -- the person about to be told. Postgres answers current_date in the
    -- server's zone and Node answers new Date() in the container's, which is
    -- the same answer for everybody — and wrong for anybody not sitting in it.
    -- NULL until a browser says otherwise, and the server's own zone is the
    -- fallback, which is exactly the behaviour that predates this column.
    ALTER TABLE users ADD COLUMN IF NOT EXISTS timezone TEXT;

    -- Whether notification email is wanted at all.
    --
    -- The platform has always mailed a mention, a comment, an assignment and
    -- the morning digest, and there was no switch anywhere for any of it: the
    -- only way to stop the mail was to stop using the product. Default true,
    -- because that is what every existing account already experiences.
    -- Sign-in links and invitations ignore this: they are how you get in, not
    -- news about something that happened.
    ALTER TABLE users ADD COLUMN IF NOT EXISTS email_notify BOOLEAN NOT NULL DEFAULT true;

    CREATE UNIQUE INDEX IF NOT EXISTS users_username_idx
      ON users(username) WHERE username IS NOT NULL;

    -- Single-use sign-in links. Consumed on verify, so a leaked mail is spent once.
    CREATE TABLE IF NOT EXISTS magic_tokens (
      token      TEXT PRIMARY KEY,
      email      TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at    TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS docs (
      id         TEXT PRIMARY KEY,
      title      TEXT NOT NULL DEFAULT 'Untitled',
      created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- The Yjs CRDT state. One row per doc, overwritten on each debounced store.
    CREATE TABLE IF NOT EXISTS doc_states (
      doc_id     TEXT PRIMARY KEY REFERENCES docs(id) ON DELETE CASCADE,
      state      BYTEA NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- Explicit grants. Absent row = no access. There is no seat count anywhere
    -- in this schema, and that is deliberate.
    CREATE TABLE IF NOT EXISTS doc_access (
      doc_id  TEXT NOT NULL REFERENCES docs(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role    TEXT NOT NULL DEFAULT 'editor',
      PRIMARY KEY (doc_id, user_id)
    );

    -- Invite-only access: an email may sign in iff it is already a user OR has
    -- a row here (see isEmailAllowedIn).
    CREATE TABLE IF NOT EXISTS invites (
      email      TEXT PRIMARY KEY,
      invited_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- Sidebar tree: a doc may nest under another. NULL = top level.
    ALTER TABLE docs ADD COLUMN IF NOT EXISTS parent_id TEXT
      REFERENCES docs(id) ON DELETE SET NULL;
    CREATE TABLE IF NOT EXISTS folders (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL DEFAULT 'Untitled folder',
      parent_id   TEXT REFERENCES folders(id) ON DELETE SET NULL,
      position    INT NOT NULL DEFAULT 0,
      created_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted_at  TIMESTAMPTZ,
      source_doc_id TEXT UNIQUE REFERENCES docs(id) ON DELETE SET NULL
    );
    ALTER TABLE docs ADD COLUMN IF NOT EXISTS folder_id TEXT
      REFERENCES folders(id) ON DELETE SET NULL;
    -- Sidebar tint; values come from the shared tag palette ('gray', 'blue', …).
    ALTER TABLE folders ADD COLUMN IF NOT EXISTS color TEXT NOT NULL DEFAULT 'gray';
    -- Manual sibling ordering for the sidebar tree (drag-reorder). Lower first.
    -- Must be added before docs_folder_idx below indexes it: on an existing
    -- database the column is already there, but on a fresh one this whole DDL
    -- block runs top to bottom and the index would reference nothing.
    ALTER TABLE docs ADD COLUMN IF NOT EXISTS position INT NOT NULL DEFAULT 0;
    CREATE INDEX IF NOT EXISTS folders_parent_idx ON folders(parent_id, position);
    CREATE INDEX IF NOT EXISTS docs_folder_idx ON docs(folder_id, position);
    -- Properties a page can carry, Notion-style. Workspace-wide definitions so
    -- "Status" means one thing everywhere and its type and options are declared
    -- once; the values are per page. Deliberately not db_props: those are scoped
    -- to a project and carry relations into its rows, neither of which a
    -- standalone page has.
    CREATE TABLE IF NOT EXISTS doc_props (
      id         TEXT PRIMARY KEY,
      key        TEXT NOT NULL,
      label      TEXT NOT NULL,
      type       TEXT NOT NULL DEFAULT 'text',
      options    JSONB NOT NULL DEFAULT '[]',
      position   INT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS doc_props_key_idx ON doc_props(key);
    -- Values keyed by doc_props.id, same shape as tasks.props: a page sets only
    -- the properties it actually uses, so the column is sparse by design.
    ALTER TABLE docs ADD COLUMN IF NOT EXISTS props JSONB NOT NULL DEFAULT '{}';
    -- No docs.attachments here on purpose. Pages carried an attachment list
    -- for three days and not one of the 114 documents in production ever used
    -- it: a file that belongs to a page either belongs IN the page, or belongs
    -- to the task the page is about. Tasks keep theirs (see below). An install
    -- that already has the column keeps it — nothing reads it, and dropping a
    -- column from a migration that runs on every boot would take somebody
    -- else's files with it.

    CREATE TABLE IF NOT EXISTS schema_migrations (
      key        TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    ALTER TABLE docs ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
    -- Per-doc emoji shown in the sidebar/header.
    ALTER TABLE docs ADD COLUMN IF NOT EXISTS icon TEXT NOT NULL DEFAULT '📄';
    -- Visibility: 'team' = every workspace member can see/edit it (no explicit
    -- grant needed, so members who join later see it too); 'private' = only the
    -- owner plus anyone explicitly shared via doc_access. Default team.
    ALTER TABLE docs ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'team';
    -- 'doc' opens as a page, 'design' opens on the canvas. A design is a
    -- document in every other respect — same sharing, folders, trash, search,
    -- comments and version history — which is the whole reason it is a column
    -- here rather than a table of its own.
    ALTER TABLE docs ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'doc';

    -- Per-user favorites (star). Absent row = not favorited.
    CREATE TABLE IF NOT EXISTS favorites (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      doc_id  TEXT NOT NULL REFERENCES docs(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, doc_id)
    );
    -- Pinning covers folders too. doc_id becomes nullable and exactly one of
    -- the two targets is set; the old (user_id, doc_id) primary key cannot
    -- express that, so it is replaced by two partial unique indexes. Dropping
    -- the NOT NULL happens in relaxFavoritesKey() below, not here: Postgres
    -- refuses ALTER COLUMN ... DROP NOT NULL while the column is still part
    -- of the primary key ("column is in a primary key"), so it has to wait
    -- until that migration has dropped favorites_pkey.
    ALTER TABLE favorites ADD COLUMN IF NOT EXISTS folder_id TEXT
      REFERENCES folders(id) ON DELETE CASCADE;
    CREATE UNIQUE INDEX IF NOT EXISTS favorites_doc_idx
      ON favorites(user_id, doc_id) WHERE doc_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS favorites_folder_idx
      ON favorites(user_id, folder_id) WHERE folder_id IS NOT NULL;
    -- Public read-only share link. NULL = private. Unique so the token resolves
    -- to exactly one doc.
    ALTER TABLE docs ADD COLUMN IF NOT EXISTS share_token TEXT;
    CREATE UNIQUE INDEX IF NOT EXISTS docs_share_token_idx
      ON docs(share_token) WHERE share_token IS NOT NULL;
    -- Full-text search. The client posts extracted plain text (decoding Yjs
    -- server-side would mean shipping the BlockSuite schema here); the tsvector
    -- is generated from title + that text so title matches always count.
    ALTER TABLE docs ADD COLUMN IF NOT EXISTS search_text TEXT NOT NULL DEFAULT '';
    ALTER TABLE docs ADD COLUMN IF NOT EXISTS search_tsv tsvector
      GENERATED ALWAYS AS (
        to_tsvector('english', coalesce(title,'') || ' ' || coalesce(search_text,''))
      ) STORED;
    CREATE INDEX IF NOT EXISTS docs_search_idx ON docs USING GIN (search_tsv);
    CREATE INDEX IF NOT EXISTS docs_parent_idx ON docs(parent_id);

    -- Content-addressed blobs (images, attachments) that BlockSuite stores by
    -- sha256 key. Content-addressed, so a global key space is safe and dedups.
    -- Workspace-level key/value settings (AI provider config, etc). Single row
    -- per key; value is JSON. The AI api key lives here — never returned to the
    -- client, only used server-side to call the provider.
    -- Workspace pins. Favorites are per person and invisible to everyone else;
    -- a pin is the team's shelf — one row per doc or folder, no user_id in the
    -- key, so everybody sees the same list. pinned_by is provenance only, not
    -- ownership: anyone who can see the thing can unpin it, the same way anyone
    -- can rename a folder here.
    CREATE TABLE IF NOT EXISTS pins (
      doc_id     TEXT REFERENCES docs(id) ON DELETE CASCADE,
      folder_id  TEXT REFERENCES folders(id) ON DELETE CASCADE,
      pinned_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
      position   INT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      -- Exactly one target, never both and never neither.
      CHECK ((doc_id IS NULL) <> (folder_id IS NULL))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS pins_doc_idx ON pins(doc_id) WHERE doc_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS pins_folder_idx ON pins(folder_id) WHERE folder_id IS NOT NULL;

    CREATE TABLE IF NOT EXISTS app_settings (
      key        TEXT PRIMARY KEY,
      value      JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- Version history: periodic + on-demand Yjs snapshots of a doc's content.
    -- Restore creates a new doc from a snapshot (non-destructive).
    CREATE TABLE IF NOT EXISTS doc_versions (
      id         TEXT PRIMARY KEY,
      doc_id     TEXT NOT NULL REFERENCES docs(id) ON DELETE CASCADE,
      state      BYTEA NOT NULL,
      label      TEXT,
      created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS doc_versions_doc_idx ON doc_versions(doc_id, created_at DESC);

    -- Threaded comments anchored to a BlockSuite block id (stable across edits),
    -- carrying the quoted text for context. parent_id threads replies.
    CREATE TABLE IF NOT EXISTS comments (
      id          TEXT PRIMARY KEY,
      doc_id      TEXT NOT NULL REFERENCES docs(id) ON DELETE CASCADE,
      block_id    TEXT,
      quote       TEXT,
      body        TEXT NOT NULL,
      author_id   TEXT REFERENCES users(id) ON DELETE SET NULL,
      author_name TEXT,
      parent_id   TEXT REFERENCES comments(id) ON DELETE CASCADE,
      resolved    BOOLEAN NOT NULL DEFAULT false,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS comments_doc_idx ON comments(doc_id, created_at);

    CREATE TABLE IF NOT EXISTS blobs (
      key        TEXT PRIMARY KEY,
      mime       TEXT NOT NULL DEFAULT 'application/octet-stream',
      data       BYTEA NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- Workspace-global tags (AFFiNE-style coloured labels). Single workspace,
    -- so no workspace_id column. Name is unique case-insensitively.
    CREATE TABLE IF NOT EXISTS tags (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      color      TEXT NOT NULL DEFAULT 'gray',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS tags_name_idx ON tags(lower(name));

    CREATE TABLE IF NOT EXISTS doc_tags (
      doc_id TEXT NOT NULL REFERENCES docs(id) ON DELETE CASCADE,
      tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY (doc_id, tag_id)
    );
    CREATE INDEX IF NOT EXISTS doc_tags_tag_idx ON doc_tags(tag_id);

    -- Per-recipient notifications. kind='mention' when @-tagged in a comment,
    -- 'comment' when someone comments on a doc you own. Read when read_at is set.
    CREATE TABLE IF NOT EXISTS notifications (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      actor_id   TEXT REFERENCES users(id) ON DELETE SET NULL,
      actor_name TEXT,
      doc_id     TEXT REFERENCES docs(id) ON DELETE CASCADE,
      comment_id TEXT REFERENCES comments(id) ON DELETE CASCADE,
      kind       TEXT NOT NULL DEFAULT 'mention',
      body       TEXT,
      read_at    TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS notifications_user_idx
      ON notifications(user_id, created_at DESC);

    -- Web Push endpoints, one row per browser a person has switched alerts on
    -- in. The endpoint is the identity: the push service issues it, and the
    -- same browser re-subscribing hands back the same one, so it is the key
    -- rather than a generated id. A shared machine can move to another user,
    -- which the upsert on it handles.
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      endpoint   TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      p256dh     TEXT NOT NULL,
      auth       TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS push_subscriptions_user_idx
      ON push_subscriptions(user_id);

    -- Personal access tokens for programmatic access (e.g. the MCP server).
    -- Only the sha256 hash is stored; the plaintext is shown once at creation.
    CREATE TABLE IF NOT EXISTS api_tokens (
      id           TEXT PRIMARY KEY,
      user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name         TEXT NOT NULL DEFAULT '',
      token_hash   TEXT NOT NULL UNIQUE,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_used_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS api_tokens_user_idx ON api_tokens(user_id);

    -- Intelligence layer: per-doc term vector + extracted signals. Computed
    -- synchronously on the /text save. Best-effort; never blocks a save.
    CREATE EXTENSION IF NOT EXISTS pg_trgm;
    CREATE INDEX IF NOT EXISTS docs_title_trgm_idx ON docs USING GIN (title gin_trgm_ops);

    CREATE TABLE IF NOT EXISTS doc_terms (
      doc_id TEXT NOT NULL REFERENCES docs(id) ON DELETE CASCADE,
      term   TEXT NOT NULL,
      tf     INT  NOT NULL DEFAULT 1,
      PRIMARY KEY (doc_id, term)
    );
    CREATE INDEX IF NOT EXISTS doc_terms_term_idx ON doc_terms(term);

    CREATE TABLE IF NOT EXISTS doc_signals (
      doc_id     TEXT PRIMARY KEY REFERENCES docs(id) ON DELETE CASCADE,
      tasks      JSONB NOT NULL DEFAULT '[]',
      decisions  JSONB NOT NULL DEFAULT '[]',
      risks      JSONB NOT NULL DEFAULT '[]',
      deadlines  JSONB NOT NULL DEFAULT '[]',
      mentions   JSONB NOT NULL DEFAULT '[]',
      simhash    TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    ALTER TABLE doc_signals ADD COLUMN IF NOT EXISTS summary TEXT NOT NULL DEFAULT '';
    ALTER TABLE doc_signals ADD COLUMN IF NOT EXISTS keyphrases JSONB NOT NULL DEFAULT '[]';
    CREATE INDEX IF NOT EXISTS doc_terms_term_trgm_idx ON doc_terms USING GIN (term gin_trgm_ops);

    -- Explicit page-to-page links (@-references typed in the editor). Distinct
    -- from doc_terms "related", which is inferred from shared vocabulary — these
    -- are links a person actually drew, so backlinks can be trusted.
    -- Rewritten wholesale per source doc on each /text save.
    CREATE TABLE IF NOT EXISTS doc_links (
      from_id TEXT NOT NULL REFERENCES docs(id) ON DELETE CASCADE,
      to_id   TEXT NOT NULL REFERENCES docs(id) ON DELETE CASCADE,
      PRIMARY KEY (from_id, to_id)
    );
    -- The backlink direction is the one that gets queried per page view.
    CREATE INDEX IF NOT EXISTS doc_links_to_idx ON doc_links(to_id);

    -- Who last saved a doc. docs.updated_at already exists but carries no actor,
    -- so the activity feed cannot attribute a plain save without this.
    ALTER TABLE docs ADD COLUMN IF NOT EXISTS updated_by TEXT
      REFERENCES users(id) ON DELETE SET NULL;

    -- ── tasks ───────────────────────────────────────────────────────────────
    -- A project is a board. doc_id links it back to the page it was imported
    -- from (or a page written about it); NULL for projects created in-app.
    CREATE TABLE IF NOT EXISTS projects (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL DEFAULT 'Untitled project',
      icon        TEXT NOT NULL DEFAULT '📋',
      color       TEXT NOT NULL DEFAULT 'blue',
      doc_id      TEXT REFERENCES docs(id) ON DELETE SET NULL,
      position    INT NOT NULL DEFAULT 0,
      created_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      archived_at TIMESTAMPTZ
    );
    -- One project per source doc, so the importer is idempotent.
    CREATE UNIQUE INDEX IF NOT EXISTS projects_doc_idx
      ON projects(doc_id) WHERE doc_id IS NOT NULL;

    -- Four fixed statuses on purpose. Per-project custom columns are a real
    -- feature with real cost; add them when someone actually asks.
    CREATE TABLE IF NOT EXISTS tasks (
      id          TEXT PRIMARY KEY,
      project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      title       TEXT NOT NULL DEFAULT '',
      status      TEXT NOT NULL DEFAULT 'todo',
      assignee_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      start_at    DATE,
      due_at      DATE,
      priority    INT NOT NULL DEFAULT 0,
      progress    INT NOT NULL DEFAULT 0,
      points      INT,
      milestone   BOOLEAN NOT NULL DEFAULT false,
      doc_id      TEXT REFERENCES docs(id) ON DELETE SET NULL,
      parent_id   TEXT REFERENCES tasks(id) ON DELETE CASCADE,
      position    INT NOT NULL DEFAULT 0,
      created_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
      done_at     TIMESTAMPTZ,
      deleted_at  TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS tasks_board_idx
      ON tasks(project_id, status, position) WHERE deleted_at IS NULL;
    -- Sprints: a task with sprint_id IS NULL sits in the backlog.
    CREATE TABLE IF NOT EXISTS sprints (
      id         TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name       TEXT NOT NULL DEFAULT 'Sprint',
      start_at   DATE,
      end_at     DATE,
      state      TEXT NOT NULL DEFAULT 'planned', -- planned | active | done
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS sprints_project_idx ON sprints(project_id, state);
    ALTER TABLE tasks ADD COLUMN IF NOT EXISTS sprint_id TEXT
      REFERENCES sprints(id) ON DELETE SET NULL;
    -- epic | story | task | bug. Epics group children via the existing parent_id.
    ALTER TABLE tasks ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'task';
    -- Attachments every task has, without a database first having to define a
    -- file property for them. Same [{key,name,mime,size}] shape a file
    -- property stores, so both read one validator and one blob store.
    ALTER TABLE tasks ADD COLUMN IF NOT EXISTS attachments JSONB NOT NULL DEFAULT '[]';
    CREATE INDEX IF NOT EXISTS tasks_sprint_idx ON tasks(sprint_id) WHERE deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS tasks_assignee_idx
      ON tasks(assignee_id, due_at) WHERE deleted_at IS NULL;

    -- More than one person can carry a task. The edges live here; the older
    -- tasks.assignee_id column stays, always holding the FIRST assignee, so
    -- every query, filter and import that predates this table keeps working
    -- and a task still has one obvious owner in a narrow cell.
    -- ponytail: the API is what keeps the two in step (assigneesOf/setAssignees
    -- in tasks.js) — if a second writer ever appears, move it into a trigger.
    CREATE TABLE IF NOT EXISTS task_assignees (
      task_id  TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      position INT NOT NULL DEFAULT 0,
      PRIMARY KEY (task_id, user_id)
    );
    -- "what is on my plate" reads by user, across every project.
    CREATE INDEX IF NOT EXISTS task_assignees_user_idx ON task_assignees(user_id);

    -- task depends on depends_on_id: the edge points backwards in time.
    CREATE TABLE IF NOT EXISTS task_deps (
      task_id       TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      depends_on_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      PRIMARY KEY (task_id, depends_on_id),
      CHECK (task_id <> depends_on_id)
    );
    CREATE INDEX IF NOT EXISTS task_deps_rev_idx ON task_deps(depends_on_id);

    -- kind='assigned' notifications point at a task, not a document: a task's
    -- page is only created when someone first opens it, so doc_id is usually
    -- still null at the moment the assignment happens. Declared here rather
    -- than beside the notifications table because tasks does not exist yet up
    -- there.
    ALTER TABLE notifications ADD COLUMN IF NOT EXISTS task_id TEXT
      REFERENCES tasks(id) ON DELETE CASCADE;

    -- A comment thread on a task.
    --
    -- The same table as a page's comments rather than a second one: a comment
    -- is a body, an author, a parent and a time wherever it hangs, and two
    -- tables would mean two notifiers, two delete rules and two ways to be
    -- wrong. What changes is which column is filled — exactly one of doc_id
    -- and task_id — so doc_id gives up NOT NULL here and the CHECK keeps a row
    -- from belonging to both or to neither.
    ALTER TABLE comments ADD COLUMN IF NOT EXISTS task_id TEXT
      REFERENCES tasks(id) ON DELETE CASCADE;
    ALTER TABLE comments ALTER COLUMN doc_id DROP NOT NULL;
    DO $$ BEGIN
      ALTER TABLE comments ADD CONSTRAINT comments_one_parent
        CHECK ((doc_id IS NULL) <> (task_id IS NULL));
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    CREATE INDEX IF NOT EXISTS comments_task_idx ON comments(task_id, created_at);

    -- Set when the author rewrites their own comment, so the card can say so.
    -- Null means never touched since it was posted — the common case.
    ALTER TABLE comments ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;

    -- Task types, per project and editable by anyone who can see the project.
    -- Epic/Story/Task/Bug are seeded defaults, not built-ins.
    --
    -- tasks.kind stores this row's KEY, not its id. That keeps every existing
    -- task row valid with no migration, and means deleting a type can never
    -- leave a task pointing at a row that no longer exists — the delete route
    -- moves those tasks to a surviving type instead.
    CREATE TABLE IF NOT EXISTS task_kinds (
      id         TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      key        TEXT NOT NULL,
      label      TEXT NOT NULL,
      color      TEXT NOT NULL DEFAULT 'gray',
      -- Can hold children, the way Epic does. Structure follows the flag, not
      -- a hardcoded 'epic', so a type someone invents can group work too.
      is_group   BOOLEAN NOT NULL DEFAULT false,
      position   INT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS task_kinds_key_idx ON task_kinds(project_id, key);

    -- ── database properties ─────────────────────────────────────────────────
    -- A project is a database; these are its columns beyond the fixed task
    -- fields. Per-project and editable by anyone who can see the project,
    -- following the task_kinds precedent above.
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

    -- Property values, keyed by db_props.id. JSONB rather than an EAV table:
    -- reading a row needs no join and adding a property needs no migration.
    -- ponytail: filtering across databases on a property is a JSONB scan —
    -- add a GIN index here, or a real EAV table, if that ever measures slow.
    ALTER TABLE tasks ADD COLUMN IF NOT EXISTS props JSONB NOT NULL DEFAULT '{}';

    -- A doc's title save looks up its owning row by doc_id on every save,
    -- workspace-wide (not just row pages) — needs an index, not a scan.
    CREATE INDEX IF NOT EXISTS tasks_doc_idx ON tasks(doc_id) WHERE doc_id IS NOT NULL;

    -- Relation values are edges, not JSON: the foreign keys clear every edge
    -- pointing at a row that gets deleted, so no page renders a dead link.
    CREATE TABLE IF NOT EXISTS task_relations (
      prop_id TEXT NOT NULL REFERENCES db_props(id) ON DELETE CASCADE,
      from_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      to_id   TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      PRIMARY KEY (prop_id, from_id, to_id)
    );
    -- "which rows point at me" is what a row page asks on every open.
    CREATE INDEX IF NOT EXISTS task_relations_to_idx ON task_relations(to_id);

    -- A database can nest under another, the way folders and pages already do.
    -- NULL is top level. Cascade: a sub-database has no meaning without its
    -- parent, and its rows already cascade from projects.
    ALTER TABLE projects ADD COLUMN IF NOT EXISTS parent_id TEXT
      REFERENCES projects(id) ON DELETE CASCADE;
    CREATE INDEX IF NOT EXISTS projects_parent_idx ON projects(parent_id, position);
    -- 'tasks' = a board of work, with status, assignee, dates and the rest.
    -- 'data'  = a plain table of rows carrying only their custom properties.
    -- The columns are the same either way: switching mode hides fields, it
    -- never drops them, so a database can be flipped back with nothing lost.
    ALTER TABLE projects ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'tasks';
    -- Saved views: many named views over one database, each with its own
    -- filters, sort, grouping and visible properties. Until now a project had
    -- exactly one view per type and its filters were per *project*, so two
    -- differently-filtered boards could not both exist — and an embedded
    -- database could not differ from the project screen it mirrored.
    --
    -- config is one JSONB bag rather than six columns because every field in
    -- it is read and written together, by the client, as a unit: adding a sort
    -- direction should not be a migration.
    CREATE TABLE IF NOT EXISTS db_views (
      id         TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name       TEXT NOT NULL DEFAULT 'View',
      kind       TEXT NOT NULL DEFAULT 'table',
      position   INT NOT NULL DEFAULT 0,
      config     JSONB NOT NULL DEFAULT '{}',
      created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS db_views_project_idx ON db_views(project_id, position);

    -- Everything a property type needs that is not an option list: a formula's
    -- expression, a rollup's (relation, target, function). Same reasoning as
    -- db_views.config — one bag, written whole by the editor that owns it.
    ALTER TABLE db_props ADD COLUMN IF NOT EXISTS config JSONB NOT NULL DEFAULT '{}';
    -- The other half of a two-way relation. Self-referencing, nullable: a
    -- one-way relation (the only kind that used to exist) simply has none.
    ALTER TABLE db_props ADD COLUMN IF NOT EXISTS paired_prop_id TEXT
      REFERENCES db_props(id) ON DELETE SET NULL;
    -- True on the generated half. The rows live under the *defining* prop id,
    -- so the inverse reads task_relations backwards rather than duplicating it.
    ALTER TABLE db_props ADD COLUMN IF NOT EXISTS is_inverse BOOLEAN NOT NULL DEFAULT false;

    -- Per-project colours for the four fixed statuses, as { status: colour }.
    -- Only the colours: the statuses themselves are ids that every board
    -- column, filter and rollup in the app is written against, so they are
    -- repainted here, never renamed or invented. Missing keys fall back to the
    -- palette the app has always drawn (web-react/src/lib/builtinProps.ts).
    ALTER TABLE projects ADD COLUMN IF NOT EXISTS status_colors JSONB NOT NULL DEFAULT '{}';

    -- Was the last write typed, or made by the copilot on the person's behalf?
    --
    -- users.kind answers "which account"; this answers "which hand". Ask AI
    -- runs inside a person's own session, so there is no second account to
    -- mark — without this its edits are indistinguishable from their typing.
    -- 'human' for everything that already exists, which is what it was.
    --
    -- Down here rather than up beside users.kind, where it read better: this is
    -- one statement list executed in order, and on a database that does not
    -- exist yet neither docs nor tasks has been created at that point. A single
    -- failed statement rolls the whole thing back, so an ALTER above its own
    -- CREATE is a first boot that never finishes.
    ALTER TABLE docs ADD COLUMN IF NOT EXISTS updated_via TEXT NOT NULL DEFAULT 'human';
    ALTER TABLE tasks ADD COLUMN IF NOT EXISTS updated_via TEXT NOT NULL DEFAULT 'human';

    -- ── webhooks ────────────────────────────────────────────────────────────
    -- An outgoing HTTP POST per workspace event, so the things that live
    -- outside this database — CI, a chat channel, someone's script — hear about
    -- a change without polling for it.
    --
    -- The secret is stored in plaintext on purpose, unlike an API token: both
    -- ends have to compute the same HMAC, so a one-way hash would leave us
    -- unable to sign. It is shown only to an admin, and it grants nothing on
    -- its own — it proves a payload came from here, and nothing else.
    CREATE TABLE IF NOT EXISTS webhooks (
      id         TEXT PRIMARY KEY,
      url        TEXT NOT NULL,
      secret     TEXT NOT NULL,
      events     TEXT[] NOT NULL DEFAULT '{}',
      active     BOOLEAN NOT NULL DEFAULT true,
      created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- What we sent and what came back. Without it a webhook that silently
    -- stopped working looks exactly like one nothing has happened on — which is
    -- the whole question an operator asks. Trimmed to the newest rows per hook
    -- as they are written, so a busy workspace cannot grow this without bound.
    CREATE TABLE IF NOT EXISTS webhook_deliveries (
      id          TEXT PRIMARY KEY,
      webhook_id  TEXT NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
      event       TEXT NOT NULL,
      payload     JSONB NOT NULL DEFAULT '{}',
      status_code INT,
      error       TEXT,
      attempts    INT NOT NULL DEFAULT 0,
      ok          BOOLEAN NOT NULL DEFAULT false,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS webhook_deliveries_hook_idx
      ON webhook_deliveries(webhook_id, created_at DESC);

    -- ── agent runs ──────────────────────────────────────────────────────────
    -- The queue an external coding agent polls.
    --
    -- MCP is the pull half of letting machines in: the agent asks, the
    -- workspace answers. This is the push half — a task assigned to an agent
    -- account, or a comment that @-mentions one, becomes a row here, and the
    -- runner on someone's own machine claims it and does the work. The
    -- workspace never reaches out to the agent, so nothing has to be reachable
    -- from here: an agent behind a laptop firewall works exactly as well.
    --
    -- 'trigger' is a reserved word in SQL, hence trigger_kind.
    CREATE TABLE IF NOT EXISTS agent_runs (
      id           TEXT PRIMARY KEY,
      agent_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      task_id      TEXT REFERENCES tasks(id) ON DELETE CASCADE,
      doc_id       TEXT REFERENCES docs(id) ON DELETE SET NULL,
      trigger_kind TEXT NOT NULL DEFAULT 'manual',  -- assign | mention | manual
      status       TEXT NOT NULL DEFAULT 'queued',  -- queued | running | done | failed | cancelled
      prompt       TEXT NOT NULL DEFAULT '',
      result       TEXT NOT NULL DEFAULT '',
      error        TEXT,
      requested_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      started_at   TIMESTAMPTZ,
      finished_at  TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS agent_runs_queue_idx
      ON agent_runs(agent_id, created_at) WHERE status = 'queued';
    CREATE INDEX IF NOT EXISTS agent_runs_task_idx
      ON agent_runs(task_id, created_at DESC);
    -- One open run per agent per task. Re-assigning a task the agent is already
    -- working on is the same ask, not a second one — without this a board drag
    -- that touches assignees twice queues the work twice. A run with no task
    -- (a mention on a plain page) is exempt: NULLs are distinct here, which is
    -- what we want, since each mention really is its own ask.
    CREATE UNIQUE INDEX IF NOT EXISTS agent_runs_one_open_idx
      ON agent_runs(agent_id, task_id) WHERE status IN ('queued', 'running');

    -- ── automations ─────────────────────────────────────────────────────────
    -- "When a task enters this status, do these things." Also the storage for a
    -- quick action, which is the same list of actions with nobody firing it
    -- automatically — the difference is trigger_kind, not a second table.
    CREATE TABLE IF NOT EXISTS automations (
      id            TEXT PRIMARY KEY,
      project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name          TEXT NOT NULL DEFAULT '',
      trigger_kind  TEXT NOT NULL DEFAULT 'status',  -- status | manual
      trigger_value TEXT,                            -- the status entered, for 'status'
      actions       JSONB NOT NULL DEFAULT '[]',
      active        BOOLEAN NOT NULL DEFAULT true,
      position      INT NOT NULL DEFAULT 0,
      created_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS automations_project_idx ON automations(project_id, position);

    -- Which tasks a rule applies to, as the same {id, field, op, value} filter
    -- array saved views already store. Empty = every task, which is what a rule
    -- written before this column meant, so the default is the old behaviour.
    --
    -- A quick action without this is a button that does its thing to whatever
    -- you pressed it on; with it, "Send to review" can refuse to touch a task
    -- that is already there.
    ALTER TABLE automations ADD COLUMN IF NOT EXISTS condition JSONB NOT NULL DEFAULT '[]';

    -- ── webhook delivery, made durable ──────────────────────────────────────
    -- A hook whose endpoint has been dead for a while is a hook the worker
    -- should stop dialling. Reset to 0 by any delivery that lands, so a blip
    -- costs nothing and a decommissioned endpoint eventually switches itself
    -- off rather than occupying a retry slot forever.
    ALTER TABLE webhooks ADD COLUMN IF NOT EXISTS consecutive_failures INT NOT NULL DEFAULT 0;

    -- webhook_deliveries started as a log written after the fact. It is the
    -- queue as well now: emit inserts a 'queued' row and returns, and a
    -- worker delivers it. That is what makes a delivery survive a restart —
    -- the old code held the retry schedule in a setTimeout, so anything still
    -- retrying when the process died was simply lost.
    --
    -- Existing rows default to 'done' so the historical log stays a log.
    ALTER TABLE webhook_deliveries ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'done';
    ALTER TABLE webhook_deliveries ADD COLUMN IF NOT EXISTS attempt_at TIMESTAMPTZ NOT NULL DEFAULT now();
    -- The worker's claim query: due rows, oldest first.
    CREATE INDEX IF NOT EXISTS webhook_deliveries_due_idx
      ON webhook_deliveries(attempt_at) WHERE status = 'queued';

    -- ── task keys ──────────────────────────────────────────────────────────
    -- A task is quoted as MD-14, in chat and in commit messages, so its number
    -- has to be per project, stable and never reused. See task-key.js.
    ALTER TABLE projects ADD COLUMN IF NOT EXISTS key TEXT;
    -- The counter, bumped in the same statement that reads it, which is what
    -- makes two people creating a task at once get two different numbers.
    ALTER TABLE projects ADD COLUMN IF NOT EXISTS task_seq INT NOT NULL DEFAULT 0;
    ALTER TABLE tasks ADD COLUMN IF NOT EXISTS num INT;
    -- Case-insensitive: MD and md are the same key to everyone reading one.
    CREATE UNIQUE INDEX IF NOT EXISTS projects_key_idx
      ON projects(lower(key)) WHERE key IS NOT NULL;
    -- Deleted tasks keep their number: it is quoted elsewhere, and the row can
    -- come back out of the trash.
    CREATE UNIQUE INDEX IF NOT EXISTS tasks_num_idx
      ON tasks(project_id, num) WHERE num IS NOT NULL;
    -- Tasks are searchable from the palette, which reaches them by fuzzy title
    -- as well as by key. Same index shape docs_title_trgm_idx uses, for the
    -- same operator.
    CREATE INDEX IF NOT EXISTS tasks_title_trgm_idx
      ON tasks USING GIN (title gin_trgm_ops);

    -- ── work that comes back, and work you can size ────────────────────
    -- One of repeat.js's five rules, or NULL. Marking a task with one done
    -- creates the next occurrence — see the note at the top of that file for
    -- why completion drives this and not a clock.
    ALTER TABLE tasks ADD COLUMN IF NOT EXISTS repeat_rule TEXT;
    -- The occurrence this one was spawned by. It is what stops two people
    -- ticking the same repeating task at the same moment from creating two
    -- successors: the unique index below means the second INSERT loses, rather
    -- than the read-then-write in the PATCH handler being trusted to notice.
    -- Also the honest answer to "where did this come from".
    ALTER TABLE tasks ADD COLUMN IF NOT EXISTS repeat_of TEXT REFERENCES tasks(id) ON DELETE SET NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS tasks_repeat_of_idx
      ON tasks(repeat_of) WHERE repeat_of IS NOT NULL;
    -- Hours, to one decimal. Points size a sprint; hours size a week, and a
    -- database that holds only points cannot answer "is anyone overloaded".
    --
    -- DOUBLE PRECISION rather than NUMERIC, which would be the better type for
    -- money: node-postgres hands NUMERIC back as a *string*, because it will
    -- not silently lose precision — and every view here would then sort "10"
    -- before "9". The values are one-decimal hours that are summed for a bar
    -- chart, so a float loses nothing anybody can see. Rounding happens on the
    -- way in, in readHours.
    ALTER TABLE tasks ADD COLUMN IF NOT EXISTS estimate_h DOUBLE PRECISION;

    -- ── calendar subscription ──────────────────────────────────────
    -- The secret in a person's .ics URL. A calendar app sends no cookie and
    -- cannot sign in, so the URL has to carry its own proof — which is why this
    -- is a long random value the owner can revoke by asking for a new one, and
    -- why the feed it unlocks is read-only and shows one person's own work.
    ALTER TABLE users ADD COLUMN IF NOT EXISTS calendar_token TEXT;
    CREATE UNIQUE INDEX IF NOT EXISTS users_calendar_token_idx
      ON users(calendar_token) WHERE calendar_token IS NOT NULL;

    -- ── rules a clock sets off ──────────────────────────────────────
    -- Which of the swept rules has already fired for which task. A status
    -- change happens once by nature; "is overdue" is true every hour until
    -- somebody deals with it, so without this a rule would reassign the same
    -- task around the clock. The primary key IS the guard — the sweep inserts
    -- first and only acts on the rows it actually managed to claim.
    CREATE TABLE IF NOT EXISTS automation_fires (
      rule_id    TEXT NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
      task_id    TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      fired_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (rule_id, task_id)
    );

    -- ── intake forms ─────────────────────────────────────────────
    -- A public share link that writes instead of reads. The token IS the
    -- capability, and it grants exactly one thing: append a task to this
    -- database. NULL means the database has no form, which is the default and
    -- the only state it can be put back into.
    ALTER TABLE projects ADD COLUMN IF NOT EXISTS form_token TEXT;
    -- What the form says above the fields, in the words of whoever runs it.
    ALTER TABLE projects ADD COLUMN IF NOT EXISTS form_intro TEXT;
    CREATE UNIQUE INDEX IF NOT EXISTS projects_form_token_idx
      ON projects(form_token) WHERE form_token IS NOT NULL;

    -- Who the work came from, when it came from outside. A task made by a
    -- signed-in person has created_by; one made through a form has nobody, and
    -- "a bug report from nobody" is not worth having.
    ALTER TABLE tasks ADD COLUMN IF NOT EXISTS submitted_by TEXT;

    -- ── templates ────────────────────────────────────────────────
    -- A page that exists to be copied. Deliberately *not* hidden from the
    -- sidebar, search or All documents: a template is a real page people edit,
    -- and every list that would have to exclude it is a list that will one day
    -- forget to. It is marked, not hidden — the badge is the whole difference.
    ALTER TABLE docs ADD COLUMN IF NOT EXISTS is_template BOOLEAN NOT NULL DEFAULT false;

    -- A named starting point for a row in one database: the property values it
    -- begins with, and optionally a body for its page.
    --
    -- A table of its own rather than a flag on the tasks table, for the reason
    -- the doc flag above is not one: a template task would have to be excluded
    -- from the board, the table, the calendar, the gantt, search, the sweeper
    -- and every count — and a page that shows a template by mistake is untidy
    -- where a board that does is wrong.
    CREATE TABLE IF NOT EXISTS row_templates (
      id         TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name       TEXT NOT NULL DEFAULT 'Untitled',
      icon       TEXT NOT NULL DEFAULT '\u{1f4cb}',
      -- Values for the database's own properties, shaped like tasks.props.
      props      JSONB NOT NULL DEFAULT '{}',
      -- The built-in fields a row starts with: status, priority, kind, points,
      -- estimate_h, repeat_rule, assigneeIds. Loose on purpose — a release that
      -- adds a built-in should not need a migration here.
      fields     JSONB NOT NULL DEFAULT '{}',
      -- Markdown for the row's page, built into a Yjs state when used.
      body       TEXT,
      position   INT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS row_templates_project_idx ON row_templates(project_id, position);

    -- ── form fields ──────────────────────────────────────────────
    -- Which of this database's properties the public form asks for, and which
    -- of those it insists on: [{ "id": "<db_prop id>", "required": true }].
    -- Empty means the form is the two fields it has always been.
    ALTER TABLE projects ADD COLUMN IF NOT EXISTS form_fields JSONB NOT NULL DEFAULT '[]';
  `);

  await normalizeLegacyFolderImport();
  await relaxFavoritesKey();
  await seedTaskAssignees();
  await backfillTaskKeys();
  await clearBareKeyTitles();
}

/** Repair the rows the first backfill gave a key and nothing else.
 *
 *  It ran before withKey learned to leave an unnamed task alone, so a task with
 *  no title came out as "LAT-65: " — a key, a colon, and nothing to read. Its
 *  own marker rather than a fix inside backfillTaskKeys, because that one has
 *  already claimed its marker everywhere it has run. */
async function clearBareKeyTitles() {
  const marker = 'task-keys-empty-title-v1';
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const claimed = await client.query(
      'INSERT INTO schema_migrations (key) VALUES ($1) ON CONFLICT (key) DO NOTHING',
      [marker]
    );
    if (!claimed.rowCount) {
      await client.query('ROLLBACK');
      return;
    }
    await client.query(
      `UPDATE tasks SET title = ''
        WHERE num IS NOT NULL AND btrim(regexp_replace(title, $1, '')) = '' AND title <> ''`,
      [KEY_PREFIX]
    );
    // The pages of those tasks carried the same bare key across.
    await client.query(`
      UPDATE docs d SET title = 'Untitled'
        FROM tasks t
       WHERE t.doc_id = d.id AND t.title = '' AND d.title <> 'Untitled'
    `);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/** Give every project a key and every task a number, once, behind a marker.
 *
 *  Numbering runs in creation order, so a project's oldest task is its number 1
 *  and the backlog reads the way it was written. Titles are rewritten in SQL
 *  rather than row by row through the app: there is one statement per project
 *  table here, not one per task, and a workspace with fifty thousand tasks
 *  should not spend its boot on them. */
async function backfillTaskKeys() {
  const marker = 'task-keys-v1';
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const claimed = await client.query(
      'INSERT INTO schema_migrations (key) VALUES ($1) ON CONFLICT (key) DO NOTHING',
      [marker]
    );
    if (!claimed.rowCount) {
      await client.query('ROLLBACK');
      return;
    }
    // Keys are guessed in JS because deriving initials in SQL is a regex nobody
    // will want to read again, and because uniqueKey is the same function the
    // create route uses — one definition of what a key looks like.
    const { rows: projects } = await client.query(
      'SELECT id, name FROM projects ORDER BY created_at, id'
    );
    const taken = new Set();
    for (const p of projects) {
      const key = uniqueKey(deriveKey(p.name), taken);
      taken.add(key);
      await client.query('UPDATE projects SET key = $1 WHERE id = $2', [key, p.id]);
    }
    await client.query(`
      UPDATE tasks t SET num = s.n
        FROM (SELECT id, row_number() OVER (PARTITION BY project_id ORDER BY created_at, id) AS n
                FROM tasks) s
       WHERE s.id = t.id AND t.num IS NULL
    `);
    // An unnamed task keeps an empty title — see withKey. A row reading
    // "LAT-65:" with nothing after the colon is worse than the "Untitled" the
    // app draws for itself.
    await client.query(
      `UPDATE tasks t
          SET title = CASE WHEN btrim(regexp_replace(t.title, $1, '')) = '' THEN ''
                           ELSE p.key || '-' || t.num || ': ' || regexp_replace(t.title, $1, '')
                      END
         FROM projects p
        WHERE p.id = t.project_id AND t.num IS NOT NULL AND p.key IS NOT NULL`,
      [KEY_PREFIX]
    );
    // A task and its page carry the same name everywhere else in the app; they
    // would not here, and the mismatch would look like a bug on every task page.
    await client.query(`
      UPDATE docs d SET title = left(t.title, 200)
        FROM tasks t
       WHERE t.doc_id = d.id AND d.title <> left(t.title, 200)
    `);
    await client.query(`
      UPDATE projects p
         SET task_seq = coalesce((SELECT max(num) FROM tasks WHERE project_id = p.id), 0)
    `);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/** Give every task that already had an assignee its first row in
 *  task_assignees. Once, behind a marker: re-running it would resurrect an
 *  edge someone deliberately removed. */
async function seedTaskAssignees() {
  const marker = 'task-assignees-from-assignee-id-v1';
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const claimed = await client.query(
      'INSERT INTO schema_migrations (key) VALUES ($1) ON CONFLICT (key) DO NOTHING',
      [marker]
    );
    if (!claimed.rowCount) {
      await client.query('ROLLBACK');
      return;
    }
    await client.query(
      `INSERT INTO task_assignees (task_id, user_id, position)
       SELECT id, assignee_id, 0 FROM tasks WHERE assignee_id IS NOT NULL
       ON CONFLICT DO NOTHING`
    );
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/** Drop the (user_id, doc_id) primary key and add the one-target check.
 *  The PK drop and the CHECK add are not idempotent, so this runs exactly
 *  once behind a marker — and inside a transaction, so two instances booting
 *  together cannot both apply it. The DROP NOT NULL in between is idempotent
 *  on its own but has to happen here too: Postgres won't drop NOT NULL on a
 *  column that's still part of a primary key, so it must run after the PK
 *  is gone. */
async function relaxFavoritesKey() {
  const marker = 'favorites-allow-folder-targets-v1';
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const claimed = await client.query(
      'INSERT INTO schema_migrations (key) VALUES ($1) ON CONFLICT (key) DO NOTHING',
      [marker]
    );
    if (!claimed.rowCount) {
      await client.query('ROLLBACK');
      return;
    }
    await client.query('ALTER TABLE favorites DROP CONSTRAINT IF EXISTS favorites_pkey');
    await client.query('ALTER TABLE favorites ALTER COLUMN doc_id DROP NOT NULL');
    await client.query(`
      ALTER TABLE favorites ADD CONSTRAINT favorites_one_target
        CHECK ((doc_id IS NULL) <> (folder_id IS NULL))
    `);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function normalizeLegacyFolderImport() {
  const marker = 'folders-keep-documents-at-root-v2';
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Claiming the marker inside the transaction makes the migration exactly-once
    // even if two instances boot at the same time: the loser gets rowCount 0.
    const claimed = await client.query(
      'INSERT INTO schema_migrations (key) VALUES ($1) ON CONFLICT (key) DO NOTHING',
      [marker]
    );
    if (!claimed.rowCount) {
      await client.query('ROLLBACK');
      return;
    }
    const autoFolders = await client.query(
      'SELECT id FROM folders WHERE source_doc_id IS NOT NULL AND deleted_at IS NULL'
    );
    const ids = autoFolders.rows.map((row) => row.id);
    if (ids.length) {
      // The previous migration made folders out of documents. Undo only those
      // generated folders, never a folder the user created explicitly.
      await client.query('UPDATE docs SET folder_id = NULL WHERE folder_id = ANY($1)', [ids]);
      await client.query('UPDATE folders SET parent_id = NULL WHERE parent_id = ANY($1) AND source_doc_id IS NULL', [ids]);
      await client.query('UPDATE folders SET deleted_at = now() WHERE id = ANY($1)', [ids]);
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function findOrCreateUser(email) {
  const clean = email.trim().toLowerCase();
  const existing = await pool.query('SELECT * FROM users WHERE email = $1', [clean]);
  if (existing.rows[0]) return existing.rows[0];
  const id = crypto.randomUUID();
  const created = await pool.query(
    'INSERT INTO users (id, email, name) VALUES ($1, $2, $3) RETURNING *',
    [id, clean, clean.split('@')[0]]
  );
  return created.rows[0];
}

export async function findUserByUsername(username) {
  const { rows } = await pool.query('SELECT * FROM users WHERE username = $1', [
    String(username).trim().toLowerCase(),
  ]);
  return rows[0] ?? null;
}

export async function findUserByEmail(email) {
  const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [
    String(email).trim().toLowerCase(),
  ]);
  return rows[0] ?? null;
}

/** True once anybody has an account — i.e. the instance is past first-run setup. */
export async function hasAnyUser() {
  const { rows } = await pool.query('SELECT 1 FROM users LIMIT 1');
  return rows.length > 0;
}

// Arbitrary but fixed: every process that claims a fresh instance takes the
// same advisory lock, so two simultaneous setup requests can't both win.
const SETUP_LOCK = 8_140_711;

/**
 * Create the very first account, always as admin. Returns null when the
 * instance already has a user — that check and the insert share one
 * transaction, so a race resolves to exactly one admin rather than two.
 */
export async function createFirstAdmin({ name, username, email, passwordHash }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [SETUP_LOCK]);
    const taken = await client.query('SELECT 1 FROM users LIMIT 1');
    if (taken.rowCount) {
      await client.query('ROLLBACK');
      return null;
    }
    const { rows } = await client.query(
      `INSERT INTO users (id, email, name, username, password_hash, role)
       VALUES ($1, $2, $3, $4, $5, 'admin') RETURNING *`,
      [crypto.randomUUID(), email.trim().toLowerCase(), name.trim(), username.trim().toLowerCase(), passwordHash]
    );
    await client.query('COMMIT');
    return rows[0];
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function createUserWithPassword({ name, username, email, passwordHash, role = 'collaborator' }) {
  const id = crypto.randomUUID();
  const { rows } = await pool.query(
    `INSERT INTO users (id, email, name, username, password_hash, role)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [id, email.trim().toLowerCase(), name.trim(), username.trim().toLowerCase(), passwordHash, role]
  );
  return rows[0];
}

export async function isEmailInvited(email) {
  const clean = String(email).trim().toLowerCase();
  const i = await pool.query('SELECT 1 FROM invites WHERE email = $1', [clean]);
  return i.rowCount > 0;
}

export async function consumeInvite(email) {
  await pool.query('DELETE FROM invites WHERE email = $1', [String(email).trim().toLowerCase()]);
}

// Mint a session for an already-authenticated user (register/login share this).
export async function createSession(userId, days = 30) {
  const token = crypto.randomBytes(32).toString('base64url');
  await pool.query(
    `INSERT INTO sessions (token, user_id, expires_at)
     VALUES ($1, $2, now() + ($3 || ' days')::interval)`,
    [token, userId, String(days)]
  );
  return token;
}

export async function setPasswordHash(userId, passwordHash) {
  await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, userId]);
}

/** Sign out everywhere but here. A new password is worth nothing if the sessions
 *  opened under the old one keep working. */
export async function deleteOtherSessions(userId, keepToken) {
  const { rowCount } = await pool.query(
    'DELETE FROM sessions WHERE user_id = $1 AND token IS DISTINCT FROM $2',
    [userId, keepToken]
  );
  return rowCount;
}

export async function isEmailAllowedIn(email) {
  const clean = email.trim().toLowerCase();
  const u = await pool.query('SELECT 1 FROM users WHERE email = $1', [clean]);
  if (u.rowCount) return true;
  const i = await pool.query('SELECT 1 FROM invites WHERE email = $1', [clean]);
  return i.rowCount > 0;
}

export async function addInvite(email, invitedBy) {
  const clean = email.trim().toLowerCase();
  await pool.query(
    `INSERT INTO invites (email, invited_by) VALUES ($1, $2)
     ON CONFLICT (email) DO NOTHING`,
    [clean, invitedBy]
  );
}

export async function getSetting(key) {
  const { rows } = await pool.query('SELECT value FROM app_settings WHERE key = $1', [key]);
  return rows[0]?.value ?? null;
}

export async function setSetting(key, value) {
  await pool.query(
    `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, value]
  );
}

export async function userForSession(token) {
  if (!token) return null;
  const { rows } = await pool.query(
    `SELECT u.*, s.via AS session_via FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token = $1 AND s.expires_at > now()`,
    [token]
  );
  return rows[0] ?? null;
}

/** Spend a session's link provenance, so it may set a password exactly once. */
export async function clearSessionVia(token) {
  await pool.query('UPDATE sessions SET via = NULL WHERE token = $1', [token]);
}
