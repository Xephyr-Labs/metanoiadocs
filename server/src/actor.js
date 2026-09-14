import crypto from 'node:crypto';

/**
 * Who made this write: the person, or the copilot acting for them?
 *
 * Ask AI calls the same routes over loopback carrying the SIGNED-IN PERSON'S
 * cookie — that is how it inherits their permissions — so `updated_by` is the
 * human either way and nothing else tells the two apart.
 *
 * The flag is never taken from the client. A bare header would let any caller
 * stamp their edits 'human', or blame the copilot for something it did not do.
 * The copilot proves it is us by echoing a nonce minted in this process at boot
 * and never sent to a browser; anything else is a person, whatever it claims.
 */
export const AI_ACTOR_NONCE = crypto.randomBytes(32).toString('base64url');

export function actorVia(req, nonce = AI_ACTOR_NONCE) {
  const claimed = req.headers?.['x-actor-via'];
  const sent = req.headers?.['x-actor-nonce'];
  if (claimed !== 'ai' || typeof sent !== 'string' || !sent) return 'human';
  const ours = Buffer.from(nonce);
  const theirs = Buffer.from(sent);
  // Compare in constant time, and only when the lengths already match —
  // timingSafeEqual throws on a mismatch rather than returning false.
  if (ours.length !== theirs.length) return 'human';
  return crypto.timingSafeEqual(ours, theirs) ? 'ai' : 'human';
}
