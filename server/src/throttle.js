/**
 * Failed-password throttle.
 *
 * Guessing a password is the one thing worth rate limiting here: bcrypt only
 * slows a run down, it never stops one. Keyed on the account, not the caller's
 * IP — an attacker rotates IPs for free, so IP keying protects nobody, and
 * X-Forwarded-For isn't trusted by this server anyway. The cost is that someone
 * can park a colleague out for the window; deliberate, and cheaper than leaving
 * an open guessing oracle.
 *
 * ponytail: in-memory Map, because this server is one process. Move it to a
 * table or redis the day it runs more than one.
 */

export const LOCK_AFTER = 8;
export const LOCK_MS = 15 * 60 * 1000;

const failures = new Map(); // key -> { n, until }

/** Minutes left on a lockout, or 0 if this key may try again. */
export function lockedFor(key, now = Date.now()) {
  const rec = failures.get(key);
  if (!rec) return 0;
  if (rec.until <= now) {
    failures.delete(key);
    return 0;
  }
  return rec.n >= LOCK_AFTER ? Math.ceil((rec.until - now) / 60000) : 0;
}

export function noteFailure(key, now = Date.now()) {
  // Bound the map: a spray across rotating usernames must not grow it forever.
  if (failures.size > 5000) {
    for (const [k, v] of failures) if (v.until <= now) failures.delete(k);
  }
  const rec = failures.get(key);
  const n = rec && rec.until > now ? rec.n + 1 : 1;
  failures.set(key, { n, until: now + LOCK_MS });
}

export function clearFailures(key) {
  failures.delete(key);
}

export const lockoutError = (mins) =>
  `Too many failed attempts. Try again in ${mins} minute${mins === 1 ? '' : 's'}.`;
