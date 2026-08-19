import { describe, expect, it } from 'vitest';
import { dayLabel, groupByDay } from './versionGroups';

/** Local time throughout — the labels are the user's calendar, not UTC. */
const at = (s: string) => new Date(s);
const now = at('2026-08-19T14:00:00');

describe('dayLabel', () => {
  it('dates every day the same way, near or far', () => {
    expect(dayLabel(at('2026-08-19T09:12:00'), now)).toBe('Aug 19');
    expect(dayLabel(at('2026-08-18T23:59:00'), now)).toBe('Aug 18');
    expect(dayLabel(at('2026-07-02T10:00:00'), now)).toBe('Jul 2');
  });

  it('adds the year once it is no longer this one', () => {
    expect(dayLabel(at('2025-12-02T10:00:00'), now)).toBe('Dec 2, 2025');
  });

  it('splits on the local calendar day, not on elapsed hours', () => {
    // Twenty minutes apart, but across midnight: two different headings.
    expect(dayLabel(at('2026-08-18T23:50:00'), now)).not.toBe(dayLabel(at('2026-08-19T00:10:00'), now));
  });
});

describe('groupByDay', () => {
  const rows = [
    { id: 'a', created_at: '2026-08-19T13:00:00' },
    { id: 'b', created_at: '2026-08-19T09:00:00' },
    { id: 'c', created_at: '2026-08-18T17:30:00' },
    { id: 'd', created_at: '2026-07-02T08:00:00' },
  ];

  it('runs newest-first days without reordering rows', () => {
    const groups = groupByDay(rows, now);
    expect(groups.map((g) => g.label)).toEqual(['Aug 19', 'Aug 18', 'Jul 2']);
    expect(groups.map((g) => g.key)).toEqual(['2026-08-19', '2026-08-18', '2026-07-02']);
    expect(groups[0].rows.map((r) => r.id)).toEqual(['a', 'b']);
    expect(groups[1].rows.map((r) => r.id)).toEqual(['c']);
  });

  it('drops rows with an unreadable timestamp instead of heading them "Invalid Date"', () => {
    const groups = groupByDay([{ id: 'x', created_at: 'not a date' }, ...rows], now);
    expect(groups.flatMap((g) => g.rows).map((r) => r.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('is empty for an empty list', () => {
    expect(groupByDay([], now)).toEqual([]);
  });
});
