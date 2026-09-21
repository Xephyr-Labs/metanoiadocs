// Tasks that come back.
//
// A standup, a weekly report, an invoice on the first of the month: work that
// is finished and then, a day or a week later, is not. Without this the answer
// is a task nobody closes, which stops meaning anything, or a new one typed by
// hand every time.
//
// Repeat happens on completion, not on a clock. Marking one done is what makes
// the next, so a rule cannot pile up occurrences while nobody is looking — the
// failure mode of every scheduler-driven version of this feature. The cost is
// that a task never ticked never returns, which is the honest reading of "this
// keeps coming back after you do it".

/** Every rule a task can carry. A short closed list, not RRULE: these five are
 *  what people actually set, and a text field holding RRULE strings would need
 *  a parser, a writer and a UI nobody asked for. */
export const REPEAT_RULES = ['daily', 'weekdays', 'weekly', 'biweekly', 'monthly'];

export const isRepeatRule = (v) => typeof v === 'string' && REPEAT_RULES.includes(v);

/** A 'YYYY-MM-DD' string as a UTC date, or null. UTC throughout: these are
 *  DATE columns with no time in them, and local parsing shifts them a day in
 *  half the world. */
function parse(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? ''));
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isNaN(d.getTime()) ? null : d;
}

const fmt = (d) => d.toISOString().slice(0, 10);

const addDays = (d, n) => new Date(d.getTime() + n * 86400000);

/**
 * The date a rule moves to, from `iso`.
 *
 * `monthly` clamps rather than rolling over: the 31st of January repeats to the
 * 28th of February, not the 3rd of March. A monthly task set on the last day of
 * a month is nearly always "the end of the month", and rolling into the next
 * one reads as a bug every February.
 */
export function nextDate(rule, iso) {
  const d = parse(iso);
  if (!d || !isRepeatRule(rule)) return null;
  if (rule === 'daily') return fmt(addDays(d, 1));
  if (rule === 'weekly') return fmt(addDays(d, 7));
  if (rule === 'biweekly') return fmt(addDays(d, 14));
  if (rule === 'weekdays') {
    let next = addDays(d, 1);
    // 0 Sunday, 6 Saturday.
    while (next.getUTCDay() === 0 || next.getUTCDay() === 6) next = addDays(next, 1);
    return fmt(next);
  }
  // monthly
  const day = d.getUTCDate();
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
  const lastOfMonth = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  return fmt(new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(day, lastOfMonth))));
}

/**
 * The dates the next occurrence carries.
 *
 * The due date is what the rule moves; the start moves with it, keeping the
 * same span, because a task that ran three days last month runs three days
 * this month. A task with only a start date has that moved instead — it is the
 * only date there is. A task with neither is given none: it repeats as a row on
 * the board, which is what a dateless repeating task was already.
 *
 * `today` guards against a task finished long after it was due: repeating from
 * a due date six weeks past would create something already overdue, which is
 * the one occurrence nobody wants. The rule is applied again until it lands in
 * the future — the same walk forward a person would do by hand.
 */
export function nextOccurrence(rule, { startAt, dueAt }, today) {
  if (!isRepeatRule(rule)) return null;
  const anchor = dueAt ?? startAt;
  if (!anchor) return { startAt: null, dueAt: null };

  let next = nextDate(rule, anchor);
  if (!next) return null;
  // Bounded: a hundred steps is eight years of monthly or three months of
  // daily, past which something is wrong with the data rather than the rule.
  for (let i = 0; i < 100 && today && next <= today; i++) {
    const after = nextDate(rule, next);
    if (!after || after === next) break;
    next = after;
  }

  const shift = parse(next).getTime() - parse(anchor).getTime();
  const move = (iso) => (iso ? fmt(new Date(parse(iso).getTime() + shift)) : null);
  return dueAt
    ? { startAt: move(startAt), dueAt: next }
    : { startAt: next, dueAt: null };
}
