import { describe, expect, it } from 'vitest';
import { daysUntil } from './time';

const inHours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

describe('daysUntil', () => {
  it('rounds up so a deadline inside the day still reads as a day', () => {
    expect(daysUntil(inHours(20))).toBe(1);
    expect(daysUntil(inHours(25))).toBe(2);
  });

  it('clamps the past to zero rather than going negative', () => {
    expect(daysUntil(inHours(-72))).toBe(0);
  });

  it('returns null for a missing or unparseable date', () => {
    expect(daysUntil(null)).toBeNull();
    expect(daysUntil('not a date')).toBeNull();
  });
});
