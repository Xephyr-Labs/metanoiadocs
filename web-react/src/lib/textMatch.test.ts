import { describe, expect, it } from 'vitest';
import { findQuote, normalizeQuote } from './textMatch';

describe('findQuote', () => {
  it('matches through collapsed whitespace', () => {
    expect(findQuote('one  two three', 'two three')).toEqual({ index: 5, length: 9 });
  });
  it('finds a later occurrence', () => {
    expect(findQuote('ab ab', 'ab', 1)).toEqual({ index: 3, length: 2 });
  });
  it('returns null when absent', () => {
    expect(findQuote('abc', 'x')).toBeNull();
    expect(normalizeQuote('  a \n b ')).toBe('a b');
  });
});
