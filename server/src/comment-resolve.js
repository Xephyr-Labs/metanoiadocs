/**
 * Who may resolve or reopen a comment thread, as `null` (yes) or `{ status, error }`.
 *
 * A suggestion card is closed only by accepting or rejecting it: resolving one
 * would hide it from review without deciding it. An AI or untrusted agent may
 * only tidy up threads it started itself, never other people's.
 */
export function resolveVerdict({ kind, authorId, taskId, userId, untrusted, canEditPage }) {
  if (kind === 'suggestion') return { status: 409, error: 'A suggestion is closed by accepting or rejecting it.' };
  const mine = authorId === userId;
  if (untrusted) return mine ? null : { status: 403, error: 'forbidden' };
  if (mine || (!taskId && canEditPage)) return null;
  return { status: 403, error: 'forbidden' };
}
