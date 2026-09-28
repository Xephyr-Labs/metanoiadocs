import { describe, expect, it } from 'vitest';
import { overlap } from './keepCaretVisible';

describe('overlap', () => {
  it('is zero while the caret is clear of the toolbar band', () => {
    expect(overlap(500, 800)).toBe(0);
    expect(overlap(728, 800)).toBe(0);
  });
  it('is how far the caret sits inside the band above the keyboard', () => {
    expect(overlap(760, 800)).toBe(32);
    expect(overlap(800.4, 800)).toBe(73);
  });
});
