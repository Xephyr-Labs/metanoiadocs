import { describe, expect, it } from 'vitest';
import { wordDiff } from './wordDiff';

describe('wordDiff', () => {
  it('marks only the changed words', () => {
    expect(wordDiff('the quick fox', 'the slow fox')).toEqual([
      { text: 'the ', op: 'same' },
      { text: 'quick', op: 'del' },
      { text: 'slow', op: 'add' },
      { text: ' fox', op: 'same' },
    ]);
  });
  it('handles empty sides', () => {
    expect(wordDiff('', 'new')).toEqual([{ text: 'new', op: 'add' }]);
    expect(wordDiff('old', '')).toEqual([{ text: 'old', op: 'del' }]);
  });
});
