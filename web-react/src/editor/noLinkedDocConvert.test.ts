import { describe, expect, it } from 'vitest';
import { bracketed } from './noLinkedDocConvert';

describe('bracketed', () => {
  it('spots the second "[" of "[[" over a selection', () => {
    expect(bracketed('see [', '] here')).toBe(true);
    expect(bracketed('see ', ' here')).toBe(false);
    expect(bracketed('see [', ' here')).toBe(false);
  });
});
