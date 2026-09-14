// Date -> pixel math for the gantt. Pure and separately tested: it is the only
// part of the timeline that can be silently wrong rather than visibly broken.
//
// Every date is a YYYY-MM-DD string parsed as UTC, so a bar never shifts a day
// because the viewer sits east of Greenwich.

const DAY_MS = 24 * 60 * 60 * 1000;

export function toUTC(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((toUTC(to) - toUTC(from)) / DAY_MS);
}

export function addDays(iso: string, n: number): string {
  return new Date(toUTC(iso) + n * DAY_MS).toISOString().slice(0, 10);
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export interface Range {
  start: string;
  end: string;
  /** Inclusive day count, so a one-day range is 1. */
  days: number;
}

export interface Span {
  start: string | null;
  due: string | null;
}

/**
 * Window that covers every dated task plus today, padded so bars never touch
 * the edges. Returns null when nothing is dated — the caller shows an empty
 * state rather than an empty grid.
 */
export function rangeFor(spans: Span[], today = todayISO(), pad = 2): Range | null {
  const dates: string[] = [];
  for (const s of spans) {
    if (s.start) dates.push(s.start.slice(0, 10));
    if (s.due) dates.push(s.due.slice(0, 10));
  }
  if (!dates.length) return null;
  dates.push(today);
  let min = dates[0];
  let max = dates[0];
  for (const d of dates) {
    if (d < min) min = d;
    if (d > max) max = d;
  }
  const start = addDays(min, -pad);
  const end = addDays(max, pad);
  return { start, end, days: daysBetween(start, end) + 1 };
}

/** Bar geometry in pixels, or null for a task with no dates at all. */
export function barFor(span: Span, range: Range, dayWidth: number): { x: number; width: number } | null {
  const start = span.start?.slice(0, 10) ?? span.due?.slice(0, 10) ?? null;
  const due = span.due?.slice(0, 10) ?? start;
  if (!start || !due) return null;
  // A task entered backwards (due before start) still gets a visible bar.
  const from = start <= due ? start : due;
  const to = start <= due ? due : start;
  const x = daysBetween(range.start, from) * dayWidth;
  const width = (daysBetween(from, to) + 1) * dayWidth;
  return { x, width };
}

/** Left offset of a single day column, e.g. for the today line. */
export function dayX(iso: string, range: Range, dayWidth: number): number {
  return daysBetween(range.start, iso.slice(0, 10)) * dayWidth;
}

export interface Tick {
  iso: string;
  x: number;
  label: string;
  /** First column of a month — drawn heavier. */
  major: boolean;
}

/**
 * Header ticks. `step` is in days: 1 labels every day, 7 labels week starts.
 * Month boundaries are always emitted so the header stays readable zoomed out.
 */
export function ticksFor(range: Range, dayWidth: number, step: number): Tick[] {
  // Rough label widths in px. A tick is dropped rather than allowed to collide
  // with the one before it — "Jul 4" followed by "5" one column over renders as
  // "Jul 45".
  const FIRST_W = 42; // "Jul 4"
  const MONTH_W = 26; // "Aug"
  const DAY_W = 20; // "31"

  const ticks: Tick[] = [];
  let lastRight = -Infinity;
  for (let i = 0; i < range.days; i++) {
    const iso = addDays(range.start, i);
    const day = Number(iso.slice(8, 10));
    const major = day === 1;
    const first = i === 0;
    if (!major && !first && i % step !== 0) continue;

    const x = i * dayWidth;
    if (!major && x < lastRight) continue; // would overlap the previous label
    // A month boundary always wins — but not by painting over its neighbour.
    // A window that opens on 30 Aug used to label the first column "Aug 30"
    // and then draw "Sep" two columns later on top of it, so the header read
    // "AugSep". The month name says everything the first label was saying.
    if (major && x < lastRight && ticks.length && !ticks[ticks.length - 1].major) ticks.pop();

    const d = new Date(toUTC(iso));
    // The month name alone, never "Aug 26" — beside a row of day numbers that
    // reads as the 26th. The first column names its month too, so a window that
    // opens mid-month still says where it is.
    const month = d.toLocaleDateString(undefined, { month: 'short', timeZone: 'UTC' });
    ticks.push({ iso, x, major, label: major ? month : first ? `${month} ${day}` : String(day) });
    lastRight = x + (major ? MONTH_W : first ? FIRST_W : DAY_W);
  }
  return ticks;
}

export interface WeekSeg {
  id: string;
  /** Column the bar starts in, 0-6. */
  col: number;
  /** Columns it covers, at least 1. */
  span: number;
  /** The row's own start / end fall inside this week, so that edge is real. */
  opens: boolean;
  closes: boolean;
  /** Stacking row within the day cell. */
  lane: number;
}

/**
 * Clip date ranges to one Monday-first week and stack the overlaps.
 *
 * A calendar month is drawn a week at a time, so a row running across a week
 * boundary is two bars, each flat on the side it continues past. Longer bars
 * take the upper lanes, so a week-long row sits above the single days it
 * passes over.
 */
export function weekSegments(
  rows: { id: string; from: string; to: string }[],
  weekStart: string,
): WeekSeg[] {
  const last = addDays(weekStart, 6);
  const segs: WeekSeg[] = [];
  for (const r of rows) {
    if (r.to < weekStart || r.from > last) continue;
    const col = r.from <= weekStart ? 0 : daysBetween(weekStart, r.from);
    const endCol = r.to >= last ? 6 : daysBetween(weekStart, r.to);
    segs.push({
      id: r.id,
      col,
      span: endCol - col + 1,
      opens: r.from >= weekStart,
      closes: r.to <= last,
      lane: 0,
    });
  }
  segs.sort((a, b) => a.col - b.col || b.span - a.span);
  const ends: number[] = [];
  for (const s of segs) {
    let lane = ends.findIndex((end) => end <= s.col);
    if (lane === -1) lane = ends.length;
    ends[lane] = s.col + s.span;
    s.lane = lane;
  }
  return segs;
}
