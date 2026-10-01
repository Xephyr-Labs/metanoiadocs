// People reached by a page's public link: no account, no session, only the
// link. What they may do is the link's role — view, comment or edit — and who
// they are is whatever name they typed, shown with "(guest)" so nobody reads a
// stranger's comment as a teammate's.
//
// The link is the whole capability: anyone holding it has its role. Turning
// sharing off or resetting the link is how access is taken back, and version
// history is how a bad edit is undone.

export const SHARE_ROLES = ['view', 'comment', 'edit'];

/** The role a stored value stands for; anything unknown is the safest one. */
export function shareRole(value) {
  return SHARE_ROLES.includes(value) ? value : 'view';
}

/** The sync connection's role: only an edit link may write to the document. */
export function connectionRole(role) {
  return shareRole(role) === 'edit' ? 'editor' : 'viewer';
}

export function canComment(role) {
  const r = shareRole(role);
  return r === 'comment' || r === 'edit';
}

/**
 * The name a guest goes by. Typed by a stranger, so control characters and
 * runs of whitespace go, the length is capped, and "(guest)" is always added
 * here rather than trusted from the client — a guest calling themselves
 * "Farhanaj" must still read as a guest.
 */
export function guestName(raw) {
  const name = String(raw ?? '')
    .replace(/[\p{C}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\s*\(guest\)$/i, '')
    .slice(0, 40)
    .trim();
  return `${name || 'Guest'} (guest)`;
}
