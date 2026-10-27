import { randomBytes, randomUUID } from 'node:crypto';
/** Whether a write to an existing page lands directly or becomes a suggestion. */
export function writePolicy({ user, via, token }) {
  if (via === 'ai') return 'suggest'; // Ask AI is never trusted
  if (user?.kind === 'agent') return token?.trusted ? 'direct' : 'suggest';
  return 'direct';
}

/** A caller whose writes only ever become suggestions: it may not decide them, or rewrite a page any other way. */
export const untrusted = (req) => writePolicy({ user: req.user, via: req.via, token: req.token }) === 'suggest';

/**
 * A person signed in as themselves: not an agent account (trusted token or
 * not) and not Ask AI. Trust lets an agent write pages directly; it never lets
 * it decide on approvals or change who is trusted.
 */
export const isPerson = (req) => req.user?.kind !== 'agent' && req.via !== 'ai';

/** Route guard: only a person may change accounts, invites, trust, roles, kinds or workspace settings. */
export function needsPerson(req, res, next) {
  if (!isPerson(req)) return res.status(403).json({ error: 'This needs a person: an AI or agent cannot change accounts, trust, roles or workspace settings.' });
  next();
}

// What a grant lets you do, weakest first. Anything unrecognised ranks below viewer.
export const ROLE_RANK = { viewer: 0, commenter: 1, suggester: 2, editor: 3, owner: 4 };
export const rankOf = (role) => (role in ROLE_RANK ? ROLE_RANK[role] : -1);
export const canEdit = (role) => rankOf(role) >= ROLE_RANK.editor;

/**
 * The role a live-page sync connection gets. An agent's session (password or
 * magic link — never a trusted token) reads and comments but cannot edit the
 * page itself; its edits go through the REST write path and become suggestions.
 */
export const pageSyncRole = (role, user) => (role && user?.kind === 'agent' && canEdit(role) ? 'commenter' : role);

/**
 * Who reviews an AI/agent edit: the signed-in person for Ask AI; for an agent,
 * the person it names in onBehalfOf if they are a non-agent member who can edit
 * the page, else the page owner. Null when there is no owner (Task 6: no one can approve).
 */
export async function resolveApprover({ via, user, onBehalfOf, docId, lookupMember, roleOn, ownerOf }) {
  // Ask AI reviews go to the signed-in person; an agent there could never use one.
  if (via === 'ai') return user.kind === 'agent' ? null : user.id;
  const who = typeof onBehalfOf === 'string' ? onBehalfOf.trim() : '';
  let id = null;
  if (who) {
    const m = await lookupMember(who);
    if (m && m.kind !== 'agent') {
      const role = await roleOn(docId, m.id);
      if (role && canEdit(role)) id = m.id;
    }
  }
  id ??= (await ownerOf(docId)) ?? null;
  // A writer never approves its own edit (an agent that owns the page it wrote).
  return id === user.id ? null : id;
}

/** Admin mints an API token for an agent account. Never for a person: that would be impersonation. */
export const mintAgentToken = (pool, hash) => async (req, res) => {
  const { rows } = await pool.query('SELECT kind FROM users WHERE id = $1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'No such member.' });
  if (rows[0].kind !== 'agent') return res.status(400).json({ error: 'Tokens can only be created for agent accounts.' });
  const name = String(req.body?.name || '').trim().slice(0, 60) || 'API token';
  const secret = 'mtn_' + randomBytes(24).toString('base64url');
  const id = randomUUID();
  await pool.query('INSERT INTO api_tokens (id, user_id, name, token_hash) VALUES ($1, $2, $3, $4)', [id, req.params.id, name, hash(secret)]);
  res.json({ id, name, token: secret });
};
