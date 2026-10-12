import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { anchoredOccurrence, encodeAnchor, findQuote, normalizeQuote } from './textMatch';

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

describe('anchoredOccurrence', () => {
  const setup = () => {
    const t = new Y.Doc().getText('t');
    t.insert(0, 'the cat and the dog');
    // The second "the".
    return { t, start: encodeAnchor(t, 12, 0), end: encodeAnchor(t, 15, -1) };
  };
  it('follows the chosen copy when another is typed in front of it', () => {
    const { t, start, end } = setup();
    expect(anchoredOccurrence(t, 'the', start, end)).toBe(1);
    t.insert(0, 'the ');
    expect(anchoredOccurrence(t, 'the', start, end)).toBe(2);
  });
  it('is null once the chosen copy is gone, though another copy is still there', () => {
    const { t, start, end } = setup();
    t.delete(12, 4);
    expect(anchoredOccurrence(t, 'the', start, end)).toBeNull();
  });
});
