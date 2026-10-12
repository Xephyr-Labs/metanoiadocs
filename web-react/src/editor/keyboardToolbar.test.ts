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

describe('dropNewPage', () => {
  it('takes "New page" out of the + panel and leaves the rest', async () => {
    const { dropNewPage } = await import('./keyboardToolbar');
    const dyn = () => null;
    const items = [{ groups: [{ name: 'Page', items: [{ name: 'NewPage' }, { name: 'LinkedPage' }] }, dyn] }, { name: 'Undo' }] as never[];
    const out = dropNewPage(items) as unknown as { groups?: unknown[] }[];
    expect((out[0].groups![0] as { items: { name: string }[] }).items.map((i) => i.name)).toEqual(['LinkedPage']);
    expect(out[0].groups![1]).toBe(dyn);
    expect(out[1]).toBe(items[1]);
  });
});
