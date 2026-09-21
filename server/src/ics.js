// An iCalendar feed of someone's dated work.
//
// The calendar view is good, and it is inside this app, which is the problem:
// the place people actually look at their week is the calendar on their phone.
// A subscribable .ics puts the work there without an integration to maintain,
// a token to refresh or a third party in the middle — the calendar app polls a
// URL, and that is the whole of it.
//
// RFC 5545 is picky in two ways that matter and are easy to get wrong, so both
// are done here rather than at the call site: text has to be escaped, and no
// line may exceed 75 octets.

import { isoDate } from './timezone.js';

/** Escape the four characters that mean something else inside a property value. */
export function escapeText(s) {
  return String(s ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/**
 * Fold a content line to 75 octets, continuing with a leading space.
 *
 * Octets, not characters: a task called "Réunion d'équipe" is longer on the
 * wire than it looks, and a fold counted in characters splits it past the limit
 * — which some calendar clients accept and others silently drop the event over.
 * Splitting is done on whole code points so a multi-byte character is never
 * cut in half.
 */
export function fold(line) {
  const out = [];
  let cur = '';
  let bytes = 0;
  for (const ch of String(line)) {
    const n = Buffer.byteLength(ch, 'utf8');
    // 74, leaving a byte for the space that begins the continuation.
    if (bytes + n > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = '';
      bytes = 0;
    }
    cur += ch;
    bytes += n;
  }
  out.push(cur);
  return out.map((part, i) => (i ? ` ${part}` : part)).join('\r\n');
}

/** A Date as an iCalendar UTC timestamp: 20260921T143000Z. */
export const stamp = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

/** 'YYYY-MM-DD' as an iCalendar DATE: 20260921. */
const dateVal = (iso) => String(iso).slice(0, 10).replace(/-/g, '');

/** The day after `iso`. DTEND on an all-day event is exclusive, so a task due
 *  on the 21st ends on the 22nd — without this every event is drawn a day
 *  short, and a one-day task does not appear at all in some clients. */
function dayAfter(iso) {
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * One VEVENT per task, as an all-day event or a span.
 *
 * A task with a start and a due date is a span; one with only a due date is a
 * single day on that date; one with only a start is a single day on that. A
 * task with neither is not in a calendar at all and is skipped by the caller.
 */
function event(task, { now, baseUrl }) {
  // Through isoDate first: these arrive from node-postgres as Date objects,
  // and every bit of string slicing below assumes 'YYYY-MM-DD'.
  const startAt = isoDate(task.start_at);
  const dueAt = isoDate(task.due_at);
  const start = startAt ?? dueAt;
  const end = dueAt ?? startAt;
  const lines = [
    'BEGIN:VEVENT',
    // Stable across polls, so editing a task moves the event people already
    // have rather than leaving the old one behind and adding a second.
    `UID:${task.id}@metanoiadocs`,
    `DTSTAMP:${stamp(now)}`,
    `DTSTART;VALUE=DATE:${dateVal(start)}`,
    `DTEND;VALUE=DATE:${dateVal(dayAfter(end))}`,
    `SUMMARY:${escapeText(task.title || 'Untitled')}`,
    // Cancelled rather than dropped: a finished task that simply vanished would
    // stay in every calendar that had already synced it.
    `STATUS:${task.status === 'done' ? 'CANCELLED' : 'CONFIRMED'}`,
  ];
  if (task.project_name) lines.push(`CATEGORIES:${escapeText(task.project_name)}`);
  if (baseUrl && task.project_id) lines.push(`URL:${baseUrl}/db/${task.project_id}`);
  lines.push('END:VEVENT');
  return lines;
}

/**
 * A whole calendar. `tasks` are rows carrying at least id, title, status,
 * start_at and due_at; anything with no date at all is left out.
 */
export function buildCalendar(tasks, { name = 'MetanoiaDocs', now = new Date(), baseUrl = '' } = {}) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//MetanoiaDocs//Tasks//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(name)}`,
    // A polite hint, not a rule — most clients refresh a few times a day
    // whatever this says.
    'X-PUBLISHED-TTL:PT1H',
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
  ];
  for (const t of tasks) {
    if (!isoDate(t.start_at) && !isoDate(t.due_at)) continue;
    lines.push(...event(t, { now, baseUrl }));
  }
  lines.push('END:VCALENDAR');
  // CRLF throughout, which the spec requires and some clients enforce.
  return `${lines.map(fold).join('\r\n')}\r\n`;
}
