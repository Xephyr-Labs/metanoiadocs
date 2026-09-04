import { describe, expect, it } from 'vitest';
import { panelOf, setPanel } from './callout';

/** Just enough of a Y.Map for the two functions under test. */
const fakeCallout = (props: Record<string, unknown> = {}, emoji = '😀') => {
  const map = new Map<string, unknown>(Object.entries(props));
  return {
    id: 'c1',
    flavour: 'affine:callout',
    props: { emoji },
    yBlock: {
      get: (k: string) => map.get(k),
      set: (k: string, v: unknown) => void map.set(k, v),
      delete: (k: string) => void map.delete(k),
    },
    map,
  };
};
const fakeStore = () => {
  const writes: Record<string, unknown>[] = [];
  return { writes, updateBlock: (_m: unknown, p: Record<string, unknown>) => void writes.push(p) };
};

describe('callout panels', () => {
  it('reads back the type it stored', () => {
    const model = fakeCallout();
    setPanel(model, fakeStore(), 'warning');
    expect(model.map.get('prop:mnPanel')).toBe('warning');
    expect(panelOf(model)).toBe('warning');
  });

  it('stores neutral as the absence of the prop', () => {
    const model = fakeCallout({ 'prop:mnPanel': 'error' });
    setPanel(model, fakeStore(), null);
    expect(model.map.has('prop:mnPanel')).toBe(false);
    expect(panelOf(model)).toBe(null);
  });

  it('ignores a value that is not a panel type', () => {
    expect(panelOf(fakeCallout({ 'prop:mnPanel': 'chartreuse' }))).toBe(null);
  });

  it('swaps an icon it set itself', () => {
    const store = fakeStore();
    setPanel(fakeCallout({}, 'ℹ️'), store, 'success');
    expect(store.writes).toEqual([{ emoji: '✅' }]);
  });

  it('leaves an icon the reader picked alone', () => {
    const store = fakeStore();
    setPanel(fakeCallout({}, '🦆'), store, 'success');
    expect(store.writes).toEqual([]);
  });
});
