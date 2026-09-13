import { describe, expect, it } from 'vitest';
import { parseFont } from './docPrefs';

// The storage and <html> halves need a DOM, which these tests don't have (and
// nothing else in the suite does either). What's worth pinning is the reading:
// a bad stored value must land on the default, because the stylesheet keys off
// this string and an unknown one paints nothing.
describe('parseFont', () => {
  it('keeps the two faces we ship', () => {
    expect(parseFont('serif')).toBe('serif');
    expect(parseFont('mono')).toBe('mono');
  });

  it('falls back for anything else', () => {
    expect(parseFont('default')).toBe('default');
    expect(parseFont('comic-sans')).toBe('default');
    expect(parseFont('')).toBe('default');
    expect(parseFont(null)).toBe('default');
    expect(parseFont(undefined)).toBe('default');
  });
});
