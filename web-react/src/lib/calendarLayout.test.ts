import { describe, expect, it } from 'vitest';
import { allDayLanes, daysIn, monthCells, nowLineTop, positionTimed, rangeFor, startOfDay } from './calendarLayout';
import type { CalendarEvent } from './calendarEvents';

const ev = (id: string, start: string, end: string, allDay = false): CalendarEvent => ({
  id, title: id, start, end, allDay, meetLink: null, attendees: [], notesDocId: null, description: '', location: '',
  organizerSelf: false, myResponse: null, recurringEventId: null, htmlLink: null,
});

describe('rangeFor', () => {
  it('a week runs Monday to the next Monday (exclusive)', () => {
    expect(rangeFor('week', '2026-10-28')).toEqual({ from: '2026-10-26', to: '2026-11-02' });
    expect(rangeFor('week', '2026-10-26')).toEqual({ from: '2026-10-26', to: '2026-11-02' });
    expect(rangeFor('week', '2026-11-01')).toEqual({ from: '2026-10-26', to: '2026-11-02' });
    expect(rangeFor('week', '2026-10-28', 0)).toEqual({ from: '2026-10-25', to: '2026-11-01' });
  });
  it('a day is one day; a month is its whole 42-cell grid', () => {
    expect(rangeFor('day', '2026-10-28')).toEqual({ from: '2026-10-28', to: '2026-10-29' });
    expect(rangeFor('month', '2026-10-15')).toEqual({ from: '2026-09-28', to: '2026-11-09' });
  });
  it('daysIn lists every day, end exclusive', () => {
    expect(daysIn('2026-10-30', '2026-11-02')).toEqual(['2026-10-30', '2026-10-31', '2026-11-01']);
  });
});

describe('monthCells', () => {
  it('starts on the Monday on or before the 1st and has 42 cells', () => {
    const cells = monthCells('2026-10-15');
    expect(cells).toHaveLength(42);
    expect(cells[0]).toBe('2026-09-28');
    expect(cells[3]).toBe('2026-10-01');
    expect(cells[41]).toBe('2026-11-08');
  });
  it('a month starting on Monday starts on its 1st', () => {
    expect(monthCells('2026-06-20')[0]).toBe('2026-06-01');
  });
});

describe('positionTimed', () => {
  it('uses the real midnight on a 25-hour day', () => {
    const ny = 'America/New_York';
    // 2026-11-01 falls back: 25 hours long.
    expect(startOfDay('2026-11-02', ny) - startOfDay('2026-11-01', ny)).toBe(25 * 3600_000);
    expect(startOfDay('2026-03-09', ny) - startOfDay('2026-03-08', ny)).toBe(23 * 3600_000);
    // 22:00–23:00 EST that evening.
    const [p] = positionTimed([ev('a', '2026-11-02T03:00:00Z', '2026-11-02T04:00:00Z')], '2026-11-01', ny);
    expect(p).toMatchObject({ top: 22 * 60, height: 60 });
    // The whole day fills the column, no more.
    const [w] = positionTimed([ev('w', '2026-11-01T04:00:00Z', '2026-11-02T05:00:00Z')], '2026-11-01', ny);
    expect(w).toMatchObject({ top: 0, height: 24 * 60 });
  });
  it('a 23-hour day: an evening meeting keeps its wall-clock place', () => {
    const [p] = positionTimed([ev('a', '2026-03-09T01:00:00Z', '2026-03-09T02:30:00Z')], '2026-03-08', 'America/New_York');
    expect(p).toMatchObject({ top: 21 * 60, height: 90 });
  });
  it('a meeting across midnight shows on both days, clipped', () => {
    const e = ev('late', '2026-10-27T23:00:00Z', '2026-10-28T01:00:00Z');
    expect(positionTimed([e], '2026-10-27', 'UTC')[0]).toMatchObject({ top: 23 * 60, height: 60 });
    expect(positionTimed([e], '2026-10-28', 'UTC')[0]).toMatchObject({ top: 0, height: 60 });
    expect(positionTimed([e], '2026-10-29', 'UTC')).toEqual([]);
  });
  it('three overlapping share three columns; a later one has the day to itself', () => {
    const out = positionTimed([
      ev('d', '2026-10-27T13:00:00Z', '2026-10-27T14:00:00Z'),
      ev('a', '2026-10-27T09:00:00Z', '2026-10-27T10:00:00Z'),
      ev('b', '2026-10-27T09:30:00Z', '2026-10-27T10:30:00Z'),
      ev('c', '2026-10-27T09:45:00Z', '2026-10-27T11:00:00Z'),
    ], '2026-10-27', 'UTC');
    const by = Object.fromEntries(out.map((p) => [p.event.id, p]));
    expect([by.a.col, by.b.col, by.c.col]).toEqual([0, 1, 2]);
    expect([by.a.cols, by.b.cols, by.c.cols]).toEqual([3, 3, 3]);
    expect(by.d).toMatchObject({ col: 0, cols: 1 });
  });
  it('back-to-back meetings do not count as overlapping; all-day ones are skipped', () => {
    const out = positionTimed([
      ev('a', '2026-10-27T09:00:00Z', '2026-10-27T10:00:00Z'),
      ev('b', '2026-10-27T10:00:00Z', '2026-10-27T11:00:00Z'),
      ev('x', '2026-10-27', '2026-10-28', true),
    ], '2026-10-27', 'UTC');
    expect(out.map((p) => [p.event.id, p.col, p.cols])).toEqual([['a', 0, 1], ['b', 0, 1]]);
  });
});

describe('allDayLanes', () => {
  it('a multi-day event spans its columns; another day stacks below it', () => {
    const days = daysIn('2026-10-26', '2026-11-02');
    const out = allDayLanes([
      ev('trip', '2026-10-26', '2026-10-29', true),
      ev('one', '2026-10-27', '2026-10-28', true),
      ev('later', '2026-10-30', '2026-10-31', true),
      ev('before', '2026-10-20', '2026-10-27', true),
      ev('timed', '2026-10-27T09:00:00Z', '2026-10-27T10:00:00Z'),
    ], days);
    const by = Object.fromEntries(out.map((l) => [l.event.id, l]));
    expect(by.before).toMatchObject({ col: 0, span: 1, lane: 0 });
    expect(by.trip).toMatchObject({ col: 0, span: 3, lane: 1 });
    expect(by.one).toMatchObject({ col: 1, span: 1, lane: 0 });
    expect(by.later).toMatchObject({ col: 4, span: 1, lane: 0 });
    expect(by.timed).toBeUndefined();
  });
});

describe('nowLineTop', () => {
  it('reads the profile zone, not the browser', () => {
    const now = Date.parse('2026-10-27T12:00:00Z');
    expect(nowLineTop(now, 'Asia/Dhaka')).toBe(18 * 60);
    expect(nowLineTop(now, 'America/Los_Angeles')).toBe(5 * 60);
  });
});
