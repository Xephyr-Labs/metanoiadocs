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
    -- Manual sibling ordering for the sidebar tree (drag-reorder). Lower first.
    ALTER TABLE docs ADD COLUMN IF NOT EXISTS position INT NOT NULL DEFAULT 0;
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
  `);
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
