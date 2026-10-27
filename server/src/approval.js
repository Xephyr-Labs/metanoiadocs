/** Whether a write to an existing page lands directly or becomes a suggestion. */
export function writePolicy({ user, via, token }) {
  if (via === 'ai') return 'suggest'; // Ask AI is never trusted
  if (user?.kind === 'agent') return token?.trusted ? 'direct' : 'suggest';
  return 'direct';
}

/** A caller whose writes only ever become suggestions: it may not decide them, or rewrite a page any other way. */
export const untrusted = (req) => writePolicy({ user: req.user, via: req.via, token: req.token }) === 'suggest';

// What a grant lets you do, weakest first. Anything unrecognised ranks below viewer.
export const ROLE_RANK = { viewer: 0, commenter: 1, suggester: 2, editor: 3, owner: 4 };
export const rankOf = (role) => (role in ROLE_RANK ? ROLE_RANK[role] : -1);
export const canEdit = (role) => rankOf(role) >= ROLE_RANK.editor;

/**
 * Who reviews an AI/agent edit: the signed-in person for Ask AI; for an agent,
 * the person it names in onBehalfOf if they are a non-agent member who can edit
 * the page, else the page owner. Null when there is no owner (Task 6: no one can approve).
 */
export async function resolveApprover({ via, user, onBehalfOf, docId, lookupMember, roleOn, ownerOf }) {
  if (via === 'ai') return user.id;
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
