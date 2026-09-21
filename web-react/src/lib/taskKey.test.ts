import { describe, expect, it } from 'vitest';
import { splitKey } from './taskKey';

describe('splitKey', () => {
  it('takes the key off a keyed title', () => {
    expect(splitKey('MD-14: Fix login redirect')).toEqual({ key: 'MD-14', text: 'Fix login redirect' });
    expect(splitKey('MD-14:Fix login')).toEqual({ key: 'MD-14', text: 'Fix login' });
  });

  it('leaves a title that has no key alone', () => {
    expect(splitKey('Fix login redirect')).toEqual({ key: null, text: 'Fix login redirect' });
  });

  // The two shapes that look like a key and are not. Both must survive whole,
  // or a board row loses its first word.
  it('does not mistake a colon for a key', () => {
    expect(splitKey('Bug: login redirects twice')).toEqual({ key: null, text: 'Bug: login redirects twice' });
    expect(splitKey('TODO 2026: plan the quarter')).toEqual({ key: null, text: 'TODO 2026: plan the quarter' });
  });

  it('handles the empty and missing cases the board actually renders', () => {
    expect(splitKey('')).toEqual({ key: null, text: '' });
    expect(splitKey(null)).toEqual({ key: null, text: '' });
    expect(splitKey(undefined)).toEqual({ key: null, text: '' });
  });
});
