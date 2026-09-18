/**
 * What to remind whom, and in what words.
 *
 * No database and no clock: every decision here is a function of a task row and
 * the day it is being looked at, which is what makes the policy testable
 * without a workspace — the same split push-rules.js and mentions.js use. The
 * sweep in reminders.js does the reading, the writing and the sending.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * A YYYY-MM-DD day for whatever pg hands back. A `date` column arrives as a
 * Date at local midnight and a `timestamptz` as an instant, so reading either
 * with toISOString() would move the day for anyone east or west of UTC —
 * "due today" has to mean the day printed on the card.
 */
export function dayOf(value) {
  if (!value) return null;
  if (value instanceof Date) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const text = String(value);
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : null;
}

/** Whole days from `todayIso` to `dueIso`. Negative means the day has passed. */
export function daysUntil(dueIso, todayIso) {
  return Math.round(
    (Date.parse(`${dueIso}T00:00:00Z`) - Date.parse(`${todayIso}T00:00:00Z`)) / 86_400_000,
  );
}

/** "19 Sep" — a date in a one-line notification, not a date in a form. The year
 *  shows only when it is not this one, which is the only time it carries
 *  anything: a task due next week does not need telling you what year it is. */
export function dueLabel(iso, todayIso) {
  const [y, m, d] = iso.split('-');
  const sameYear = !todayIso || y === todayIso.slice(0, 4);
  return `${Number(d)} ${MONTHS[Number(m) - 1]}${sameYear ? '' : ` ${y}`}`;
}

/**
 * Which reminder a task earns today, or null for silence.
 *
 * The person carrying it hears about it a day out, on the day, and then every
 * day it stays late. Whoever handed it over hears only the two that need them:
 * a deadline arriving and a deadline missed — being told a week in advance
 * about work that is not theirs to do is how a notification stream becomes
 * something people mute.
 */
export function reminderFor({ dueIso, todayIso, role }) {
  if (!dueIso) return null;
  const days = daysUntil(dueIso, todayIso);
  if (days < 0) return 'overdue';
  if (days === 0) return 'due_today';
  if (days === 1 && role === 'assignee') return 'due_soon';
  return null;
}

/**
 * Does this want attention now?
 *
 * Late or landing today, always. Otherwise only when it has been marked up:
 * priority is what someone said about a task in advance, and the two days in
 * front of a deadline is where saying it changes what you do about it.
 */
export function isUrgent({ dueIso, priority = 0 }, todayIso) {
  if (!dueIso) return false;
  const days = daysUntil(dueIso, todayIso);
  return days <= 0 || (days <= 2 && priority > 0);
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The sentence a reminder carries. `who` is the assignee list, for the two
 *  reminders that go to the person who handed the work over. */
export function reminderText(kind, { title, dueIso, todayIso, who }) {
  const name = title || 'Untitled task';
  const tail = who ? `, with ${who}` : '';
  if (kind === 'overdue') {
    const late = -daysUntil(dueIso, todayIso);
    return `${plural(late, 'day')} overdue — ${name} (due ${dueLabel(dueIso, todayIso)})${tail}`;
  }
  if (kind === 'due_today') return `Due today — ${name} (${dueLabel(dueIso, todayIso)})${tail}`;
  return `Due tomorrow — ${name} (${dueLabel(dueIso, todayIso)})${tail}`;
}

/** The subject line a reminder's push notification wears. */
export function reminderTitle(kind) {
  if (kind === 'overdue') return 'Overdue';
  if (kind === 'due_today') return 'Due today';
  return 'Due tomorrow';
}

/**
 * The one line a daily summary is. Nobody reads a list at 8am; they read a
 * number and decide whether to open the thing.
 */
export function digestLine(pending, urgent) {
  if (!pending) return null;
  return urgent
    ? `${plural(pending, 'task')} pending · ${urgent} need${urgent === 1 ? 's' : ''} attention now`
    : `${plural(pending, 'task')} pending · nothing urgent`;
}
