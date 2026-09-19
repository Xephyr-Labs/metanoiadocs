import { afterEach, describe, expect, it, vi } from 'vitest';
import { addDays, barFor, dayX, daysBetween, rangeFor, ticksFor, todayISO, weekSegments } from './gantt';

describe('today', () => {
  afterEach(() => vi.useRealTimers());

  it('is the day on the reader\'s calendar, not the day in UTC', () => {
    vi.useFakeTimers();
    // 04:00 UTC: still the 14th anywhere west of Greenwich, already the 15th
    // east of it. `toISOString().slice(0, 10)` answers "15" for everyone, which
    // rang the wrong calendar cell and drew the wrong tasks overdue for most of
    // the world for part of every day.
    const at = new Date('2026-09-15T04:00:00.000Z');
    vi.setSystemTime(at);
    expect(Number(todayISO().slice(8, 10))).toBe(at.getDate());
    expect(todayISO()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('pads a single-digit month and day', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 5, 12, 0, 0));
    expect(todayISO()).toBe('2026-01-05');
  });
});

describe('date math', () => {
  it('counts inclusive-exclusive days and crosses month/year ends', () => {
    expect(daysBetween('2026-07-01', '2026-07-05')).toBe(4);
    expect(daysBetween('2026-07-31', '2026-08-01')).toBe(1);
    expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1);
    expect(daysBetween('2026-07-05', '2026-07-01')).toBe(-4);
  });

  it('survives a leap day', () => {
    expect(daysBetween('2028-02-28', '2028-03-01')).toBe(2);
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
  });

  it('addDays goes both ways', () => {
    expect(addDays('2026-07-01', 10)).toBe('2026-07-11');
    expect(addDays('2026-07-01', -1)).toBe('2026-06-30');
  });

  it('parses as UTC so a timezone cannot shift a bar by a day', () => {
    // A naive `new Date('2026-07-01')` + getDate() is off by one west of UTC.
    expect(daysBetween('2026-07-01', '2026-07-01')).toBe(0);
    expect(addDays('2026-07-01', 0)).toBe('2026-07-01');
  });
});

describe('rangeFor', () => {
  it('covers every dated task plus today, with padding', () => {
    const r = rangeFor(
      [{ start: '2026-07-05', due: '2026-07-10' }, { start: '2026-07-02', due: null }],
      '2026-07-08',
      2,
    )!;
    expect(r.start).toBe('2026-06-30');
    expect(r.end).toBe('2026-07-12');
    expect(r.days).toBe(13);
  });

  it('stretches to include today when every task is in the past', () => {
    const r = rangeFor([{ start: '2026-01-01', due: '2026-01-02' }], '2026-07-08', 0)!;
    expect(r.start).toBe('2026-01-01');
    expect(r.end).toBe('2026-07-08');
  });

  it('is null when nothing is dated', () => {
    expect(rangeFor([{ start: null, due: null }], '2026-07-08')).toBeNull();
    expect(rangeFor([], '2026-07-08')).toBeNull();
  });

  it('ignores the time part of an ISO timestamp', () => {
    const r = rangeFor([{ start: '2026-07-05T23:30:00.000Z', due: null }], '2026-07-05', 0)!;
    expect(r.start).toBe('2026-07-05');
  });
});

describe('barFor', () => {
  const range = { start: '2026-07-01', end: '2026-07-31', days: 31 };

  it('places and sizes a bar inclusively', () => {
    expect(barFor({ start: '2026-07-01', due: '2026-07-01' }, range, 10)).toEqual({ x: 0, width: 10 });
    expect(barFor({ start: '2026-07-03', due: '2026-07-05' }, range, 10)).toEqual({ x: 20, width: 30 });
  });

  it('treats a single date as a one-day bar', () => {
    expect(barFor({ start: '2026-07-04', due: null }, range, 10)).toEqual({ x: 30, width: 10 });
    expect(barFor({ start: null, due: '2026-07-04' }, range, 10)).toEqual({ x: 30, width: 10 });
  });

  it('still draws a bar when the dates are entered backwards', () => {
    expect(barFor({ start: '2026-07-05', due: '2026-07-03' }, range, 10)).toEqual({ x: 20, width: 30 });
  });

  it('is null with no dates', () => {
    expect(barFor({ start: null, due: null }, range, 10)).toBeNull();
  });
});

describe('dayX and ticks', () => {
  const range = { start: '2026-06-29', end: '2026-08-02', days: 35 };

  it('locates the today line', () => {
    expect(dayX('2026-06-29', range, 10)).toBe(0);
    expect(dayX('2026-07-01', range, 10)).toBe(20);
  });

  it('always emits month starts, even when they miss the step', () => {
    const ticks = ticksFor(range, 10, 7);
    const majors = ticks.filter((t) => t.major).map((t) => t.iso);
    expect(majors).toEqual(['2026-07-01', '2026-08-01']);
    expect(ticks.find((t) => t.iso === '2026-07-01')!.label).toBe('Jul');
  });

  it('names the month on the first column so a mid-month window is readable', () => {
    // Opens 12 June: the next month start is 18 columns away, so "Jun 12" has room.
    const ticks = ticksFor({ start: '2026-06-12', end: '2026-07-20', days: 39 }, 10, 7);
    expect(ticks[0].iso).toBe('2026-06-12');
    expect(ticks[0].label).toBe('Jun 12');
  });

  it('labels every day at step 1, minus the one the wide first label covers', () => {
    const ticks = ticksFor({ start: '2026-07-02', end: '2026-07-08', days: 7 }, 26, 1);
    expect(ticks.map((t) => t.label)).toEqual(['Jul 2', '4', '5', '6', '7', '8']);
  });

  it('drops day labels that would collide with a wide one', () => {
    // "Jul 4" at x=0 needs ~42px; the next day column starts at 26.
    const ticks = ticksFor({ start: '2026-07-04', end: '2026-07-08', days: 5 }, 26, 1);
    expect(ticks.map((t) => t.label)).toEqual(['Jul 4', '6', '7', '8']);
  });

  it('never drops a month start — the first-column label gives way to it instead', () => {
    // "Jul 31" at x=0 is 42px wide; "Aug" lands at x=26, inside it. Painting both
    // read as "Jul 31Aug", so the month name (which already says where we are)
    // is the one that stays.
    const ticks = ticksFor({ start: '2026-07-31', end: '2026-08-02', days: 3 }, 26, 1);
    expect(ticks.map((t) => t.label)).toEqual(['Aug', '2']);
  });
});

describe('ticksFor — month boundary beside the first column', () => {
  it('drops the first-column label rather than drawing the month over it', () => {
    // Window opens 30 Aug at 10px/day: "Aug 30" at x=0, "Sep" at x=20 — inside the 42px label.
    const ticks = ticksFor({ start: '2026-08-30', end: '2026-09-20', days: 22 }, 10, 7);
    const labels = ticks.map((t) => t.label);
    expect(labels[0]).toBe('Sep');
    expect(labels).not.toContain('Aug 30');
  });
  it('keeps the first-column label when the month starts far enough away', () => {
    const ticks = ticksFor({ start: '2026-08-20', end: '2026-09-20', days: 32 }, 10, 7);
    expect(ticks[0].label).toBe('Aug 20');
    expect(ticks.some((t) => t.label === 'Sep')).toBe(true);
  });
});

describe('weekSegments', () => {
  const week = '2026-09-07'; // a Monday

  it('spans a task across every day it runs, not just its due date', () => {
    const [seg] = weekSegments([{ id: 't', from: '2026-09-08', to: '2026-09-11' }], week);
    expect(seg).toMatchObject({ col: 1, span: 4, opens: true, closes: true, lane: 0 });
  });

  it('cuts a range at the week edges and marks the side it continues past', () => {
    const [seg] = weekSegments([{ id: 't', from: '2026-09-04', to: '2026-09-20' }], week);
    expect(seg).toMatchObject({ col: 0, span: 7, opens: false, closes: false });
  });

  it('drops a range that misses the week entirely', () => {
    expect(weekSegments([{ id: 't', from: '2026-09-01', to: '2026-09-03' }], week)).toEqual([]);
  });

  it('stacks overlapping rows and reuses a lane once it is free', () => {
    const segs = weekSegments(
      [
        { id: 'long', from: '2026-09-07', to: '2026-09-10' },
        { id: 'over', from: '2026-09-08', to: '2026-09-09' },
        { id: 'after', from: '2026-09-12', to: '2026-09-12' },
      ],
      week,
    );
    const lane = Object.fromEntries(segs.map((s) => [s.id, s.lane]));
    expect(lane).toEqual({ long: 0, over: 1, after: 0 });
  });
});

describe('ticksFor across a year boundary', () => {
  const range = { start: '2026-11-01', end: '2027-03-01', days: 121 };

  it('names the year in January, and only there', () => {
    const labels = ticksFor(range, 3, 30).filter((t) => t.major).map((t) => t.label);
    expect(labels).toEqual(['Nov', 'Dec', 'Jan 2027', 'Feb', 'Mar']);
  });

  it('drops the months when they collide, keeping the years', () => {
    const wide = { start: '2026-01-01', end: '2028-12-31', days: 1096 };
    const labels = ticksFor(wide, 0.8, 30).map((t) => t.label);
    expect(labels).toEqual(['Jan 2026', 'Jan 2027', 'Jan 2028']);
  });
});
