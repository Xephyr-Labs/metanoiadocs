// Verified pages: someone vouches that a page is accurate, and the page says
// so until it stops being true enough to say.
//
// A page is Verified from the moment someone who can edit it vouches for it,
// and goes to Needs review when EITHER
//   - its interval is up (30 / 90 / 180 days after verifying; 0 = never), or
//   - someone other than the verifier has saved a change to it since.
// The second rule is deliberately blunt. There is no honest way to measure
// "substantially" from a Yjs document without reading it, and a reviewer
// asked "did that change matter?" costs one click, while a stale page that
// kept its green badge costs a wrong answer. The verifier's own edits keep the
// badge: they vouch for what they wrote. Comments and suggestions never touch
// the page, so they never trip it; accepting a suggestion is a save by the
// person who accepted, so it does.
//
// Everything that decides the state is `verifyState` below, a pure function of
// the row and the clock, so the badge, the Home list, the MCP read and the
// notification sweep cannot disagree about whether a page needs review.
import crypto from 'node:crypto';
import { pool } from './db.js';
import { sendPush } from './push.js';

/** The intervals a verifier can pick, in days. 0 means "never goes stale on time". */
export const VERIFY_INTERVALS = [30, 90, 180, 0];
export const REVIEW_AFTER = 90;

const DAY_MS = 86400000;

/** The interval a row means: a stored 30/90/180/0, anything else the default. */
const everyOf = (row) => (VERIFY_INTERVALS.includes(row.verify_every) ? row.verify_every : REVIEW_AFTER);

/**
 * @param {{verified_by?: string|null, verified_at?: Date|string|null, verify_every?: number|null,
 *          verify_stale_at?: Date|string|null}} row
 * @returns {{state: 'unverified'} | {state: 'verified'|'needs_review', reason?: 'expired'|'edited', dueAt: string|null}}
 */
export function verifyState(row, now = new Date()) {
  if (!row.verified_by || !row.verified_at) return { state: 'unverified' };
  const every = everyOf(row);
  const dueMs = every ? new Date(row.verified_at).getTime() + every * DAY_MS : null;
  const dueAt = dueMs === null ? null : new Date(dueMs).toISOString();
  // The interval is up the instant it is up: on day 90, not after it.
  if (dueMs !== null && now.getTime() >= dueMs) return { state: 'needs_review', reason: 'expired', dueAt };
  if (row.verify_stale_at) return { state: 'needs_review', reason: 'edited', dueAt };
  return { state: 'verified', dueAt };
}

/**
 * SQL for a docs UPDATE's SET list: remember the first save by someone other
 * than the verifier. `$n` is the saver's user id, NULL when nobody should be
 * blamed (a suggester's save). The CASE reads the row as it was, so verifying
 * and editing in one statement cannot flag itself.
 */
export const markStale = (n) =>
  `verify_stale_at = CASE WHEN verified_at IS NOT NULL AND verify_stale_at IS NULL AND $${n}::text IS NOT NULL AND $${n}::text IS DISTINCT FROM verified_by THEN now() ELSE verify_stale_at END`;

/**
 * The same, for a Hocuspocus save, where `$n` is every user id that changed the
 * page since the last save (index.js unsavedEditors: only connections that may
 * edit). A save's own context is just the LAST connection to send an update, so
 * someone else's edit followed 200 ms later by the verifier's typing would have
 * been missed.
 */
export const markStaleBy = (n) =>
  `verify_stale_at = CASE WHEN verified_at IS NOT NULL AND verify_stale_at IS NULL AND EXISTS (SELECT 1 FROM unnest($${n}::text[]) e WHERE e IS DISTINCT FROM verified_by) THEN now() ELSE verify_stale_at END`;

/** The columns verifyView reads, with the verifier's and owner's names. */
export const VERIFY_COLUMNS = `d.verified_by, d.verified_at, d.verify_every, d.verify_owner, d.verify_stale_at,
  vb.name AS verified_by_name, vo.name AS verify_owner_name`;
export const VERIFY_JOINS = `LEFT JOIN users vb ON vb.id = d.verified_by LEFT JOIN users vo ON vo.id = coalesce(d.verify_owner, d.verified_by)`;

/** A page's verification as the API and the MCP tools show it. */
export function verifyView(row, now = new Date()) {
  const s = verifyState(row, now);
  if (s.state === 'unverified') return s;
  return {
    ...s,
    verifiedBy: { id: row.verified_by, name: row.verified_by_name || null },
    verifiedAt: new Date(row.verified_at).toISOString(),
    every: everyOf(row),
    owner: { id: row.verify_owner || row.verified_by, name: row.verify_owner_name || null },
  };
}

/** Pages up for their one notice: needs review, and the owner has not been told. */
export function pendingNotices(rows, now = new Date()) {
  const out = [];
  for (const r of rows) {
    if (r.verify_notified_at) continue;
    const s = verifyState(r, now);
    if (s.state === 'needs_review') out.push({ id: r.id, title: r.title, ownerId: r.verify_owner || r.verified_by, verifierId: r.verified_by, reason: s.reason });
  }
  return out;
}

const reasonText = (reason) => (reason === 'edited' ? 'it was edited after it was verified' : 'its review date has passed');

/** Inbox row + push for one page, the way reminders.js sends a due-date reminder. */
async function tellOwner(n) {
  const id = crypto.randomUUID();
  const body = `${n.title || 'Untitled'} needs review: ${reasonText(n.reason)}.`;
  await pool.query(
    `INSERT INTO notifications (id, user_id, actor_id, actor_name, doc_id, kind, body)
     VALUES ($1, $2, NULL, 'MetanoiaDocs', $3, 'verify_review', $4)`,
    [id, n.ownerId, n.id, body],
  );
  sendPush(n.ownerId, { title: 'Page needs review', body, tag: id, docId: n.id })
    .catch((e) => console.error('[push] verify:', e.message));
}

/**
 * Tell each owner once when a page goes to Needs review. The page is claimed
 * with a conditional UPDATE before anyone is told, so a restarted or
 * overlapping sweep that read the same row loses the claim and sends nothing;
 * re-verifying clears the claim for the next lapse.
 */
export async function sweepVerifications({ db = pool, notify = tellOwner, canSee = async () => true, now = new Date() } = {}) {
  const { rows } = await db.query(
    `SELECT id, title, verified_by, verified_at, verify_every, verify_owner, verify_stale_at, verify_notified_at
       FROM docs
      WHERE verified_at IS NOT NULL AND verify_notified_at IS NULL AND deleted_at IS NULL`,
  );
  let told = 0;
  for (const n of pendingNotices(rows, now)) {
    const claim = await db.query(
      'UPDATE docs SET verify_notified_at = now() WHERE id = $1 AND verify_notified_at IS NULL', [n.id]);
    if (!claim.rowCount) continue;
    try {
      // Never tell someone about a page they cannot open: the verifier, if the
      // owner has since lost access, else nobody.
      const to = (await canSee(n.id, n.ownerId)) ? n.ownerId : n.verifierId && (await canSee(n.id, n.verifierId)) ? n.verifierId : null;
      if (!to) continue;
      await notify({ ...n, ownerId: to });
      told += 1;
    } catch (e) {
      // An owner who no longer exists must not make the page retry forever.
      console.error('[verify] could not notify', n.id, e.message);
    }
  }
  return told;
}

export function registerVerifyRoutes(app, { requireUser, wrap, editGrant, grantOn, untrusted }) {
  const view = async (id) => {
    const { rows } = await pool.query(`SELECT ${VERIFY_COLUMNS} FROM docs d ${VERIFY_JOINS} WHERE d.id = $1`, [id]);
    return verifyView(rows[0]);
  };

  // Vouch for a page, or vouch again: the interval and the owner can change
  // each time. Whoever can edit the page can do it; an AI or an untrusted agent
  // cannot, since a badge it could hand out would mean nothing.
  app.put('/api/docs/:id/verify', requireUser, wrap(async (req, res) => {
    if (!(await editGrant(req.params.id, req.user.id))) return res.status(403).json({ error: 'forbidden' });
    if (untrusted(req)) return res.status(403).json({ error: 'This needs a person or a trusted agent: an AI assistant or untrusted agent cannot verify a page.' });
    const d = await pool.query('SELECT kind, verify_every FROM docs WHERE id = $1 AND deleted_at IS NULL', [req.params.id]);
    if (!d.rows[0]) return res.status(404).json({ error: 'not found' });
    if (d.rows[0].kind === 'task') return res.status(400).json({ error: 'A task page cannot be verified.' });
    const every = req.body?.every === undefined ? d.rows[0].verify_every ?? REVIEW_AFTER : Number(req.body.every);
    if (!VERIFY_INTERVALS.includes(every)) return res.status(400).json({ error: 'every must be 30, 90, 180 or 0 (never).' });
    let owner = null;
    if (req.body?.ownerId) {
      const u = await pool.query("SELECT 1 FROM users WHERE id = $1 AND kind <> 'agent'", [String(req.body.ownerId)]);
      // The owner is told when the page needs review, so they must be able to open it.
      if (!u.rowCount || !(await grantOn(req.params.id, String(req.body.ownerId)))) return res.status(400).json({ error: 'The owner must be a member who can open this page.' });
      owner = String(req.body.ownerId);
    }
    await pool.query(
      `UPDATE docs SET verified_by = $2, verified_at = now(), verify_every = $3, verify_owner = $4,
              verify_stale_at = NULL, verify_notified_at = NULL WHERE id = $1`,
      [req.params.id, req.user.id, every, owner],
    );
    res.json(await view(req.params.id));
  }));

  app.delete('/api/docs/:id/verify', requireUser, wrap(async (req, res) => {
    if (!(await editGrant(req.params.id, req.user.id))) return res.status(403).json({ error: 'forbidden' });
    if (untrusted(req)) return res.status(403).json({ error: 'This needs a person or a trusted agent.' });
    await pool.query(
      `UPDATE docs SET verified_by = NULL, verified_at = NULL, verify_owner = NULL,
              verify_stale_at = NULL, verify_notified_at = NULL WHERE id = $1`,
      [req.params.id],
    );
    res.json({ state: 'unverified' });
  }));
}

/** Hourly: cheap (one indexed-ish scan of verified pages), and it only ever acts once per lapse. */
export function startVerifyReviews(canSee) {
  let running = false;
  const run = () => {
    if (running) return;
    running = true;
    sweepVerifications({ canSee })
      .then((n) => { if (n) console.log(`[verify] ${n} page(s) need review`); })
      .catch((e) => console.error('[verify] sweep failed', e))
      .finally(() => { running = false; });
  };
  run();
  setInterval(run, 60 * 60 * 1000).unref();
}
