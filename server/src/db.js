import pg from 'pg';
import crypto from 'node:crypto';

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

    -- Username + password auth (added alongside magic-link, not replacing it).
    ALTER TABLE users ADD COLUMN IF NOT EXISTS username TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;
    -- Workspace-level role: 'admin' (can invite) or 'collaborator'.
    ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'collaborator';
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

    -- Per-user favorites (star). Absent row = not favorited.
    CREATE TABLE IF NOT EXISTS favorites (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      doc_id  TEXT NOT NULL REFERENCES docs(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, doc_id)
    );
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
    CREATE INDEX IF NOT EXISTS tasks_sprint_idx ON tasks(sprint_id) WHERE deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS tasks_assignee_idx
      ON tasks(assignee_id, due_at) WHERE deleted_at IS NULL;

    -- task depends on depends_on_id: the edge points backwards in time.
    CREATE TABLE IF NOT EXISTS task_deps (
      task_id       TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      depends_on_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      PRIMARY KEY (task_id, depends_on_id),
      CHECK (task_id <> depends_on_id)
    );
    CREATE INDEX IF NOT EXISTS task_deps_rev_idx ON task_deps(depends_on_id);
  `);

  await normalizeLegacyFolderImport();
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
    `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token = $1 AND s.expires_at > now()`,
    [token]
  );
  return rows[0] ?? null;
}
