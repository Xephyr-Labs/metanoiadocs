import http from 'node:http';
import { WebSocketServer } from 'ws';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express from 'express';
import * as cookie from 'cookie';
import { Hocuspocus } from '@hocuspocus/server';
import { Database } from '@hocuspocus/extension-database';
import bcrypt from 'bcryptjs';
import {
  pool,
  initSchema,
  userForSession,
  addInvite,
  findUserByUsername,
  findUserByEmail,
  createUserWithPassword,
  createSession,
  isEmailInvited,
  consumeInvite,
  hasAnyUser,
  createFirstAdmin,
  setPasswordHash,
  deleteOtherSessions,
} from './db.js';
import { requestMagicLink, consumeMagicLink, sendInviteEmail, sendNotificationEmail } from './auth.js';
import { lockedFor, noteFailure, clearFailures, lockoutError } from './throttle.js';
import { getSetting, setSetting } from './db.js';
import { buildDocState, appendToDocState, appendPageReference, extractText, extractBlocks, docToMarkdown } from './blocks.js';
import { printHtml } from './print.js';
import { docxFromMarkdown } from './docx.js';
import { topTerms, extractSignals, findMentions, simhash, hamming, keyphrases, summarize, tokenize, coalesceByKey, blocksFromText } from './intelligence.js';
import { registerTaskRoutes } from './tasks.js';
import { registerHomeRoutes } from './home.js';
import { registerFolderRoutes, visibleFolder } from './folders-routes.js';
import { TRASH_RETENTION_DAYS, startTrashSweeper } from './retention.js';
import OpenAI from 'openai';

process.on('unhandledRejection', (e) => console.error('[proc] unhandledRejection', e?.message || e));
process.on('uncaughtException',  (e) => console.error('[proc] uncaughtException', e?.message || e));

const PORT = Number(process.env.PORT || 3000);
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const COOKIE = 'md_session';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIST = path.resolve(__dirname, '../../web-react/dist');
const STALE_MONTHS = Number(process.env.STALE_MONTHS || 6);

await initSchema();

// One-shot backfill: compute signals for docs that don't have them yet. Runs
// sequentially in the background so a large workspace doesn't stampede the pool.
(async () => {
  try {
    const titles = (await pool.query('SELECT id, title FROM docs WHERE deleted_at IS NULL')).rows;
    const { rows } = await pool.query(
      `SELECT d.id FROM docs d LEFT JOIN doc_signals s ON s.doc_id=d.id
        WHERE d.deleted_at IS NULL AND s.doc_id IS NULL`);
    let n = 0;
    for (const r of rows) {
      await computeAndStoreSignals(r.id, '', titles);
      if (++n % 25 === 0) await new Promise((res) => setImmediate(res)); // yield to the event loop
    }
    if (rows.length) console.log('[intelligence] backfilled signals for', rows.length, 'docs');
  } catch (e) { console.error('[intelligence] backfill failed', e.message); }
})();

// A fresh instance has no accounts at all. It stays that way until either the
// browser setup screen claims it (POST /api/setup) or ADMIN_EMAIL +
// ADMIN_PASSWORD are supplied here for an unattended install. There is no
// default password: an instance nobody has claimed cannot be signed into.
async function seedAdminFromEnv() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) return;
  if (await hasAnyUser()) return;
  const admin = await createFirstAdmin({
    name: process.env.ADMIN_NAME || 'Admin',
    username: process.env.ADMIN_USERNAME || 'admin',
    email,
    passwordHash: await bcrypt.hash(password, 12),
  });
  if (admin) console.log(`[setup] seeded admin ${admin.email} from ADMIN_EMAIL/ADMIN_PASSWORD`);
}
await seedAdminFromEnv();

const app = express();
// Express 4 doesn't catch rejected promises from async handlers — wrap them.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
// Apply wrap centrally: every route handler registered from here on is covered,
// so a rejected await can never leave a request hanging until client timeout.
// Route methods only — error middleware (4-arg, via app.use) must keep its arity.
for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
  const orig = app[method].bind(app);
  app[method] = (path, ...handlers) =>
    orig(path, ...handlers.map((h) => (typeof h === 'function' ? wrap(h) : h)));
}
app.use(express.json());

// Liveness + readiness probe (no auth). Checks the DB round-trips.
app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true });
  } catch {
    res.status(503).json({ ok: false });
  }
});

function sessionToken(req) {
  return cookie.parse(req.headers.cookie || '')[COOKIE] || null;
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

// Resolve a request to a user via the session cookie OR an `Authorization: Bearer
// <token>` personal access token (for programmatic clients like the MCP server).
async function userForRequest(req) {
  const cookieUser = await userForSession(sessionToken(req));
  if (cookieUser) return cookieUser;
  const auth = req.headers.authorization || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const { rows } = await pool.query(
    `SELECT u.* FROM api_tokens t JOIN users u ON u.id = t.user_id WHERE t.token_hash = $1`,
    [sha256(m[1].trim())]
  );
  if (!rows[0]) return null;
  pool.query('UPDATE api_tokens SET last_used_at = now() WHERE token_hash = $1', [sha256(m[1].trim())]).catch(() => {});
  return rows[0];
}

async function requireUser(req, res, next) {
  const user = await userForRequest(req);
  if (!user) return res.status(401).json({ error: 'unauthorized' });
  req.user = user;
  next();
}

function setSessionCookie(res, token) {
  res.setHeader('Set-Cookie', cookie.serialize(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: BASE_URL.startsWith('https'),
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  }));
}

const publicUser = (u) => ({ id: u.id, email: u.email, name: u.name, username: u.username, role: u.role || 'collaborator' });

async function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Only an admin can do that.' });
  next();
}

// ── auth ──────────────────────────────────────────────────────────────────

/** The four account fields off a request body, normalised the one way. */
const accountFields = (body) => ({
  name: String(body?.name || '').trim(),
  username: String(body?.username || '').trim().toLowerCase(),
  email: String(body?.email || '').trim().toLowerCase(),
  password: String(body?.password || ''),
});

/** Shape rules shared by first-run setup and invited registration. */
function accountProblem({ name, username, email, password }) {
  if (name.length < 2) return 'Name must be at least 2 characters.';
  if (!/^[a-z0-9_.-]{3,32}$/.test(username)) return 'Username must be 3–32 chars: letters, numbers, . _ -';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return 'Enter a valid email address.';
  if (password.length < 8) return 'Password must be at least 8 characters.';
  return null;
}

const ALREADY_SET_UP = 'This workspace is already set up. Sign in instead.';

// Has anyone claimed this instance yet? The SPA asks on load and shows the
// setup screen instead of sign-in while the answer is no.
app.get('/api/setup', async (_req, res) => {
  res.json({ needed: !(await hasAnyUser()) });
});

// Claim a fresh instance. The first account is always the admin; the route
// refuses the moment any account exists, so it can't mint a second one.
app.post('/api/setup', async (req, res) => {
  const fields = accountFields(req.body);
  const problem = accountProblem(fields);
  if (problem) return res.status(400).json({ error: problem });
  const user = await createFirstAdmin({
    ...fields,
    passwordHash: await bcrypt.hash(fields.password, 12),
  });
  if (!user) return res.status(409).json({ error: ALREADY_SET_UP });
  const token = await createSession(user.id);
  setSessionCookie(res, token);
  console.log(`[setup] admin ${user.email} created — instance is ready`);
  res.json({ user: publicUser(user) });
});

// Username + password registration, invite-gated (see below) and unique on both
// username and email. Sets the same session cookie the magic-link flow uses.
app.post('/api/auth/register', async (req, res) => {
  const { name, username, email, password } = accountFields(req.body);
  const problem = accountProblem({ name, username, email, password });
  if (problem) return res.status(400).json({ error: problem });

  // Invite-only: an email may register only if an admin has invited it.
  if (!(await isEmailInvited(email))) {
    return res.status(403).json({ error: "This email hasn't been invited. Ask an admin for an invitation." });
  }
  if (await findUserByUsername(username)) return res.status(409).json({ error: 'That username is taken.' });
  if (await findUserByEmail(email)) return res.status(409).json({ error: 'An account with that email exists.' });

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await createUserWithPassword({ name, username, email, passwordHash, role: 'collaborator' });
  await consumeInvite(email);
  const token = await createSession(user.id);
  setSessionCookie(res, token);
  res.json({ user: publicUser(user) });
});

// Username-or-email + password login.
app.post('/api/auth/login', async (req, res) => {
  const id = String(req.body?.username || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  if (!id || !password) return res.status(400).json({ error: 'Enter your username and password.' });
  const mins = lockedFor(`login:${id}`);
  if (mins) return res.status(429).json({ error: lockoutError(mins) });
  const user = id.includes('@') ? await findUserByEmail(id) : await findUserByUsername(id);
  // Constant-ish work whether or not the user exists; generic error either way.
  const ok = user?.password_hash ? await bcrypt.compare(password, user.password_hash) : false;
  if (!ok) {
    noteFailure(`login:${id}`);
    return res.status(401).json({ error: 'Incorrect username or password.' });
  }
  clearFailures(`login:${id}`);
  const token = await createSession(user.id);
  setSessionCookie(res, token);
  res.json({ user: publicUser(user) });
});

// Change your own password. The current one is required: a borrowed session
// cookie must not be enough to lock the real owner out of their account.
app.post('/api/auth/password', requireUser, async (req, res) => {
  const current = String(req.body?.current || '');
  const next = String(req.body?.next || '');
  if (next.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters.' });
  if (next === current) return res.status(400).json({ error: "That's already your password." });

  const key = `pw:${req.user.id}`;
  const mins = lockedFor(key);
  if (mins) return res.status(429).json({ error: lockoutError(mins) });

  // A magic-link-only account has no hash to check against, so it has no
  // current password to prove — it signs in by email and doesn't come here.
  const ok = req.user.password_hash ? await bcrypt.compare(current, req.user.password_hash) : false;
  if (!ok) {
    noteFailure(key);
    return res.status(401).json({ error: 'Current password is incorrect.' });
  }
  clearFailures(key);

  await setPasswordHash(req.user.id, await bcrypt.hash(next, 12));
  // Bearer-token callers have no cookie to keep, so every session goes.
  const signedOut = await deleteOtherSessions(req.user.id, sessionToken(req));
  res.json({ ok: true, signedOut });
});

app.post('/api/auth/request', async (req, res) => {
  try {
    await requestMagicLink(req.body?.email, BASE_URL);
  } catch {
    // fall through — the response is identical either way on purpose
  }
  // Always 200: never reveal whether the address exists or is permitted.
  res.json({ ok: true });
});

app.get('/api/auth/verify', async (req, res) => {
  const result = await consumeMagicLink(String(req.query.token || ''));
  if (!result) return res.status(400).send('This sign-in link is invalid or has expired.');
  res.setHeader('Set-Cookie', cookie.serialize(COOKIE, result.session, {
    httpOnly: true,
    sameSite: 'lax',
    secure: BASE_URL.startsWith('https'),
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  }));
  res.redirect('/');
});

app.post('/api/auth/logout', async (req, res) => {
  const t = sessionToken(req);
  if (t) await pool.query('DELETE FROM sessions WHERE token = $1', [t]);
  res.setHeader('Set-Cookie', cookie.serialize(COOKIE, '', { path: '/', maxAge: 0 }));
  res.json({ ok: true });
});

app.get('/api/me', requireUser, (req, res) => {
  res.json(publicUser(req.user));
});

// Inbox: recent comments by other people on docs you can access.
// Per-user notification feed: @-mentions and comments on docs you own.
app.get('/api/inbox', requireUser, async (req, res) => {
  const { rows } = await pool.query(
    // comment_id ships too: a client that wants to answer a mention needs the
    // thread it landed in, and re-deriving that by matching bodies is guesswork.
    `SELECT n.id, n.kind, n.actor_name, n.body, n.read_at, n.created_at,
            n.doc_id, n.comment_id, d.title AS doc_title, d.icon AS doc_icon
       FROM notifications n
       LEFT JOIN docs d ON d.id = n.doc_id AND d.deleted_at IS NULL
      WHERE n.user_id = $1
      ORDER BY n.created_at DESC LIMIT 50`,
    [req.user.id]
  );
  res.json(rows);
});

app.get('/api/notifications/unread-count', requireUser, async (req, res) => {
  const { rows } = await pool.query(
    'SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL',
    [req.user.id]
  );
  res.json({ count: rows[0].n });
});

app.post('/api/notifications/read', requireUser, async (req, res) => {
  await pool.query(
    'UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL',
    [req.user.id]
  );
  res.json({ ok: true });
});

// Workspace members = everyone who has signed in (invite-only workspace).
app.get('/api/users', requireUser, async (_req, res) => {
  const { rows } = await pool.query(
    'SELECT id, name, email, username, role FROM users ORDER BY (role = $1) DESC, created_at ASC LIMIT 200',
    ['admin']
  );
  res.json(rows);
});

// ── personal access tokens (for the MCP server / programmatic clients) ───────
app.get('/api/tokens', requireUser, async (req, res) => {
  const { rows } = await pool.query(
    'SELECT id, name, created_at, last_used_at FROM api_tokens WHERE user_id = $1 ORDER BY created_at DESC',
    [req.user.id]
  );
  res.json(rows);
});

// Mint a token. The plaintext is returned ONCE; only its hash is stored.
app.post('/api/tokens', requireUser, async (req, res) => {
  const name = String(req.body?.name || '').trim().slice(0, 60) || 'API token';
  const secret = 'mtn_' + crypto.randomBytes(24).toString('base64url');
  const id = crypto.randomUUID();
  await pool.query(
    'INSERT INTO api_tokens (id, user_id, name, token_hash) VALUES ($1, $2, $3, $4)',
    [id, req.user.id, name, sha256(secret)]
  );
  res.json({ id, name, token: secret });
});

app.delete('/api/tokens/:id', requireUser, async (req, res) => {
  await pool.query('DELETE FROM api_tokens WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
  res.json({ ok: true });
});

// Update your own display name (the avatar is derived from it).
app.patch('/api/me', requireUser, async (req, res) => {
  const name = String(req.body?.name || '').trim().slice(0, 80);
  if (!name) return res.status(400).json({ error: 'name required' });
  await pool.query('UPDATE users SET name = $1 WHERE id = $2', [name, req.user.id]);
  res.json({ ok: true, name });
});

// Admin: change a member's role. Guards against demoting yourself or the last admin.
app.patch('/api/users/:id/role', requireUser, requireAdmin, async (req, res) => {
  const role = req.body?.role === 'admin' ? 'admin' : 'collaborator';
  if (req.params.id === req.user.id && role !== 'admin') {
    return res.status(400).json({ error: "You can't demote yourself." });
  }
  if (role === 'collaborator') {
    const admins = await pool.query("SELECT count(*)::int AS n FROM users WHERE role = 'admin'");
    if (admins.rows[0].n <= 1) return res.status(400).json({ error: 'The workspace needs at least one admin.' });
  }
  await pool.query('UPDATE users SET role = $1 WHERE id = $2', [role, req.params.id]);
  res.json({ ok: true, role });
});

// Admin: remove a member. Their owned docs transfer to you so nothing is orphaned.
app.delete('/api/users/:id', requireUser, requireAdmin, async (req, res) => {
  if (req.params.id === req.user.id) return res.status(400).json({ error: "You can't remove yourself." });
  const target = await pool.query('SELECT 1 FROM users WHERE id = $1', [req.params.id]);
  if (!target.rowCount) return res.status(404).json({ error: 'User not found.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const owned = await client.query("SELECT doc_id FROM doc_access WHERE user_id = $1 AND role = 'owner'", [req.params.id]);
    for (const r of owned.rows) {
      await client.query(
        `INSERT INTO doc_access (doc_id, user_id, role) VALUES ($1, $2, 'owner')
         ON CONFLICT (doc_id, user_id) DO UPDATE SET role = 'owner'`,
        [r.doc_id, req.user.id]
      );
    }
    await client.query('UPDATE docs SET created_by = $1 WHERE created_by = $2', [req.user.id, req.params.id]);
    await client.query('DELETE FROM users WHERE id = $1', [req.params.id]); // cascades sessions + remaining access
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  res.json({ ok: true });
});

// ── docs ──────────────────────────────────────────────────────────────────
// Paginated "documents I created" for the Home dashboard. Must register before
// any /api/docs/:id* route so 'mine' isn't captured as an id.
app.get('/api/docs/mine', requireUser, async (req, res) => {
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 8));
  const offset = Math.max(0, Number(req.query.offset) || 0);
  const { rows } = await pool.query(
    `SELECT d.id, d.title, d.icon, d.updated_at, count(*) OVER () AS total
       FROM docs d
      WHERE d.created_by = $1 AND d.deleted_at IS NULL
      ORDER BY d.updated_at DESC
      LIMIT $2 OFFSET $3`,
    [req.user.id, limit, offset]
  );
  res.json({
    total: rows[0] ? Number(rows[0].total) : 0,
    rows: rows.map(({ total, ...r }) => r),
  });
});

app.get('/api/docs', requireUser, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT d.id, d.title, d.icon, d.folder_id, d.position, d.updated_at,
            coalesce(a.role, 'editor') AS role, d.visibility,
            (d.share_token IS NOT NULL) AS shared,
            (f.doc_id IS NOT NULL) AS favorite,
            lk.link_count,
            tg.tags
       FROM docs d
       LEFT JOIN LATERAL (
         SELECT count(*)::int AS link_count
           FROM doc_links l JOIN docs t ON t.id = l.to_id AND t.deleted_at IS NULL
          WHERE l.from_id = d.id
       ) lk ON true
       LEFT JOIN doc_access a ON a.doc_id = d.id AND a.user_id = $1
       LEFT JOIN favorites f ON f.doc_id = d.id AND f.user_id = $1
       LEFT JOIN LATERAL (
         SELECT coalesce(
           json_agg(json_build_object('id', t.id, 'name', t.name, 'color', t.color)
                    ORDER BY t.name), '[]') AS tags
           FROM doc_tags dt JOIN tags t ON t.id = dt.tag_id
          WHERE dt.doc_id = d.id
       ) tg ON true
      WHERE d.deleted_at IS NULL
        AND (a.user_id IS NOT NULL OR d.visibility = 'team')
      ORDER BY d.position ASC, d.updated_at DESC`,
    [req.user.id]
  );
  res.json(rows);
});

// Manual sidebar order. The client sends the container's full list in its new
// order rather than one moved id, so the result never depends on what the
// server thinks the old order was — two people dragging at once converge on
// whichever list landed last instead of interleaving into nonsense.
//
// Position and folder move together: dropping a page between two pages in
// another folder is one gesture and must not be able to half-apply.
app.post('/api/docs/reorder', requireUser, wrap(async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter((v) => typeof v === 'string').slice(0, 2000) : [];
  if (!ids.length) return res.status(400).json({ error: 'ids required' });
  const folderId = typeof req.body?.folderId === 'string' ? req.body.folderId : null;
  if (folderId && !(await visibleFolder(folderId, req.user.id))) {
    return res.status(403).json({ error: 'folder not accessible' });
  }
  // The access predicate is the same one /api/docs lists by, so a page you
  // cannot see is silently skipped rather than reordered on your say-so.
  const { rowCount } = await pool.query(
    `UPDATE docs d
        SET position = o.pos, folder_id = $3
       FROM (SELECT id, ordinality - 1 AS pos
               FROM unnest($1::text[]) WITH ORDINALITY AS t(id, ordinality)) o
      WHERE d.id = o.id
        AND d.deleted_at IS NULL
        AND (d.visibility = 'team'
             OR EXISTS (SELECT 1 FROM doc_access a WHERE a.doc_id = d.id AND a.user_id = $2))`,
    [ids, req.user.id, folderId],
  );
  res.json({ ok: true, moved: rowCount });
}));

app.post('/api/docs', requireUser, async (req, res) => {
  const id = crypto.randomUUID();
  const title = String(req.body?.title || 'Untitled').slice(0, 200);
  const icon = String(req.body?.icon || '📄').slice(0, 8);
  const folderId = typeof req.body?.folderId === 'string' ? req.body.folderId : null;
  const visibility = req.body?.visibility === 'private' ? 'private' : 'team';
  // Optional markdown body (used by the MCP server / API clients). Built into a
  // BlockSuite Yjs state so the doc opens with real content.
  const content = typeof req.body?.content === 'string' ? req.body.content : null;
  if (folderId && !(await visibleFolder(folderId, req.user.id))) {
    return res.status(403).json({ error: 'folder not accessible' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'INSERT INTO docs (id, title, icon, created_by, folder_id, visibility) VALUES ($1, $2, $3, $4, $5, $6)',
      [id, title, icon, req.user.id, folderId, visibility]
    );
    await client.query(
      `INSERT INTO doc_access (doc_id, user_id, role) VALUES ($1, $2, 'owner')`,
      [id, req.user.id]
    );
    if (content) {
      const state = Buffer.from(buildDocState(title, content));
      await client.query('INSERT INTO doc_states (doc_id, state) VALUES ($1, $2)', [id, state]);
      await client.query('UPDATE docs SET search_text = $1 WHERE id = $2', [content.slice(0, 100000), id]);
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  res.json({ id, title, icon, parent_id: null, folder_id: folderId, role: 'owner', visibility, shared: false, favorite: false });
});

/**
 * Create a page nested under another — the sidebar's "Add a page inside".
 *
 * The nesting is a reference in the parent's own body, not a column, because
 * that is what the sidebar's disclosure reads and, more importantly, what
 * survives the parent's next edit: saving a document REPLACES its stored link
 * set with whatever references its content actually holds, so a link recorded
 * only in the table would be deleted the next time somebody typed in the parent.
 *
 * The reference is written through a Hocuspocus direct connection rather than
 * into doc_states, so it reaches anyone who has the parent open right now and is
 * persisted by the same path a typed edit takes. Writing the state row behind a
 * live session's back would just be overwritten by that session.
 */
app.post('/api/docs/:id/children', requireUser, wrap(async (req, res) => {
  const parentId = req.params.id;
  if (!(await grantOn(parentId, req.user.id))) return res.status(403).json({ error: 'forbidden' });
  const parent = await pool.query(
    'SELECT title, folder_id, visibility FROM docs WHERE id = $1 AND deleted_at IS NULL',
    [parentId],
  );
  if (!parent.rows[0]) return res.status(404).json({ error: 'not found' });

  const id = crypto.randomUUID();
  const title = String(req.body?.title || 'Untitled').slice(0, 200);
  const icon = String(req.body?.icon || '📄').slice(0, 8);

  // Write the reference first: a child nobody can reach from its parent is worse
  // than no child at all, and this is the step that can fail.
  let linked = false;
  const conn = await hocuspocus.openDirectConnection(parentId);
  try {
    await conn.transact((doc) => { linked = appendPageReference(doc, id); });
  } finally {
    await conn.disconnect();
  }
  if (!linked) return res.status(409).json({ error: 'That page has no body to add a child to yet — open it once first.' });

  // The child keeps the parent's company: same folder, same visibility.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'INSERT INTO docs (id, title, icon, created_by, folder_id, visibility) VALUES ($1, $2, $3, $4, $5, $6)',
      [id, title, icon, req.user.id, parent.rows[0].folder_id, parent.rows[0].visibility],
    );
    await client.query(`INSERT INTO doc_access (doc_id, user_id, role) VALUES ($1, $2, 'owner')`, [id, req.user.id]);
    // The parent's next save recomputes this from its content and will find the
    // same reference; recording it now is what makes the arrow appear at once.
    await client.query('INSERT INTO doc_links (from_id, to_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [parentId, id]);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  res.json({ id, title, icon, folder_id: parent.rows[0].folder_id, visibility: parent.rows[0].visibility });
}));

// Read a doc's title + plain text (decoded from the Yjs state; used by API clients).
app.get('/api/docs/:id/text', requireUser, async (req, res) => {
  if (!(await grantOn(req.params.id, req.user.id))) return res.status(403).json({ error: 'forbidden' });
  const d = await pool.query('SELECT title FROM docs WHERE id = $1 AND deleted_at IS NULL', [req.params.id]);
  if (!d.rows[0]) return res.status(404).json({ error: 'not found' });
  const s = await pool.query('SELECT state FROM doc_states WHERE doc_id = $1', [req.params.id]);
  let text = '';
  if (s.rows[0]) { try { text = extractText(s.rows[0].state).text; } catch { /* empty */ } }
  res.json({ id: req.params.id, title: d.rows[0].title, text });
});

// ── export ──────────────────────────────────────────────────────────────────

/** A safe download filename stem — also keeps quotes/newlines out of the header. */
const fileSlug = (s) =>
  String(s || '').normalize('NFKD').replace(/[^\w\s-]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60).toLowerCase()
  || 'document';

/**
 * One document as markdown, for both export routes. Page references render as
 * `[[Title]]`, which is exactly what the importer reads back in, and images
 * point at the blob endpoint so a printed page still shows them.
 */
async function docAsMarkdown(id, userId) {
  if (!(await grantOn(id, userId))) return { status: 403 };
  const d = await pool.query(
    'SELECT title, icon, updated_at FROM docs WHERE id = $1 AND deleted_at IS NULL', [id]);
  if (!d.rows[0]) return { status: 404 };
  const s = await pool.query('SELECT state FROM doc_states WHERE doc_id = $1', [id]);
  // Titles for [[reference]] rendering. Two columns over a table that holds one
  // row per document — cheap enough not to bother narrowing to the ids used.
  const titles = new Map(
    (await pool.query('SELECT id, title FROM docs WHERE deleted_at IS NULL')).rows.map((r) => [r.id, r.title]));
  let markdown = '';
  if (s.rows[0]) {
    try {
      // A doc that has never been opened has no state row; one with a state we
      // cannot decode exports empty rather than failing the whole request.
      markdown = docToMarkdown(s.rows[0].state, { resolveTitle: (pid) => titles.get(pid) || null }).markdown;
    } catch { /* empty body */ }
  }
  return { status: 200, ...d.rows[0], markdown };
}

// Download a doc as a .md file.
app.get('/api/docs/:id/export.md', requireUser, async (req, res) => {
  const out = await docAsMarkdown(req.params.id, req.user.id);
  if (out.status !== 200) return res.status(out.status).json({ error: out.status === 403 ? 'forbidden' : 'not found' });
  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${fileSlug(out.title)}.md"`);
  res.send(`# ${out.title}\n\n${out.markdown}\n`);
});

// Download a doc as Word. Built from the same markdown the PDF export renders,
// so the two never disagree about what the document contains (see docx.js).
app.get('/api/docs/:id/export.docx', requireUser, wrap(async (req, res) => {
  const out = await docAsMarkdown(req.params.id, req.user.id);
  if (out.status !== 200) return res.status(out.status).json({ error: out.status === 403 ? 'forbidden' : 'not found' });
  const buf = await docxFromMarkdown({
    title: out.title,
    markdown: out.markdown,
    meta: `Last edited ${new Date(out.updated_at).toISOString().slice(0, 10)}`,
    // Images live in our own blob table, so pull the bytes straight from there
    // rather than having the server make an HTTP request to itself.
    loadImage: async (url) => {
      const key = /^\/api\/blob\/([^/?#]+)/.exec(url)?.[1];
      if (!key) return null;
      const { rows } = await pool.query('SELECT mime, data FROM blobs WHERE key = $1', [decodeURIComponent(key)]);
      return rows[0] ? { mime: rows[0].mime, data: rows[0].data } : null;
    },
  });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  res.setHeader('Content-Disposition', `attachment; filename="${fileSlug(out.title)}.docx"`);
  res.send(buf);
}));

// Print-ready HTML — the browser turns it into the PDF (see print.js).
app.get('/api/docs/:id/print', requireUser, async (req, res) => {
  const out = await docAsMarkdown(req.params.id, req.user.id);
  if (out.status !== 200) return res.status(out.status).json({ error: out.status === 403 ? 'forbidden' : 'not found' });
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(printHtml({
    title: out.title,
    icon: out.icon,
    markdown: out.markdown,
    meta: `Last edited ${new Date(out.updated_at).toISOString().slice(0, 10)}`,
    // ?auto=0 opens the page without the print dialog, for checking the layout.
    auto: req.query.auto !== '0',
  }));
});

// Write markdown content to a doc: mode 'append' (default) or 'replace'. Editors
// see the change on their next open/reload (this writes the persisted state).
app.post('/api/docs/:id/content', requireUser, async (req, res) => {
  if (!(await grantOn(req.params.id, req.user.id))) return res.status(403).json({ error: 'forbidden' });
  const markdown = String(req.body?.markdown || '');
  const mode = req.body?.mode === 'replace' ? 'replace' : 'append';
  const d = await pool.query('SELECT title FROM docs WHERE id = $1 AND deleted_at IS NULL', [req.params.id]);
  if (!d.rows[0]) return res.status(404).json({ error: 'not found' });
  const cur = await pool.query('SELECT state FROM doc_states WHERE doc_id = $1', [req.params.id]);
  let state;
  if (mode === 'replace' || !cur.rows[0]) {
    state = Buffer.from(buildDocState(d.rows[0].title, markdown));
  } else {
    state = Buffer.from(appendToDocState(cur.rows[0].state, markdown));
  }
  await pool.query(
    `INSERT INTO doc_states (doc_id, state, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (doc_id) DO UPDATE SET state = EXCLUDED.state, updated_at = now()`,
    [req.params.id, state]
  );
  // Keep search current from the freshly-decoded text.
  try {
    const { text } = extractText(state);
    await pool.query('UPDATE docs SET search_text = $1, updated_at = now() WHERE id = $2', [text.slice(0, 100000), req.params.id]);
  } catch { /* noop */ }
  res.json({ ok: true });
});

// Toggle a doc between team-visible and private (owner only). Private keeps only
// the owner + anyone explicitly shared via doc_access; team is visible to all.
app.put('/api/docs/:id/visibility', requireUser, async (req, res) => {
  const grant = await pool.query(
    'SELECT role FROM doc_access WHERE doc_id = $1 AND user_id = $2',
    [req.params.id, req.user.id]
  );
  if (grant.rows[0]?.role !== 'owner') return res.status(403).json({ error: 'forbidden' });
  const visibility = req.body?.visibility === 'private' ? 'private' : 'team';
  await pool.query('UPDATE docs SET visibility = $1, updated_at = now() WHERE id = $2', [visibility, req.params.id]);
  // WS access is authorized once at the upgrade. Going private, drop live sockets
  // so every client reconnects and re-checks grantOn — otherwise an editor who had
  // the doc open keeps read+write until they happen to reconnect.
  if (visibility === 'private') {
    try { hocuspocus.closeConnections(req.params.id); } catch { /* noop */ }
  }
  res.json({ ok: true, visibility });
});

// Toggle a favorite for the current user.
app.put('/api/docs/:id/favorite', requireUser, async (req, res) => {
  if (!(await grantOn(req.params.id, req.user.id))) return res.status(403).json({ error: 'forbidden' });
  if (req.body?.favorite === false) {
    await pool.query('DELETE FROM favorites WHERE user_id = $1 AND doc_id = $2', [req.user.id, req.params.id]);
  } else {
    await pool.query(
      `INSERT INTO favorites (user_id, doc_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [req.user.id, req.params.id]
    );
  }
  res.json({ ok: true });
});

// --- Tags (workspace-global, AFFiNE-style) ---------------------------------

const TAG_COLORS = ['gray', 'red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink'];

// All tags + how many docs carry each.
app.get('/api/tags', requireUser, async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT t.id, t.name, t.color, count(dt.doc_id)::int AS count
       FROM tags t LEFT JOIN doc_tags dt ON dt.tag_id = t.id
      GROUP BY t.id ORDER BY t.name ASC`
  );
  res.json(rows);
});

// Create a tag (or return the existing one with that name).
app.post('/api/tags', requireUser, async (req, res) => {
  const name = String(req.body?.name || '').trim().slice(0, 50);
  if (!name) return res.status(400).json({ error: 'name required' });
  const color = TAG_COLORS.includes(req.body?.color) ? req.body.color : 'gray';
  const existing = await pool.query('SELECT id, name, color FROM tags WHERE lower(name) = lower($1)', [name]);
  if (existing.rows[0]) return res.json(existing.rows[0]);
  const id = crypto.randomUUID();
  const { rows } = await pool.query(
    'INSERT INTO tags (id, name, color) VALUES ($1, $2, $3) RETURNING id, name, color',
    [id, name, color]
  );
  res.json(rows[0]);
});

// Delete a tag globally (detaches from every doc via cascade). Admin-only: tags
// are workspace-global, so deletion affects docs the caller may not even see.
app.delete('/api/tags/:id', requireUser, requireAdmin, async (req, res) => {
  await pool.query('DELETE FROM tags WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

// Attach a tag to a doc. Body: { tagId } or { name, color } to create+attach.
app.post('/api/docs/:id/tags', requireUser, async (req, res) => {
  if (!(await grantOn(req.params.id, req.user.id))) return res.status(403).json({ error: 'forbidden' });
  let tagId = req.body?.tagId;
  if (!tagId) {
    const name = String(req.body?.name || '').trim().slice(0, 50);
    if (!name) return res.status(400).json({ error: 'tagId or name required' });
    const color = TAG_COLORS.includes(req.body?.color) ? req.body.color : 'gray';
    const existing = await pool.query('SELECT id FROM tags WHERE lower(name) = lower($1)', [name]);
    if (existing.rows[0]) tagId = existing.rows[0].id;
    else {
      tagId = crypto.randomUUID();
      await pool.query('INSERT INTO tags (id, name, color) VALUES ($1, $2, $3)', [tagId, name, color]);
    }
  }
  await pool.query(
    'INSERT INTO doc_tags (doc_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [req.params.id, tagId]
  );
  const { rows } = await pool.query('SELECT id, name, color FROM tags WHERE id = $1', [tagId]);
  res.json(rows[0]);
});

// Detach a tag from a doc.
app.delete('/api/docs/:id/tags/:tagId', requireUser, async (req, res) => {
  if (!(await grantOn(req.params.id, req.user.id))) return res.status(403).json({ error: 'forbidden' });
  await pool.query('DELETE FROM doc_tags WHERE doc_id = $1 AND tag_id = $2', [req.params.id, req.params.tagId]);
  res.json({ ok: true });
});

// Collaborators on a doc (for the share dialog).
app.get('/api/docs/:id/access', requireUser, async (req, res) => {
  if (!(await grantOn(req.params.id, req.user.id))) return res.status(403).json({ error: 'forbidden' });
  const { rows } = await pool.query(
    `SELECT u.id, u.name, u.email, a.role
       FROM doc_access a JOIN users u ON u.id = a.user_id
      WHERE a.doc_id = $1
      ORDER BY (a.role = 'owner') DESC, u.name ASC`,
    [req.params.id]
  );
  res.json(rows);
});

// Share with a teammate. No seat check — that is the entire point of this build.
app.post('/api/docs/:id/share', requireUser, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT role FROM doc_access WHERE doc_id = $1 AND user_id = $2`,
    [req.params.id, req.user.id]
  );
  if (rows[0]?.role !== 'owner') return res.status(403).json({ error: 'forbidden' });

  const email = String(req.body?.email || '').trim().toLowerCase();
  const target = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
  if (!target.rows[0]) return res.status(404).json({ error: 'user has not signed in yet' });

  await pool.query(
    `INSERT INTO doc_access (doc_id, user_id, role) VALUES ($1, $2, 'editor')
     ON CONFLICT (doc_id, user_id) DO NOTHING`,
    [req.params.id, target.rows[0].id]
  );
  res.json({ ok: true });
});

// Rename and/or move a doc in the sidebar tree. Any grant lets you edit;
// move guards against making a doc its own ancestor (a cycle).
app.patch('/api/docs/:id', requireUser, async (req, res) => {
  if (!(await grantOn(req.params.id, req.user.id))) return res.status(403).json({ error: 'forbidden' });

  const sets = [];
  const vals = [];
  if (typeof req.body?.title === 'string') {
    vals.push(req.body.title.slice(0, 200));
    sets.push(`title = $${vals.length}`);
  }
  if (typeof req.body?.icon === 'string') {
    vals.push(req.body.icon.slice(0, 8));
    sets.push(`icon = $${vals.length}`);
  }
  if ('folderId' in (req.body || {})) {
    const folderId = typeof req.body.folderId === 'string' ? req.body.folderId : null;
    if (folderId && !(await visibleFolder(folderId, req.user.id))) {
      return res.status(403).json({ error: 'folder not accessible' });
    }
    vals.push(folderId);
    sets.push(`folder_id = $${vals.length}`);
  }
  if (!sets.length) return res.json({ ok: true });
  vals.push(req.params.id);
  await pool.query(
    `UPDATE docs SET ${sets.join(', ')}, updated_at = now() WHERE id = $${vals.length}`,
    vals
  );
  res.json({ ok: true });
});

// Trash: soft-deleted docs the user had access to, newest first.
// Everyone who can see a trashed page can restore it; only its owner (or an
// admin) can destroy it. `can_delete` ships with the row so the UI can hide the
// control instead of offering it and then failing with a 403.
const TRASH_VISIBLE = `d.deleted_at IS NOT NULL AND (a.user_id IS NOT NULL OR d.visibility = 'team')`;

app.get('/api/docs/trash', requireUser, async (req, res) => {
  const { rows } = await pool.query(
    // purge_at is computed here rather than on the client so the countdown and
    // the sweeper can never disagree about the window.
    `SELECT d.id, d.title, d.icon, d.deleted_at,
            d.deleted_at + ($3 || ' days')::interval AS purge_at,
            COALESCE($2 OR a.role = 'owner', false) AS can_delete
       FROM docs d LEFT JOIN doc_access a ON a.doc_id = d.id AND a.user_id = $1
      WHERE ${TRASH_VISIBLE}
      ORDER BY d.deleted_at DESC LIMIT 100`,
    [req.user.id, req.user.role === 'admin', String(TRASH_RETENTION_DAYS)]
  );
  res.json({ retentionDays: TRASH_RETENTION_DAYS, rows });
});

// Destroy every trashed page this user is allowed to destroy. Pages they can
// see but do not own are left alone and reported back, so "empty" never
// silently means "emptied less than you asked for".
app.post('/api/docs/trash/empty', requireUser, wrap(async (req, res) => {
  const isAdmin = req.user.role === 'admin';
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT d.id, COALESCE($2 OR a.role = 'owner', false) AS can_delete
         FROM docs d LEFT JOIN doc_access a ON a.doc_id = d.id AND a.user_id = $1
        WHERE ${TRASH_VISIBLE}
        FOR UPDATE OF d`,
      [req.user.id, isAdmin]
    );
    const ids = rows.filter((r) => r.can_delete).map((r) => r.id);
    if (ids.length) {
      // One page in the set can be another's parent, and parent_id is NO ACTION
      // — detach every child of the whole set before deleting any of it.
      await client.query('UPDATE docs SET parent_id = NULL WHERE parent_id = ANY($1)', [ids]);
      await client.query('DELETE FROM docs WHERE id = ANY($1)', [ids]);
    }
    await client.query('COMMIT');
    res.json({ deleted: ids.length, skipped: rows.length - ids.length });
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}));

// Grant on a doc that is already in the trash. grantOn's team fallback requires
// `deleted_at IS NULL`, so once a team doc is trashed everyone but its owner
// loses their grant — which meant the trash listed docs to members that they
// then could not restore. Trash actions use this instead.
async function trashGrantOn(docId, userId) {
  const g = await pool.query('SELECT role FROM doc_access WHERE doc_id = $1 AND user_id = $2', [docId, userId]);
  if (g.rows[0]) return g.rows[0].role;
  const t = await pool.query(
    "SELECT 1 FROM docs WHERE id = $1 AND visibility = 'team' AND deleted_at IS NOT NULL",
    [docId]
  );
  return t.rowCount ? 'editor' : null;
}

// Restore a trashed doc (any grant on it).
app.post('/api/docs/:id/restore', requireUser, async (req, res) => {
  if (!(await trashGrantOn(req.params.id, req.user.id))) return res.status(403).json({ error: 'forbidden' });
  await pool.query('UPDATE docs SET deleted_at = NULL, updated_at = now() WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

// Delete a trashed doc for good. Every child row (state, comments, versions,
// links, tags, terms, signals, favourites, notifications) is ON DELETE CASCADE;
// projects and tasks that referenced it keep existing with a null doc_id.
app.delete('/api/docs/:id/permanent', requireUser, wrap(async (req, res) => {
  const { rows } = await pool.query('SELECT deleted_at, title FROM docs WHERE id = $1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'not found' });
  // Trash-only: this must never become a one-click bypass of the recoverable
  // path. A doc has to be soft-deleted before it can be destroyed.
  if (!rows[0].deleted_at) return res.status(409).json({ error: 'Move the page to the trash first.' });

  // Stricter than the soft delete, because there is no undo: the owner or an
  // admin, not merely anyone who could edit it.
  const role = await trashGrantOn(req.params.id, req.user.id);
  if (role !== 'owner' && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Only the page owner or an admin can delete a page permanently.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // docs.parent_id is NO ACTION, so a surviving child would block the delete.
    // Soft-delete already detaches children; this covers anything re-parented since.
    await client.query('UPDATE docs SET parent_id = NULL WHERE parent_id = $1', [req.params.id]);
    await client.query('DELETE FROM docs WHERE id = $1', [req.params.id]);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  res.json({ ok: true });
}));

// Soft-delete a doc (owner only). Children re-parent to top level via the
// ON DELETE SET NULL fk only on hard delete, so here we just detach them.
app.delete('/api/docs/:id', requireUser, async (req, res) => {
  // Delete is a soft-delete to trash (recoverable), so any member who can edit
  // the doc may remove it — team docs by any member, private docs by the owner
  // or anyone it's shared with. Matches the team-editable model (grantOn).
  if (!(await grantOn(req.params.id, req.user.id))) return res.status(403).json({ error: 'forbidden' });
  // Detach children then soft-delete atomically, so a crash between the two can't
  // leave children orphaned under a still-live parent.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE docs SET parent_id = NULL WHERE parent_id = $1', [req.params.id]);
    await client.query('UPDATE docs SET deleted_at = now() WHERE id = $1', [req.params.id]);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  res.json({ ok: true });
});

// Public read-only share. Owner-gated. GET reads current token; POST mints (or
// returns) one; DELETE revokes it. The token is the whole capability — anyone
// with the link reads.
app.get('/api/docs/:id/public', requireUser, async (req, res) => {
  if (!(await grantOn(req.params.id, req.user.id)))
    return res.status(403).json({ error: 'forbidden' });
  const { rows } = await pool.query('SELECT share_token FROM docs WHERE id = $1', [req.params.id]);
  res.json({ token: rows[0]?.share_token || null });
});

app.post('/api/docs/:id/public', requireUser, async (req, res) => {
  if ((await grantOn(req.params.id, req.user.id)) !== 'owner')
    return res.status(403).json({ error: 'forbidden' });
  const cur = await pool.query('SELECT share_token FROM docs WHERE id = $1', [req.params.id]);
  let token = cur.rows[0]?.share_token;
  if (!token) {
    token = crypto.randomBytes(16).toString('base64url');
    await pool.query('UPDATE docs SET share_token = $1 WHERE id = $2', [token, req.params.id]);
  }
  res.json({ token });
});

app.delete('/api/docs/:id/public', requireUser, async (req, res) => {
  if ((await grantOn(req.params.id, req.user.id)) !== 'owner')
    return res.status(403).json({ error: 'forbidden' });
  await pool.query('UPDATE docs SET share_token = NULL WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

// Resolve a public share token to its doc — the only unauthenticated doc read.
app.get('/api/public/:token', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, title FROM docs WHERE share_token = $1 AND deleted_at IS NULL`,
    [req.params.token]
  );
  if (!rows[0]) return res.status(404).json({ error: 'not found' });
  res.json({ id: rows[0].id, title: rows[0].title });
});

// Invite someone to the workspace. Invite-only means this is how new people
// get in; any signed-in member may invite (trusted internal team).
app.post('/api/invites', requireUser, requireAdmin, async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return res.status(400).json({ error: 'invalid email' });
  }
  await addInvite(email, req.user.id);
  // Record the allowlist row AND actually send the invitation email.
  try {
    await sendInviteEmail(email, BASE_URL, req.user.name);
  } catch (err) {
    console.error(`[invite] failed to email ${email}:`, err.message);
    return res.status(502).json({ error: 'Invite saved but the email failed to send.' });
  }
  res.json({ ok: true });
});

// ── AI copilot (OpenAI-compatible) ──────────────────────────────────────────
// Provider config (base URL, key, model) is configured in the Settings UI and
// stored in app_settings — no env var, no code change to point at a different
// OpenAI-compatible endpoint (OpenAI, OpenRouter, DeepInfra, a local vLLM, ...).

// Each action is a fixed system prompt kept server-side so the client can't
// smuggle an arbitrary one through the copilot.
const AI_ACTIONS = {
  write: 'You are a writing assistant embedded in a document editor. Produce clean prose for what the user asks. Output only the text to insert — no preamble, no markdown fences, no commentary.',
  improve: 'You are an editor. Rewrite the provided text to be clearer and better-flowing, preserving meaning and voice. Output only the rewritten text.',
  grammar: 'You are a proofreader. Fix spelling, grammar, and punctuation in the provided text. Change nothing else. Output only the corrected text.',
  shorten: 'You are an editor. Make the provided text more concise while keeping its meaning. Output only the shortened text.',
  summarize: 'You are a summarizer. Write a brief summary of the provided text. Output only the summary.',
};

// GET returns config WITHOUT the key — only whether one is set. So the settings
// form can show current base URL / model / enabled state without leaking the key.
app.get('/api/settings/ai', requireUser, async (_req, res) => {
  const cfg = (await getSetting('ai')) || {};
  res.json({
    baseUrl: cfg.baseUrl || '',
    model: cfg.model || '',
    enabled: !!cfg.enabled,
    keySet: !!cfg.apiKey,
  });
});

// PUT saves config. An omitted/blank apiKey keeps the stored one (so re-saving
// base URL or model doesn't wipe the key); a non-blank value replaces it.
app.put('/api/settings/ai', requireUser, requireAdmin, async (req, res) => {
  const existing = (await getSetting('ai')) || {};
  const body = req.body || {};
  const next = {
    baseUrl: String(body.baseUrl || '').trim() || existing.baseUrl || '',
    model: String(body.model || '').trim() || existing.model || '',
    enabled: body.enabled === undefined ? !!existing.enabled : !!body.enabled,
    apiKey: (typeof body.apiKey === 'string' && body.apiKey.trim())
      ? body.apiKey.trim()
      : existing.apiKey || '',
  };
  await setSetting('ai', next);
  res.json({ ok: true });
});

app.post('/api/ai', requireUser, async (req, res) => {
  const cfg = (await getSetting('ai')) || {};
  if (!cfg.enabled || !cfg.baseUrl || !cfg.apiKey || !cfg.model) {
    return res.status(503).json({ error: 'AI is not configured — set it up in Settings' });
  }
  // Two modes on one endpoint:
  //  - chat: caller sends a `messages` array (the collapsible copilot sidebar).
  //  - action: caller sends {action, selection, prompt} (the inline popup).
  let chatMessages;
  if (Array.isArray(req.body?.messages) && req.body.messages.length) {
    // Trust only role+content; cap history so a runaway client can't blow up the prompt.
    const history = req.body.messages.slice(-20).map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: String(m.content || '').slice(0, 20000),
    }));
    const docContext = String(req.body?.selection || '').slice(0, 20000);
    chatMessages = [
      {
        role: 'system',
        content:
          'You are a helpful assistant embedded in a document editor. Answer questions and help with writing. Be concise.' +
          (docContext ? `\n\nThe user has this text selected in their document:\n${docContext}` : ''),
      },
      ...history,
    ];
  } else {
    const action = String(req.body?.action || 'write');
    const system = AI_ACTIONS[action];
    if (!system) return res.status(400).json({ error: 'unknown action' });
    const prompt = String(req.body?.prompt || '').slice(0, 8000);
    const selection = String(req.body?.selection || '').slice(0, 20000);
    const userText = action === 'write'
      ? prompt
      : `${prompt ? prompt + '\n\n' : ''}Text:\n${selection}`;
    if (!userText.trim()) return res.status(400).json({ error: 'nothing to do' });
    chatMessages = [
      { role: 'system', content: system },
      { role: 'user', content: userText },
    ];
  }

  const client = new OpenAI({ baseURL: cfg.baseUrl, apiKey: cfg.apiKey });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  try {
    const stream = await client.chat.completions.create({
      model: cfg.model,
      max_tokens: 4096,
      stream: true,
      messages: chatMessages,
    });
    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta?.content;
      if (delta) res.write(`data: ${JSON.stringify({ text: delta })}\n\n`);
    }
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    console.error('[ai] stream error', err.message);
    if (!res.headersSent) res.status(502).json({ error: 'ai provider error: ' + err.message });
    else { res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`); res.end(); }
  }
});

// ── search ──────────────────────────────────────────────────────────────────
// The client posts extracted plain text whenever a doc changes; search queries
// the generated tsvector, scoped to docs the user can actually see.

// Best-effort per-doc signal computation. Reads the persisted Yjs (true block
// structure incl. todos); falls back to the posted plain text if absent. Never
// throws into the caller — a bad doc must not fail the save.
async function computeAndStoreSignals(docId, fallbackText = '', titles = null) {
  try {
    let title = '';
    let blocks = [];
    const st = await pool.query('SELECT state FROM doc_states WHERE doc_id = $1', [docId]);
    if (st.rows[0]?.state) {
      ({ title, blocks } = extractBlocks(st.rows[0].state));
    } else {
      blocks = blocksFromText(fallbackText); // honours `- [ ]` / `- [x]` markers
    }
    const flatText = (title + '\n' + blocks.map((b) => b.text).join('\n')).trim();
    const scanText = flatText.slice(0, 100000);
    const terms = topTerms(scanText, 30);
    const signals = extractSignals(blocks);
    const summary = summarize(blocks.filter((b) => b.flavour !== 'affine:code').map((b) => b.text).join(' ').slice(0, 100000), 3);
    const kps = keyphrases(scanText, 8);

    const others = titles
      ? titles.filter((t) => t.id !== docId)
      : (await pool.query('SELECT id, title FROM docs WHERE id <> $1 AND deleted_at IS NULL', [docId])).rows;
    const mentions = findMentions(scanText, others);
    const hash = terms.length ? simhash(terms) : null;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM doc_terms WHERE doc_id = $1', [docId]);
      if (terms.length) {
        await client.query(
          `INSERT INTO doc_terms (doc_id, term, tf)
           SELECT $1, t, f FROM unnest($2::text[], $3::int[]) AS x(t, f)
           ON CONFLICT DO NOTHING`,
          [docId, terms.map((t) => t.term), terms.map((t) => t.tf)],
        );
      }
      await client.query(
        `INSERT INTO doc_signals (doc_id, tasks, decisions, risks, deadlines, mentions, simhash, summary, keyphrases, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now())
         ON CONFLICT (doc_id) DO UPDATE SET
           tasks=EXCLUDED.tasks, decisions=EXCLUDED.decisions, risks=EXCLUDED.risks,
           deadlines=EXCLUDED.deadlines, mentions=EXCLUDED.mentions, simhash=EXCLUDED.simhash,
           summary=EXCLUDED.summary, keyphrases=EXCLUDED.keyphrases,
           updated_at=now()`,
        [docId, JSON.stringify(signals.tasks), JSON.stringify(signals.decisions),
         JSON.stringify(signals.risks), JSON.stringify(signals.deadlines),
         JSON.stringify(mentions), hash, summary, JSON.stringify(kps)],
      );
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (e) {
    console.error('[intelligence] signal compute failed for', docId, e.message);
  }
}

// Rapid saves of one doc must not race: only one computation per doc runs at a
// time and queued ones collapse to the newest text, so an older, slower run can
// never overwrite fresher terms/signals.
const scheduleSignals = coalesceByKey(computeAndStoreSignals);

// Replace a doc's outgoing @-references. Best-effort: a bad link list must
// never cost the user their save, so this runs after the response and swallows
// its own errors. Targets that no longer exist are dropped rather than throwing
// on the foreign key.
async function storeLinks(fromId, ids) {
  const to = [...new Set(ids.filter((v) => typeof v === 'string' && v && v !== fromId))].slice(0, 500);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM doc_links WHERE from_id = $1', [fromId]);
    if (to.length) {
      await client.query(
        `INSERT INTO doc_links (from_id, to_id)
         SELECT $1, d.id FROM docs d
          WHERE d.id = ANY($2) AND d.deleted_at IS NULL
         ON CONFLICT DO NOTHING`,
        [fromId, to],
      );
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[links] store failed for', fromId, e.message);
  } finally {
    client.release();
  }
}

app.put('/api/docs/:id/text', requireUser, wrap(async (req, res) => {
  if (!(await grantOn(req.params.id, req.user.id))) return res.status(403).json({ error: 'forbidden' });
  const text = String(req.body?.text || '').slice(0, 100000);
  // Absent `links` means "this client doesn't know about links" — leave the
  // existing ones alone. An empty array means the doc genuinely has none now.
  const links = Array.isArray(req.body?.links) ? req.body.links : null;
  await pool.query('UPDATE docs SET search_text = $1 WHERE id = $2', [text, req.params.id]);
  res.json({ ok: true });
  scheduleSignals(req.params.id, text); // best-effort, after response
  if (links) storeLinks(req.params.id, links);
}));

// Pages this one @-references. Same access scoping as backlinks — a link to a
// page you can't open must not leak its title — and the sidebar hangs these
// under the page as its children.
app.get('/api/docs/:id/links', requireUser, wrap(async (req, res) => {
  if (!(await grantOn(req.params.id, req.user.id))) return res.status(403).json({ error: 'forbidden' });
  const { rows } = await pool.query(
    `SELECT d.id, d.title, d.icon, d.updated_at
       FROM doc_links l
       JOIN docs d ON d.id = l.to_id
       LEFT JOIN doc_access a ON a.doc_id = d.id AND a.user_id = $2
      WHERE l.from_id = $1
        AND d.deleted_at IS NULL
        AND (a.user_id IS NOT NULL OR d.visibility = 'team')
      ORDER BY lower(d.title)
      LIMIT 100`,
    [req.params.id, req.user.id],
  );
  res.json(rows);
}));

// Pages that @-reference this one. Access-scoped the same way search is: a
// backlink from a page you can't open must not leak that page's title.
app.get('/api/docs/:id/backlinks', requireUser, wrap(async (req, res) => {
  if (!(await grantOn(req.params.id, req.user.id))) return res.status(403).json({ error: 'forbidden' });
  const { rows } = await pool.query(
    `SELECT d.id, d.title, d.icon, d.updated_at
       FROM doc_links l
       JOIN docs d ON d.id = l.from_id
       LEFT JOIN doc_access a ON a.doc_id = d.id AND a.user_id = $2
      WHERE l.to_id = $1
        AND d.deleted_at IS NULL
        AND (a.user_id IS NOT NULL OR d.visibility = 'team')
      ORDER BY d.updated_at DESC
      LIMIT 50`,
    [req.params.id, req.user.id],
  );
  res.json(rows);
}));

app.get('/api/search', requireUser, wrap(async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.json([]);

  // Co-occurrence query expansion: pull the strongest terms that co-occur with
  // the query's own terms across the corpus, OR them in to widen recall (must
  // not AND into the query — that would narrow results instead).
  let expansionOr = null;
  try {
    const qterms = tokenize(q);
    if (qterms.length) {
      const ex = (await pool.query(
        `SELECT dt2.term, count(*) c
           FROM doc_terms dt1 JOIN doc_terms dt2 ON dt2.doc_id = dt1.doc_id AND dt2.term <> dt1.term
          WHERE dt1.term = ANY($1)
          GROUP BY dt2.term ORDER BY c DESC LIMIT 3`, [qterms])).rows.map((r) => r.term);
      expansionOr = ex.length ? ex.join(' | ') : null;
    }
  } catch { /* expansion is best-effort */ }

  const { rows } = await pool.query(
    `WITH scoped AS (
       SELECT d.id, d.title, d.search_text, d.search_tsv
         FROM docs d
         LEFT JOIN doc_access a ON a.doc_id=d.id AND a.user_id=$1
        WHERE d.deleted_at IS NULL AND (a.user_id IS NOT NULL OR d.visibility='team')
     ),
     fts AS (
       SELECT id, title, search_text, 1 AS pri,
              ts_rank(search_tsv, plainto_tsquery('english', $2)) AS rank
         FROM scoped
        -- $3 is cast explicitly: with no expansion terms it arrives as NULL, and
        -- an untyped NULL parameter makes Postgres refuse the whole statement
        -- ("could not determine data type of parameter $3") — which meant search
        -- failed outright on a workspace whose co-occurrence terms aren't built yet.
        WHERE search_tsv @@ (CASE WHEN $3::text IS NULL THEN plainto_tsquery('english',$2)
                                   ELSE plainto_tsquery('english',$2) || to_tsquery('english',$3::text) END)
     ),
     fuzzy AS (
       SELECT id, title, search_text, 2 AS pri,
              GREATEST(similarity(title,$2), similarity(left(search_text,2000),$2)) AS rank
         FROM scoped
        WHERE title % $2 OR left(search_text,2000) % $2
     ),
     merged AS (
       SELECT DISTINCT ON (id) id, title, search_text, pri, rank
         FROM (SELECT * FROM fts UNION ALL SELECT * FROM fuzzy) u
        ORDER BY id, pri, rank DESC
     )
     SELECT id, title,
            ts_headline('english', search_text, plainto_tsquery('english', $2),
                        'MaxWords=18, MinWords=6, ShortWord=2') AS snippet
       FROM merged
      ORDER BY pri, rank DESC
      LIMIT 20`,
    [req.user.id, q, expansionOr],
  );
  res.json(rows.map((r) => ({ id: r.id, title: r.title, snippet: r.snippet })));
}));

// Everything the Intelligence rail needs, in one round-trip. All access-scoped.
app.get('/api/docs/:id/intelligence', requireUser, wrap(async (req, res) => {
  const id = req.params.id;
  const uid = req.user.id;
  if (!(await grantOn(id, uid))) return res.status(403).json({ error: 'forbidden' });

  // Visibility predicate reused across sub-queries.
  const visJoin = `LEFT JOIN doc_access a ON a.doc_id = d.id AND a.user_id = $2`;
  const visWhere = `d.deleted_at IS NULL AND (a.user_id IS NOT NULL OR d.visibility='team')`;

  const sig = (await pool.query('SELECT * FROM doc_signals WHERE doc_id=$1', [id])).rows[0] || {};

  // Related: shared-term overlap weighted by rarity (query-time IDF).
  const related = (await pool.query(
    `WITH df AS (SELECT term, count(DISTINCT doc_id)::float AS n FROM doc_terms GROUP BY term),
          mine AS (SELECT term, tf FROM doc_terms WHERE doc_id=$1)
     SELECT d.id, d.title, d.icon,
            sum(mine.tf * dt.tf / GREATEST(df.n,1)) AS score
       FROM mine
       JOIN doc_terms dt ON dt.term=mine.term AND dt.doc_id<>$1
       JOIN df ON df.term=mine.term
       JOIN docs d ON d.id=dt.doc_id
       ${visJoin}
      WHERE ${visWhere}
      GROUP BY d.id, d.title, d.icon
      ORDER BY score DESC
      LIMIT 5`, [id, uid])).rows;

  // Centroid auto-tag: rank existing tags by term-overlap between this doc and
  // the docs already carrying each tag (weighted by rarity). Access-scoped.
  const centroidTags = (await pool.query(
    `WITH mine AS (SELECT term, tf FROM doc_terms WHERE doc_id=$1),
          df AS (SELECT term, count(DISTINCT doc_id)::float n FROM doc_terms GROUP BY term)
     SELECT t.id AS "tagId", t.name, sum(mine.tf * dt.tf / GREATEST(df.n,1)) AS score
       FROM mine
       JOIN doc_terms dt ON dt.term = mine.term AND dt.doc_id <> $1
       JOIN df ON df.term = mine.term
       JOIN doc_tags g ON g.doc_id = dt.doc_id
       JOIN tags t ON t.id = g.tag_id
       JOIN docs d ON d.id = dt.doc_id
       LEFT JOIN doc_access a ON a.doc_id = d.id AND a.user_id = $2
      WHERE d.deleted_at IS NULL AND (a.user_id IS NOT NULL OR d.visibility='team')
        AND t.id NOT IN (SELECT tag_id FROM doc_tags WHERE doc_id=$1)
      GROUP BY t.id, t.name ORDER BY score DESC LIMIT 4`, [id, uid])).rows;
  // Keyphrase-derived new-tag ideas (not already a tag, not already applied).
  const kps = Array.isArray(sig.keyphrases) ? sig.keyphrases : [];
  const existingTagNames = new Set((await pool.query('SELECT lower(name) n FROM tags')).rows.map((r) => r.n));
  const kpTags = kps.filter((p) => p.length <= 30 && !existingTagNames.has(p.toLowerCase())).slice(0, 3)
    .map((p) => ({ name: p, exists: false }));
  const suggestedTags = [
    ...centroidTags.map((t) => ({ name: t.name, exists: true, tagId: t.tagId })),
    ...kpTags,
  ].slice(0, 5);

  // Suggested links + changed deps derive from stored mentions.
  const mentions = Array.isArray(sig.mentions) ? sig.mentions : [];
  const mentionIds = mentions.map((m) => m.id);
  let suggestedLinks = [];
  let changedDeps = [];
  if (mentionIds.length) {
    const accessible = (await pool.query(
      `SELECT d.id, d.title, d.icon, d.updated_at
         FROM docs d ${visJoin}
        WHERE d.id = ANY($1) AND ${visWhere}`, [mentionIds, uid])).rows;
    const byId = new Map(accessible.map((d) => [d.id, d]));
    suggestedLinks = mentions.filter((m) => byId.has(m.id))
      .map((m) => ({ id: m.id, title: byId.get(m.id).title, count: m.count }));
    const selfUpdated = (await pool.query('SELECT updated_at FROM docs WHERE id=$1', [id])).rows[0]?.updated_at;
    changedDeps = accessible
      .filter((d) => selfUpdated && new Date(d.updated_at) > new Date(selfUpdated))
      .map((d) => ({ id: d.id, title: d.title, updated_at: d.updated_at }));
  }

  // Duplicate: nearest simhash (Hamming ≤3) among accessible docs, computed in JS.
  let duplicateOf = null;
  if (sig.simhash) {
    const cand = (await pool.query(
      `SELECT d.id, d.title, s.simhash
         FROM doc_signals s JOIN docs d ON d.id=s.doc_id
         ${visJoin}
        WHERE s.doc_id<>$1 AND s.simhash IS NOT NULL AND ${visWhere}`, [id, uid])).rows;
    let best = null;
    for (const c of cand) {
      const dist = hamming(sig.simhash, c.simhash);
      if (dist <= 3 && (!best || dist < best.dist)) best = { id: c.id, title: c.title, dist };
    }
    if (best) duplicateOf = { id: best.id, title: best.title, similarity: 1 - best.dist / 64 };
  }

  // Stale badge.
  const selfRow = (await pool.query('SELECT updated_at FROM docs WHERE id=$1', [id])).rows[0];
  let stale = null;
  if (selfRow) {
    const months = (Date.now() - new Date(selfRow.updated_at).getTime()) / (1000 * 60 * 60 * 24 * 30);
    if (months > STALE_MONTHS) stale = { months: Math.round(months) };
  }

  // Collaborators: editors of related docs not already shared here.
  let collaborators = [];
  if (related.length) {
    const relIds = related.map((r) => r.id);
    collaborators = (await pool.query(
      `SELECT DISTINCT u.id, u.name FROM users u
         WHERE u.id IN (
           SELECT created_by FROM docs WHERE id = ANY($1) AND created_by IS NOT NULL
           UNION SELECT user_id FROM doc_access WHERE doc_id = ANY($1)
         )
         AND u.id NOT IN (SELECT user_id FROM doc_access WHERE doc_id=$2)
         AND u.id <> $3
       LIMIT 5`, [relIds, id, uid])).rows;
  }

  // Templates: docs tagged 'template' overlapping this doc's terms.
  const templates = (await pool.query(
    `WITH mine AS (SELECT term, tf FROM doc_terms WHERE doc_id=$1)
     SELECT d.id, d.title, sum(mine.tf*dt.tf) AS score
       FROM mine JOIN doc_terms dt ON dt.term=mine.term AND dt.doc_id<>$1
       JOIN docs d ON d.id=dt.doc_id
       ${visJoin}
       JOIN doc_tags g ON g.doc_id=d.id
       JOIN tags t ON t.id=g.tag_id AND lower(t.name)='template'
      WHERE ${visWhere}
      GROUP BY d.id, d.title ORDER BY score DESC LIMIT 3`, [id, uid])).rows
    .map((r) => ({ id: r.id, title: r.title }));

  // Terminology: my terms that are trigram-near a much-more-frequent workspace term.
  // df is scoped to docs the user can access (no private-doc term leaks) and the
  // count is cast ::int so it serializes as a JSON number, not a bigint string.
  const terminology = (await pool.query(
    `WITH acc AS (
       SELECT d.id FROM docs d
         LEFT JOIN doc_access a ON a.doc_id=d.id AND a.user_id=$2
        WHERE d.deleted_at IS NULL AND (a.user_id IS NOT NULL OR d.visibility='team')
     ),
          mine AS (SELECT term FROM doc_terms WHERE doc_id=$1),
          df AS (SELECT term, count(DISTINCT doc_id)::int n FROM doc_terms
                  WHERE doc_id IN (SELECT id FROM acc) GROUP BY term)
     SELECT m.term, o.term AS suggest, o.n AS count
       FROM mine m
       JOIN df self ON self.term=m.term
       JOIN df o ON o.term<>m.term AND similarity(o.term,m.term) > 0.55 AND o.n >= self.n*3
      ORDER BY o.n DESC LIMIT 3`, [id, uid])).rows;

  res.json({
    related: related.map((r) => ({ id: r.id, title: r.title, icon: r.icon, score: Number(r.score) })),
    tasks: sig.tasks || [], decisions: sig.decisions || [], risks: sig.risks || [], deadlines: sig.deadlines || [],
    suggestedTags, suggestedLinks, changedDeps, duplicateOf, stale, collaborators, templates, terminology,
    summary: sig.summary || '', keyphrases: kps,
  });
}));

// ── blob storage (images, attachments) ──────────────────────────────────────
// BlockSuite addresses blobs by sha256, so the key space is global and safe to
// share. Raw bytes in/out; session-gated. 25MB cap keeps a stray upload from
// blowing up a Postgres row.
app.put('/api/blob/:key', requireUser, express.raw({ type: '*/*', limit: '25mb' }), async (req, res) => {
  const mime = req.headers['content-type'] || 'application/octet-stream';
  await pool.query(
    `INSERT INTO blobs (key, mime, data) VALUES ($1, $2, $3)
     ON CONFLICT (key) DO NOTHING`,
    [req.params.key, mime, req.body]
  );
  res.json({ ok: true, key: req.params.key });
});

// Readable by a signed-in user OR anyone holding a valid public share token
// (so images in a shared doc load for the public viewer). Keys are opaque
// sha256, so a valid token gating the global blob space is an acceptable leak.
// ponytail: token gates the whole blob space, not per-doc; tighten if blobs ever
// carry cross-doc secrets.
app.get('/api/blob/:key', async (req, res) => {
  const user = await userForSession(sessionToken(req));
  if (!user) {
    const share = String(req.query.share || '');
    const ok = share && (await pool.query(
      'SELECT 1 FROM docs WHERE share_token = $1', [share])).rowCount;
    if (!ok) return res.status(401).json({ error: 'unauthorized' });
  }
  const { rows } = await pool.query('SELECT mime, data FROM blobs WHERE key = $1', [req.params.key]);
  if (!rows[0]) return res.status(404).end();
  // Never serve a client-supplied Content-Type that a browser could execute in
  // our origin (stored XSS). Images render inline; anything else is forced to an
  // inert octet-stream download. nosniff blocks MIME-sniffing around this.
  const mime = String(rows[0].mime || '');
  const isImage = /^image\/(png|jpe?g|gif|webp|avif|bmp|x-icon|svg\+xml)$/i.test(mime);
  res.setHeader('Content-Type', isImage ? mime : 'application/octet-stream');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // Neutralize scripts if the blob is ever loaded as a top-level document (e.g. an
  // SVG opened directly): sandbox blocks script execution. Harmless to <img> use.
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
  if (!isImage) res.setHeader('Content-Disposition', 'attachment');
  res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
  res.end(rows[0].data);
});

app.get('/api/blob', requireUser, async (_req, res) => {
  const { rows } = await pool.query('SELECT key FROM blobs');
  res.json(rows.map(r => r.key));
});

// Admin-only: a blob key is shared across the workspace (content-addressed), so
// one user must not be able to destroy an image referenced by another user's doc.
app.delete('/api/blob/:key', requireUser, requireAdmin, async (req, res) => {
  await pool.query('DELETE FROM blobs WHERE key = $1', [req.params.key]);
  res.json({ ok: true });
});

// ── version history ─────────────────────────────────────────────────────────
async function grantOn(docId, userId) {
  const g = await pool.query('SELECT role FROM doc_access WHERE doc_id = $1 AND user_id = $2', [docId, userId]);
  if (g.rows[0]) return g.rows[0].role;
  // Team-visible docs are accessible to any signed-in workspace member without an
  // explicit grant (implicit editor). Owners still hold an 'owner' doc_access row.
  const t = await pool.query(
    "SELECT 1 FROM docs WHERE id = $1 AND visibility = 'team' AND deleted_at IS NULL",
    [docId]
  );
  return t.rowCount ? 'editor' : null;
}

app.get('/api/docs/:id/versions', requireUser, async (req, res) => {
  if (!(await grantOn(req.params.id, req.user.id))) return res.status(403).json({ error: 'forbidden' });
  const { rows } = await pool.query(
    `SELECT v.id, v.label, v.created_at, u.name AS author, u.email AS author_email
       FROM doc_versions v LEFT JOIN users u ON u.id = v.created_by
      WHERE v.doc_id = $1 ORDER BY v.created_at DESC LIMIT 50`,
    [req.params.id]
  );
  res.json(rows);
});

// Manual named snapshot of the current state.
app.post('/api/docs/:id/versions', requireUser, async (req, res) => {
  if (!(await grantOn(req.params.id, req.user.id))) return res.status(403).json({ error: 'forbidden' });
  const cur = await pool.query('SELECT state FROM doc_states WHERE doc_id = $1', [req.params.id]);
  if (!cur.rows[0]) return res.status(400).json({ error: 'nothing to snapshot yet' });
  const id = crypto.randomUUID();
  await pool.query(
    'INSERT INTO doc_versions (id, doc_id, state, label, created_by) VALUES ($1, $2, $3, $4, $5)',
    [id, req.params.id, cur.rows[0].state, String(req.body?.label || 'Manual save').slice(0, 120), req.user.id]
  );
  res.json({ id });
});

// Restore = create a NEW doc from the snapshot (non-destructive; safe with live
// collaborators on the original).
app.post('/api/docs/:id/versions/:vid/restore', requireUser, async (req, res) => {
  if (!(await grantOn(req.params.id, req.user.id))) return res.status(403).json({ error: 'forbidden' });
  const v = await pool.query('SELECT state FROM doc_versions WHERE id = $1 AND doc_id = $2', [req.params.vid, req.params.id]);
  if (!v.rows[0]) return res.status(404).json({ error: 'version not found' });
  const src = await pool.query('SELECT title FROM docs WHERE id = $1', [req.params.id]);
  const newId = crypto.randomUUID();
  const title = `${(src.rows[0]?.title || 'Untitled')} (restored)`;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('INSERT INTO docs (id, title, created_by) VALUES ($1, $2, $3)', [newId, title, req.user.id]);
    await client.query(`INSERT INTO doc_access (doc_id, user_id, role) VALUES ($1, $2, 'owner')`, [newId, req.user.id]);
    await client.query('INSERT INTO doc_states (doc_id, state) VALUES ($1, $2)', [newId, v.rows[0].state]);
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  res.json({ id: newId, title });
});

// ── comments (threaded, block-anchored) ─────────────────────────────────────
app.get('/api/docs/:id/comments', requireUser, async (req, res) => {
  if (!(await grantOn(req.params.id, req.user.id))) return res.status(403).json({ error: 'forbidden' });
  const { rows } = await pool.query(
    `SELECT id, block_id, quote, body, author_name, parent_id, resolved, created_at
       FROM comments WHERE doc_id = $1 ORDER BY created_at ASC`,
    [req.params.id]
  );
  res.json(rows);
});

app.post('/api/docs/:id/comments', requireUser, async (req, res) => {
  if (!(await grantOn(req.params.id, req.user.id))) return res.status(403).json({ error: 'forbidden' });
  const body = String(req.body?.body || '').trim().slice(0, 4000);
  if (!body) return res.status(400).json({ error: 'empty comment' });
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO comments (id, doc_id, block_id, quote, body, author_id, author_name, parent_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [id, req.params.id, req.body?.blockId || null, String(req.body?.quote || '').slice(0, 500),
     body, req.user.id, req.user.name || req.user.email, req.body?.parentId || null]
  );
  // Fan out notifications for this comment (best-effort; never fails the comment).
  createCommentNotifications({ commentId: id, docId: req.params.id, body, actor: req.user })
    .catch((e) => console.error('[notify] fanout failed', e.message));
  res.json({ id });
});

// Notify @-mentioned members (with access) plus the doc owner, minus the author.
// A recipient can only be notified once per comment (mention wins over owner).
async function createCommentNotifications({ commentId, docId, body, actor }) {
  const doc = await pool.query('SELECT id, title FROM docs WHERE id = $1', [docId]);
  if (!doc.rows[0]) return;
  const docTitle = doc.rows[0].title || 'Untitled';

  // Resolve @usernames in the body against members who have access to this doc.
  const handles = [...body.matchAll(/@([a-z0-9][a-z0-9._-]*)/gi)]
    .map((m) => m[1].replace(/[.]+$/, '').toLowerCase());
  const recipients = new Map(); // user_id -> { kind, email }
  if (handles.length) {
    // A member can be @-mentioned if they can access the doc: an explicit grant,
    // or the doc is team-visible (any member).
    const { rows } = await pool.query(
      `SELECT u.id, u.email FROM users u
        WHERE lower(u.username) = ANY($2)
          AND (EXISTS (SELECT 1 FROM doc_access a WHERE a.user_id = u.id AND a.doc_id = $1)
               OR EXISTS (SELECT 1 FROM docs d WHERE d.id = $1 AND d.visibility = 'team'))`,
      [docId, [...new Set(handles)]]
    );
    for (const r of rows) recipients.set(r.id, { kind: 'mention', email: r.email });
  }
  // Doc owner also hears about any comment (unless they wrote it / already mentioned).
  const owner = await pool.query(
    `SELECT u.id, u.email FROM doc_access a JOIN users u ON u.id = a.user_id
      WHERE a.doc_id = $1 AND a.role = 'owner' LIMIT 1`,
    [docId]
  );
  if (owner.rows[0] && !recipients.has(owner.rows[0].id)) {
    recipients.set(owner.rows[0].id, { kind: 'comment', email: owner.rows[0].email });
  }
  recipients.delete(actor.id); // never notify yourself

  const actorName = actor.name || actor.email;
  const snippet = body.slice(0, 280);
  for (const [userId, { kind, email }] of recipients) {
    await pool.query(
      `INSERT INTO notifications (id, user_id, actor_id, actor_name, doc_id, comment_id, kind, body)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [crypto.randomUUID(), userId, actor.id, actorName, docId, commentId, kind, snippet]
    );
    const verb = kind === 'mention' ? 'mentioned you in' : 'commented on';
    sendNotificationEmail(
      email,
      `${actorName} ${verb} "${docTitle}"`,
      `${actorName} ${verb} "${docTitle}":\n\n${snippet}\n\nOpen MetanoiaDocs: ${BASE_URL}/`
    );
  }
}

app.post('/api/comments/:cid/resolve', requireUser, async (req, res) => {
  const c = await pool.query('SELECT doc_id FROM comments WHERE id = $1', [req.params.cid]);
  if (!c.rows[0] || !(await grantOn(c.rows[0].doc_id, req.user.id))) return res.status(403).json({ error: 'forbidden' });
  await pool.query('UPDATE comments SET resolved = $1 WHERE id = $2 OR parent_id = $2',
    [req.body?.resolved !== false, req.params.cid]);
  res.json({ ok: true });
});

app.delete('/api/comments/:cid', requireUser, async (req, res) => {
  const c = await pool.query('SELECT doc_id, author_id FROM comments WHERE id = $1', [req.params.cid]);
  if (!c.rows[0]) return res.json({ ok: true });
  const role = await grantOn(c.rows[0].doc_id, req.user.id);
  if (!role || (c.rows[0].author_id !== req.user.id && role !== 'owner'))
    return res.status(403).json({ error: 'forbidden' });
  await pool.query('DELETE FROM comments WHERE id = $1 OR parent_id = $1', [req.params.cid]);
  res.json({ ok: true });
});

app.use(express.static(WEB_DIST));
// Projects/tasks and the home dashboard live in their own modules — this file
// is long enough. Must register before the SPA catch-all below.
registerTaskRoutes(app, { requireUser, wrap });
registerHomeRoutes(app, { requireUser, wrap });
registerFolderRoutes(app, { requireUser, wrap });

app.get('*', (_req, res) => res.sendFile(path.join(WEB_DIST, 'index.html')));

// Last-resort error handler so a thrown/rejected route returns 500 instead of crashing.
app.use((err, req, res, next) => {
  console.error('[api] unhandled route error', err?.message || err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'internal error' });
});

// ── realtime sync ─────────────────────────────────────────────────────────
const hocuspocus = new Hocuspocus({
  extensions: [
    new Database({
      fetch: async ({ documentName, context }) => {
        // A connection is authorized for exactly one doc at the WS upgrade. The
        // Yjs protocol carries its own document name, so never serve a doc other
        // than the authorized one — don't authorize one id and serve another.
        if (context?.docId && documentName !== context.docId) {
          throw new Error('document mismatch');
        }
        const { rows } = await pool.query(
          'SELECT state FROM doc_states WHERE doc_id = $1',
          [documentName]
        );
        return rows[0] ? new Uint8Array(rows[0].state) : null;
      },
      store: async ({ documentName, state, context }) => {
        // Read-only viewers (public share links, or a 'viewer' doc_access grant)
        // must never persist edits — enforce server-side, not just client-side.
        if (context?.role === 'viewer') return;
        // Refuse to persist to any doc other than the one this connection was
        // authorized for at the WS upgrade.
        if (context?.docId && documentName !== context.docId) return;
        const buf = Buffer.from(state);
        await pool.query(
          `INSERT INTO doc_states (doc_id, state, updated_at)
           VALUES ($1, $2, now())
           ON CONFLICT (doc_id) DO UPDATE SET state = EXCLUDED.state, updated_at = now()`,
          [documentName, buf]
        );
        // Record who saved, so the activity feed can attribute a plain edit.
        // 'public' is the share-link guest — not a real user row.
        const actor = context?.user?.id && context.user.id !== 'public' ? context.user.id : null;
        await pool.query(
          'UPDATE docs SET updated_at = now(), updated_by = coalesce($2, updated_by) WHERE id = $1',
          [documentName, actor]
        );
        // Auto-snapshot a version at most once per ~8 min of active editing, so
        // history accrues without a row per keystroke.
        const last = await pool.query(
          'SELECT created_at FROM doc_versions WHERE doc_id = $1 ORDER BY created_at DESC LIMIT 1',
          [documentName]
        );
        const stale = !last.rows[0] || (Date.now() - new Date(last.rows[0].created_at)) > 8 * 60 * 1000;
        if (stale) {
          await pool.query(
            'INSERT INTO doc_versions (id, doc_id, state, label) VALUES ($1, $2, $3, $4)',
            [crypto.randomUUID(), documentName, buf, 'autosave']
          );
          // Keep the last 50 versions per doc.
          await pool.query(
            `DELETE FROM doc_versions WHERE doc_id = $1 AND id NOT IN (
               SELECT id FROM doc_versions WHERE doc_id = $1 ORDER BY created_at DESC LIMIT 50)`,
            [documentName]
          );
        }
      },
    }),
  ],
});

const server = http.createServer(app);

// Hocuspocus.handleConnection wants an already-upgraded socket. A bare `ws`
// server does the HTTP upgrade — but only after we authenticate the request
// itself. The session cookie and the document id (the URL path) are both on the
// upgrade request, so a client with no session, or no grant on that doc, is
// refused here and never reaches Hocuspocus. This replaces onAuthenticate,
// which only fires for token-message clients, not cookie-authenticated ones.
const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', async (request, socket, head) => {
  // Only our sync path; Vite's HMR socket upgrades on a different path.
  if (!(request.url || '').startsWith('/sync')) return;
  try {
    // Browsers send the session cookie automatically on a same-origin ws
    // upgrade. Programmatic clients (tests, integrations) that can't set a
    // cookie pass the same session token as `?token=` instead.
    const reqUrl = new URL(request.url || '/', 'http://x');
    // The Hocuspocus provider keeps the doc name out of the URL path, so the
    // client passes it as a `doc` query param for this edge check.
    const docId = reqUrl.searchParams.get('doc') || '';

    // Public-share path: a `share` token that matches this doc grants a viewer
    // connection with no session. Hocuspocus stays read-only for viewers because
    // the client sets the store readonly; the token proves read intent here.
    const share = reqUrl.searchParams.get('share');
    if (share) {
      const s = await pool.query(
        'SELECT 1 FROM docs WHERE id = $1 AND share_token = $2 AND deleted_at IS NULL',
        [docId, share]
      );
      if (!s.rowCount) return socket.destroy();
      return wss.handleUpgrade(request, socket, head, ws => {
        hocuspocus.handleConnection(ws, request, { user: { id: 'public', name: 'Guest' }, role: 'viewer', docId });
      });
    }

    const token = cookie.parse(request.headers.cookie || '')[COOKIE]
      || reqUrl.searchParams.get('token');
    const user = await userForSession(token);
    if (!user) return socket.destroy();

    const role = await grantOn(docId, user.id);
    if (!role) return socket.destroy();

    wss.handleUpgrade(request, socket, head, ws => {
      hocuspocus.handleConnection(ws, request, { user: { id: user.id, name: user.name }, role, docId });
    });
  } catch (err) {
    console.error('[sync] upgrade auth failed', err);
    socket.destroy();
  }
});
server.listen(PORT, '0.0.0.0', () => {
  console.log(`MetanoiaDocs server on :${PORT}  base=${BASE_URL}`);
  startTrashSweeper();
});
