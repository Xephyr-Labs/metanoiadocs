// Emoji reactions on comments — page threads and task threads alike.
//
// A reaction is the answer to a comment that doesn't need words: "agreed",
// "seen", "sorry". One row per person per emoji, toggled. The set is fixed
// rather than free text, so a reaction is always something the picker can
// draw, and a client can't turn this table into a second comment box.
import { pool } from './db.js';

export const REACTIONS = ['👍', '👎', '❤️', '😢', '😂', '🎉', '👀', '🙏', '🔥', '✅', '😮', '🚀', '💯', '🤔', '👏', '😍'];

/** "❤" without its emoji selector is the same heart. */
export const normalizeReaction = (e) => {
  const s = String(e || '').trim();
  if (s === '❤') return '❤️';
  return REACTIONS.includes(s) ? s : null;
};

/**
 * Add `reactions: [{ emoji, count, mine, names }]` to each comment row, in the
 * picker's order. `names` lets a hover say who; `mine` lights up your own.
 * Guests get names only (no ids), which is all this returns anyway.
 */
export async function withReactions(rows, userId = null) {
  if (!rows.length) return rows;
  const { rows: rx } = await pool.query(
    `SELECT r.comment_id, r.emoji, r.user_id, coalesce(u.name, u.username, 'Someone') AS name
       FROM comment_reactions r LEFT JOIN users u ON u.id = r.user_id
      WHERE r.comment_id = ANY($1) ORDER BY r.created_at ASC`,
    [rows.map((r) => r.id)]
  );
  const byComment = new Map();
  for (const r of rx) {
    const list = byComment.get(r.comment_id) ?? new Map();
    const entry = list.get(r.emoji) ?? { emoji: r.emoji, count: 0, mine: false, names: [] };
    entry.count += 1;
    entry.names.push(r.name);
    if (userId && r.user_id === userId) entry.mine = true;
    list.set(r.emoji, entry);
    byComment.set(r.comment_id, list);
  }
  const order = (e) => { const i = REACTIONS.indexOf(e); return i < 0 ? 99 : i; };
  return rows.map((row) => ({
    ...row,
    reactions: [...(byComment.get(row.id)?.values() ?? [])].sort((a, b) => order(a.emoji) - order(b.emoji)),
  }));
}

/**
 * POST /api/comments/:cid/reactions { emoji } toggles your reaction.
 * A page comment needs comment access to the page; a task comment, like
 * writing one, needs only to be a member.
 */
export function registerReactionRoutes(app, { requireUser, wrap, grantOn, canComment, changed }) {
  app.post('/api/comments/:cid/reactions', requireUser, wrap(async (req, res) => {
    const emoji = normalizeReaction(req.body?.emoji);
    if (!emoji) return res.status(400).json({ error: 'unknown reaction' });
    const { rows: [c] } = await pool.query('SELECT id, doc_id, task_id FROM comments WHERE id = $1', [req.params.cid]);
    if (!c) return res.status(404).json({ error: 'not found' });
    if (c.doc_id && !canComment(await grantOn(c.doc_id, req.user.id))) return res.status(403).json({ error: 'forbidden' });
    const removed = await pool.query(
      'DELETE FROM comment_reactions WHERE comment_id = $1 AND user_id = $2 AND emoji = $3',
      [c.id, req.user.id, emoji]
    );
    if (!removed.rowCount) {
      await pool.query(
        `INSERT INTO comment_reactions (comment_id, user_id, emoji) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [c.id, req.user.id, emoji]
      );
    }
    if (c.doc_id) changed(c.doc_id);
    const [row] = await withReactions([{ id: c.id }], req.user.id);
    res.json({ reacted: !removed.rowCount, reactions: row.reactions });
  }));
}
