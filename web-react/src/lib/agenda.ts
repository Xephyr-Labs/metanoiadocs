// The calendar's phone layout: a month as a list of days, each with the rows
// that belong under it. Pure, so the rule for where a multi-day task shows up
// is tested rather than eyeballed.

import { addDays, daysBetween } from './gantt';

export interface AgendaRow {
  id: string;
  /** First and last day, inclusive, as YYYY-MM-DD. Equal for a one-day row. */
  from: string;
  to: string;
}

export interface AgendaEntry extends AgendaRow {
  /**
   * `day`: a one-day row, on its own day.
   * `span`: a multi-day row where it first appears this month, which is its
   * start date, or the 1st when it began in an earlier month.
   * `ongoing`: the same row again under today, because today is inside it.
   */
  kind: 'day' | 'span' | 'ongoing';
  /** Which day of the row this is, counting from 1, and how many it has. */
  dayOf: number;
  days: number;
}

export interface AgendaDay {
  day: string;
  entries: AgendaEntry[];
}

/** Every day of a month, the 1st to the last. `month` is 0-based. */
export function monthDays(year: number, month: number): string[] {
  const first = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
  const count = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return Array.from({ length: count }, (_, i) => addDays(first, i));
}

/**
 * Lay rows out over the days of a month.
 *
 * A week-long task listed under each of its seven days is seven copies of one
 * card between you and the next thing, so a multi-day row is listed once, where
 * it starts, with its range on it. It is listed a second time under today when
 * it is still running, because "what is on today" is the question a phone is
 * opened to answer and a task that started last week is part of the answer.
 *
 * Rows keep the order they came in, which is the view's own sort.
 */
export function agendaFor(rows: AgendaRow[], days: string[], today: string): AgendaDay[] {
  const out = new Map<string, AgendaEntry[]>(days.map((d) => [d, []]));
  if (!days.length) return [];
  const first = days[0];
  const last = days[days.length - 1];
  for (const r of rows) {
    if (r.to < first || r.from > last) continue;
    const total = daysBetween(r.from, r.to) + 1;
    if (total === 1) {
      out.get(r.from)?.push({ ...r, kind: 'day', dayOf: 1, days: 1 });
      continue;
    }
    const shown = r.from < first ? first : r.from;
    out.get(shown)?.push({ ...r, kind: 'span', dayOf: daysBetween(r.from, shown) + 1, days: total });
    if (today !== shown && today >= r.from && today <= r.to) {
      out.get(today)?.push({ ...r, kind: 'ongoing', dayOf: daysBetween(r.from, today) + 1, days: total });
    }
  }
  return days.map((day) => ({ day, entries: out.get(day)! }));
}
