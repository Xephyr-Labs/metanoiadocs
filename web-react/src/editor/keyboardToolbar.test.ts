import { describe, expect, it } from 'vitest';
import { flattenTextStyles } from './keyboardToolbar';

describe('flattenTextStyles', () => {
  it('lifts the Aa level onto the bar, in place, without inline TeX', () => {
    const items = [
      { name: 'More', groups: [] },
      { items: [{ name: 'TurnInto', groups: [] }, { name: 'Bold' }, { name: 'InlineTex' }, { name: 'Link' }], autoShow: () => null },
      { name: 'Undo' },
    ] as never[];
    expect(flattenTextStyles(items).map((i) => (i as { name?: string }).name)).toEqual(['More', 'TurnInto', 'Bold', 'Link', 'Undo']);
  });

  it('leaves a bar without that level alone', () => {
    const items = [{ name: 'Undo' }] as never[];
    expect(flattenTextStyles(items)).toBe(items);
  });
});
