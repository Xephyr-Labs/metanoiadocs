import { describe, expect, it } from 'vitest';
import { addDays, barFor, dayX, daysBetween, rangeFor, ticksFor } from './gantt';

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
    const ticks = ticksFor(range, 10, 7);
    expect(ticks[0].iso).toBe('2026-06-29');
    expect(ticks[0].label).toBe('Jun 29');
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

  it('never drops a month start, even when it would collide', () => {
    const ticks = ticksFor({ start: '2026-07-31', end: '2026-08-02', days: 3 }, 26, 1);
    expect(ticks.map((t) => t.label)).toEqual(['Jul 31', 'Aug', '2']);
  });
});
