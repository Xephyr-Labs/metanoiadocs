import { describe, expect, it } from 'vitest';
import { regionAround } from './androidRecompose';

describe('regionAround', () => {
  const text = 'The onboarding flow';
  it('finds the word the caret sits inside', () => {
    expect(regionAround(text, 8, 'onboarding')).toEqual({ index: 4, length: 10 });
  });
  it('accepts a caret at either edge of the word', () => {
    expect(regionAround(text, 4, 'onboarding')).toEqual({ index: 4, length: 10 });
    expect(regionAround(text, 14, 'onboarding')).toEqual({ index: 4, length: 10 });
  });
  it('ignores the same word elsewhere, and nothing at all', () => {
    expect(regionAround('flow and flow', 12, 'flow')).toEqual({ index: 9, length: 4 });
    expect(regionAround(text, 2, 'onboarding')).toBeNull();
    expect(regionAround(text, 8, '')).toBeNull();
  });
});
