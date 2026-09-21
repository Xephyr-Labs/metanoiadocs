/**
 * Whose day is it?
 *
 * Every day boundary in this app is a decision about a particular person — is
 * this task due today, is it one day late or two, has 8am arrived for the
 * reader about to be told. Postgres answers `current_date` in the server's
 * zone and Node answers `new Date()` in the container's, and both give the
 * same answer to everyone, which is only right for whoever happens to live
 * where the server is.
 *
 * No database and no clock of its own, so the arithmetic is testable — the
 * same split push-rules.js and reminder-rules.js use.
 */

/** Where the server itself lives. What a person is worth until their browser
 *  says otherwise, and what this app did for everyone before it asked. */
export const DEFAULT_ZONE =
  process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

/**
 * Is this a zone the platform actually knows?
 *
 * The value arrives from a browser, so it is untrusted input that ends up in
 * `Intl.DateTimeFormat`, which throws a RangeError on anything it does not
 * recognise. Asking it once here is cheaper than wrapping every read.
 */
export function isZone(value) {
  if (typeof value !== 'string' || !value || value.length > 64) return false;
  try {
    Intl.DateTimeFormat('en-CA', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** The zone to read a row in: theirs if the browser has ever told us, ours if not. */
export function zoneOf(user) {
  return isZone(user?.timezone) ? user.timezone : DEFAULT_ZONE;
}

const dayFormat = new Map();
const hourFormat = new Map();

/** en-CA formats a date as YYYY-MM-DD, which is the shape the rest of the app
 *  already speaks. Formatters are not cheap to build, so each zone keeps one. */
function formatterFor(cache, zone, options) {
  let f = cache.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', { timeZone: zone, ...options });
    cache.set(zone, f);
  }
  return f;
}

/** The calendar day an instant falls on, where this person is. */
export function dayIn(zone, at = new Date()) {
  return formatterFor(dayFormat, zone, {
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(at);
}

/** The hour of that day, 0–23, where this person is. */
export function hourIn(zone, at = new Date()) {
  const text = formatterFor(hourFormat, zone, { hour: '2-digit', hour12: false }).format(at);
  // Midnight comes back as "24" in some ICU versions and "00" in others.
  return Number(text) % 24;
}

/**
 * A DATE column as 'YYYY-MM-DD', whatever shape the driver handed it over in.
 *
 * node-postgres parses DATE into a JS Date at local midnight, so the obvious
 * `String(row.due_at).slice(0, 10)` yields "Mon Sep 2" and everything
 * downstream fails on it. Reading the local parts rather than calling
 * toISOString matters for the same reason: a Date built at local midnight west
 * of Greenwich is the *previous* day in UTC, and the task would move a day
 * every time it passed through here.
 */
export function isoDate(v) {
  if (v == null) return null;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    const p = (n) => String(n).padStart(2, '0');
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
  }
  const s = String(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}
