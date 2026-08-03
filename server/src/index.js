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
} from './db.js';
import { requestMagicLink, consumeMagicLink, sendInviteEmail, sendNotificationEmail } from './auth.js';
import { getSetting, setSetting } from './db.js';
import OpenAI from 'openai';

const PORT = Number(process.env.PORT || 3000);
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const COOKIE = 'md_session';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIST = path.resolve(__dirname, '../../web-react/dist');

await initSchema();

// Seed the admin account (admin / admin123) once. Admins can invite; everyone
// else joins as a collaborator via an invitation only.
async function seedAdmin() {
  if (await findUserByUsername('admin')) return;
  // Password comes from ADMIN_PASSWORD; falls back to 'admin123' only for local
  // dev. Shipping the fixed default to production is a known footgun — warn loudly.
  const pw = process.env.ADMIN_PASSWORD || 'admin123';
  const passwordHash = await bcrypt.hash(pw, 12);
  await createUserWithPassword({
    name: 'Admin',
    username: 'admin',
    email: process.env.ADMIN_EMAIL || 'admin@metanoia.local',
    passwordHash,
    role: 'admin',
  });
  if (!process.env.ADMIN_PASSWORD) {
    console.warn('[auth] seeded admin with DEFAULT password "admin123" — set ADMIN_PASSWORD and change it before exposing this instance.');
  } else {
    console.log('[auth] seeded admin account from ADMIN_PASSWORD');
  }
}
await seedAdmin();

const app = express();
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

async function requireUser(req, res, next) {
  const user = await userForSession(sessionToken(req));
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

// Username + password registration. Open sign-up (unique username + email),
// bcrypt-hashed. Sets the same session cookie the magic-link flow uses.
app.post('/api/auth/register', async (req, res) => {
  const name = String(req.body?.name || '').trim();
  const username = String(req.body?.username || '').trim().toLowerCase();
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  if (name.length < 2) return res.status(400).json({ error: 'Name must be at least 2 characters.' });
  if (!/^[a-z0-9_.-]{3,32}$/.test(username))
    return res.status(400).json({ error: 'Username must be 3–32 chars: letters, numbers, . _ -' });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
    return res.status(400).json({ error: 'Enter a valid email address.' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });

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
  const user = id.includes('@') ? await findUserByEmail(id) : await findUserByUsername(id);
  // Constant-ish work whether or not the user exists; generic error either way.
  const ok = user?.password_hash ? await bcrypt.compare(password, user.password_hash) : false;
  if (!ok) return res.status(401).json({ error: 'Incorrect username or password.' });
  const token = await createSession(user.id);
  setSessionCookie(res, token);
  res.json({ user: publicUser(user) });
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
    `SELECT n.id, n.kind, n.actor_name, n.body, n.read_at, n.created_at,
            n.doc_id, d.title AS doc_title, d.icon AS doc_icon
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
app.get('/api/docs', requireUser, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT d.id, d.title, d.icon, d.parent_id, d.position, d.updated_at,
            coalesce(a.role, 'editor') AS role, d.visibility,
            (d.share_token IS NOT NULL) AS shared,
            (f.doc_id IS NOT NULL) AS favorite,
            tg.tags
       FROM docs d
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

app.post('/api/docs', requireUser, async (req, res) => {
  const id = crypto.randomUUID();
  const title = String(req.body?.title || 'Untitled').slice(0, 200);
  const icon = String(req.body?.icon || '📄').slice(0, 8);
  const parentId = req.body?.parentId || null;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'INSERT INTO docs (id, title, icon, created_by, parent_id) VALUES ($1, $2, $3, $4, $5)',
      [id, title, icon, req.user.id, parentId]
    );
    await client.query(
      `INSERT INTO doc_access (doc_id, user_id, role) VALUES ($1, $2, 'owner')`,
      [id, req.user.id]
    );
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  res.json({ id, title, icon, parent_id: parentId, role: 'owner', visibility: 'team', shared: false, favorite: false });
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
  if ('parentId' in (req.body || {})) {
    const parentId = req.body.parentId || null;
    if (parentId === req.params.id) {
      return res.status(400).json({ error: 'cannot nest a doc under itself' });
    }
    // Walk up from the proposed parent; if we hit this doc, it's a cycle.
    let cur = parentId;
    while (cur) {
      if (cur === req.params.id) {
        return res.status(400).json({ error: 'move would create a cycle' });
      }
      const up = await pool.query('SELECT parent_id FROM docs WHERE id = $1', [cur]);
      cur = up.rows[0]?.parent_id || null;
    }
    vals.push(parentId);
    sets.push(`parent_id = $${vals.length}`);
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
app.get('/api/docs/trash', requireUser, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT d.id, d.title, d.icon, d.deleted_at
       FROM docs d LEFT JOIN doc_access a ON a.doc_id = d.id AND a.user_id = $1
      WHERE d.deleted_at IS NOT NULL
        AND (a.user_id IS NOT NULL OR d.visibility = 'team')
      ORDER BY d.deleted_at DESC LIMIT 100`,
    [req.user.id]
  );
  res.json(rows);
});

// Restore a trashed doc (any grant on it).
app.post('/api/docs/:id/restore', requireUser, async (req, res) => {
  if (!(await grantOn(req.params.id, req.user.id))) return res.status(403).json({ error: 'forbidden' });
  await pool.query('UPDATE docs SET deleted_at = NULL, updated_at = now() WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

// Soft-delete a doc (owner only). Children re-parent to top level via the
// ON DELETE SET NULL fk only on hard delete, so here we just detach them.
app.delete('/api/docs/:id', requireUser, async (req, res) => {
  const grant = await pool.query(
    'SELECT role FROM doc_access WHERE doc_id = $1 AND user_id = $2',
    [req.params.id, req.user.id]
  );
  if (grant.rows[0]?.role !== 'owner') return res.status(403).json({ error: 'forbidden' });
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

// Drag-reorder in the sidebar tree. The client sends the destination parent and
// the full new order of that parent's children; we write parent_id + position
// by index. One moved doc is enough to change, but rewriting the whole sibling
// group keeps positions dense and the payload trivial to compute client-side.
app.post('/api/docs/reorder', requireUser, async (req, res) => {
  const parentId = req.body?.parentId || null;
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter(x => typeof x === 'string') : [];
  if (!ids.length) return res.json({ ok: true });

  // Cycle guard: parentId must not be one of the docs being (re)parented, nor a
  // descendant of one — walking up from parentId must never hit an id in the set.
  const moving = new Set(ids);
  let cur = parentId;
  while (cur) {
    if (moving.has(cur)) return res.status(400).json({ error: 'move would create a cycle' });
    const up = await pool.query('SELECT parent_id FROM docs WHERE id = $1', [cur]);
    cur = up.rows[0]?.parent_id || null;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (let i = 0; i < ids.length; i++) {
      await client.query(
        `UPDATE docs SET parent_id = $1, position = $2
          WHERE id = $3 AND (
            visibility = 'team'
            OR EXISTS (SELECT 1 FROM doc_access WHERE doc_id = $3 AND user_id = $4))`,
        [parentId, i, ids[i], req.user.id]
      );
    }
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
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
app.put('/api/docs/:id/text', requireUser, async (req, res) => {
  if (!(await grantOn(req.params.id, req.user.id))) return res.status(403).json({ error: 'forbidden' });
  await pool.query('UPDATE docs SET search_text = $1 WHERE id = $2',
    [String(req.body?.text || '').slice(0, 100000), req.params.id]);
  res.json({ ok: true });
});

app.get('/api/search', requireUser, async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.json([]);
  const { rows } = await pool.query(
    `SELECT d.id, d.title,
            ts_headline('english', d.search_text, plainto_tsquery('english', $2),
                        'MaxWords=18, MinWords=6, ShortWord=2') AS snippet
       FROM docs d
       LEFT JOIN doc_access a ON a.doc_id = d.id AND a.user_id = $1
      WHERE d.deleted_at IS NULL
        AND (a.user_id IS NOT NULL OR d.visibility = 'team')
        AND d.search_tsv @@ plainto_tsquery('english', $2)
      ORDER BY ts_rank(d.search_tsv, plainto_tsquery('english', $2)) DESC
      LIMIT 20`,
    [req.user.id, q]
  );
  res.json(rows);
});

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
app.get('*', (_req, res) => res.sendFile(path.join(WEB_DIST, 'index.html')));

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
        await pool.query('UPDATE docs SET updated_at = now() WHERE id = $1', [documentName]);
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
server.listen(PORT, '0.0.0.0', () =>
  console.log(`MetanoiaDocs server on :${PORT}  base=${BASE_URL}`)
);
