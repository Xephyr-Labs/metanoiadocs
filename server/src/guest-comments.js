// Comments from people with no account, through a public link.
//
// A page's public link used to be read-only and nothing else. Its owner can now
// set it to "can comment": whoever holds the link reads the page and leaves
// comments under a name they type — a reviewer outside the company, a client,
// a contractor — without being made a member of the workspace.
//
// The link is the whole capability, the same as for reading. What it does NOT
// grant, deliberately:
//   · editing the page: the live connection stays read-only (see the WS
//     upgrade in index.js), whatever the link allows;
//   · resolving threads, or touching anyone else's comment;
//   · @-mentions: a guest's "@name" is plain text. A public link reaching every
//     member's inbox is a spam channel, not a feature.
// The page's owner hears about every guest comment, as for any other.
//
// A guest has no session, so "your own comment" is proved with a key: a random
// secret handed back when the comment is made, kept by that browser, and stored
// here only as a hash.
import crypto from 'node:crypto';
import { pool } from './db.js';

export const SHARE_ACCESS = ['view', 'comment'];
export const shareAccess = (value) => (value === 'comment' ? 'comment' : 'view');

/** A guest's name as it will be shown, or null when there is none worth
 *  showing. Control characters out, whitespace collapsed, kept short. */
export function guestName(raw) {
  const name = String(raw ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
  return name || null;
}

export const hashKey = (key) => crypto.createHash('sha256').update(String(key)).digest('hex');

/** True when `key` is the one this comment was made with. Constant-time, so a
 *  wrong key takes as long to refuse as a nearly right one. */
export function keyMatches(key, storedHash) {
  if (typeof key !== 'string' || !key || typeof storedHash !== 'string' || !storedHash) return false;
  const a = Buffer.from(hashKey(key), 'hex');
  const b = Buffer.from(storedHash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * At most `limit` comments per link per `windowMs`. Keyed on the link, not the
 * caller's address: this server does not trust X-Forwarded-For, and a link
 * passed around is exactly the thing that might be abused.
 *
 * ponytail: in-memory, like throttle.js — this server is one process.
 */
export function makeRateLimiter({ limit = 20, windowMs = 10 * 60 * 1000 } = {}) {
  const hits = new Map(); // key -> timestamps
  return (key, now = Date.now()) => {
    if (hits.size > 5000) {
      for (const [k, v] of hits) if (!v.some((t) => t > now - windowMs)) hits.delete(k);
    }
    const recent = (hits.get(key) ?? []).filter((t) => t > now - windowMs);
    if (recent.length >= limit) {
      hits.set(key, recent);
      return false;
    }
    recent.push(now);
    hits.set(key, recent);
    return true;
  };
}

const allowPost = makeRateLimiter();

/** The page behind a link, with what the link allows. Trashed pages are gone. */
async function linkedDoc(token) {
  const { rows } = await pool.query(
    `SELECT id, title, share_access FROM docs WHERE share_token = $1 AND deleted_at IS NULL`,
    [String(token)],
  );
  return rows[0] ?? null;
}

export function registerGuestCommentRoutes(app, { wrap, notify, emit }) {
  /** The page, when its link lets a guest comment; otherwise answers for us. */
  const commentable = async (req, res) => {
    const doc = await linkedDoc(req.params.token);
    if (!doc) { res.status(404).json({ error: 'This link is invalid or has been turned off.' }); return null; }
    if (doc.share_access !== 'comment') { res.status(403).json({ error: 'This link does not allow comments.' }); return null; }
    return doc;
  };

  // Every comment on the page — the guest reads the same threads members do.
  // Names only: no author ids, no emails, nothing that identifies an account.
  app.get('/api/public/:token/comments', wrap(async (req, res) => {
    const doc = await commentable(req, res);
    if (!doc) return;
    const { rows } = await pool.query(
      `SELECT id, block_id, quote, body, author_name, guest, parent_id, resolved, created_at, edited_at
         FROM comments WHERE doc_id = $1 AND task_id IS NULL ORDER BY created_at ASC`,
      [doc.id],
    );
    res.json(rows);
  }));

  app.post('/api/public/:token/comments', wrap(async (req, res) => {
    const doc = await commentable(req, res);
    if (!doc) return;
    const name = guestName(req.body?.name);
    if (!name) return res.status(400).json({ error: 'Add your name so people know who is commenting.' });
    const body = String(req.body?.body || '').trim().slice(0, 4000);
    if (!body) return res.status(400).json({ error: 'empty comment' });

    // A reply answers a thread on this page, and threads are one level deep.
    let parentId = null;
    if (req.body?.parentId) {
      const { rows } = await pool.query(
        'SELECT id FROM comments WHERE id = $1 AND doc_id = $2 AND parent_id IS NULL AND task_id IS NULL',
        [String(req.body.parentId), doc.id],
      );
      if (!rows[0]) return res.status(400).json({ error: 'That thread is not on this page.' });
      parentId = rows[0].id;
    }
    if (!allowPost(doc.id)) {
      return res.status(429).json({ error: 'Too many comments on this page just now. Try again in a few minutes.' });
    }

    const id = crypto.randomUUID();
    const key = crypto.randomBytes(24).toString('base64url');
    const blockId = typeof req.body?.blockId === 'string' ? req.body.blockId.slice(0, 64) : null;
    await pool.query(
      `INSERT INTO comments (id, doc_id, block_id, quote, body, author_id, author_name, parent_id, guest, guest_key_hash)
       VALUES ($1, $2, $3, $4, $5, NULL, $6, $7, true, $8)`,
      [id, doc.id, parentId ? null : blockId, parentId ? '' : String(req.body?.quote || '').slice(0, 500),
       body, name, parentId, hashKey(key)],
    );
    notify({ commentId: id, docId: doc.id, body, actor: { id: null, name: `${name} (guest)` }, mentions: false })
      .catch((e) => console.error('[notify] guest comment:', e.message));
    emit('comment.created', { id, doc_id: doc.id, body, author_id: null, guest: true });
    res.json({ id, key });
  }));

  /** The guest's own comment, proved by the key it was made with. */
  const own = async (req, res) => {
    const doc = await commentable(req, res);
    if (!doc) return null;
    const { rows } = await pool.query(
      'SELECT id, guest_key_hash FROM comments WHERE id = $1 AND doc_id = $2 AND guest',
      [req.params.cid, doc.id],
    );
    if (!rows[0] || !keyMatches(req.body?.key, rows[0].guest_key_hash)) {
      res.status(403).json({ error: 'You can only change your own comments.' });
      return null;
    }
    return rows[0];
  };

  app.patch('/api/public/:token/comments/:cid', wrap(async (req, res) => {
    const body = String(req.body?.body || '').trim().slice(0, 4000);
    if (!body) return res.status(400).json({ error: 'empty comment' });
    const c = await own(req, res);
    if (!c) return;
    const { rows } = await pool.query(
      'UPDATE comments SET body = $1, edited_at = now() WHERE id = $2 RETURNING body, edited_at',
      [body, c.id],
    );
    res.json(rows[0]);
  }));

  app.delete('/api/public/:token/comments/:cid', wrap(async (req, res) => {
    const c = await own(req, res);
    if (!c) return;
    // A thread's replies are other people's words. A member's delete takes the
    // replies with it because only the author or the page's owner may do it; a
    // guest may only ever remove what they wrote, so a thread someone has
    // answered stays.
    const { rowCount: replies } = await pool.query('SELECT 1 FROM comments WHERE parent_id = $1 LIMIT 1', [c.id]);
    if (replies) return res.status(409).json({ error: 'Someone has replied to this comment, so it can no longer be deleted.' });
    await pool.query('DELETE FROM comments WHERE id = $1', [c.id]);
    res.json({ ok: true });
  }));
}
