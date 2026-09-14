import { describe, expect, it } from 'vitest';
import { moveInOrder, resolveViewProps } from './viewProps';
import type { PropRow } from './tasksApi';

const prop = (id: string): PropRow => ({
  id,
  project_id: 'p',
  key: id,
  label: id.toUpperCase(),
  type: 'text',
  options: [],
  target_project_id: null,
  position: 0,
});

const props = [prop('a'), prop('b'), prop('c'), prop('d')];

describe('resolveViewProps', () => {
  it('shows the first few when nothing was ever configured', () => {
    const { visible, hidden } = resolveViewProps(null, props);
    expect(visible.map((p) => p.id)).toEqual(['a', 'b', 'c']);
    expect(hidden.map((p) => p.id)).toEqual(['d']);
  });

  it('honours "I hid everything" instead of springing back to the default', () => {
    // The distinction that makes this worth a function: [] is a choice, null
    // is the absence of one.
    expect(resolveViewProps([], props).visible).toEqual([]);
  });

  it('keeps the stored order, which is the display order', () => {
    const { visible } = resolveViewProps(['c', 'a'], props);
    expect(visible.map((p) => p.id)).toEqual(['c', 'a']);
  });

  it('drops a property that has since been deleted', () => {
    const { visible, hidden } = resolveViewProps(['a', 'gone', 'b'], props);
    expect(visible.map((p) => p.id)).toEqual(['a', 'b']);
    expect(hidden.map((p) => p.id)).toEqual(['c', 'd']);
  });

  it('ignores a duplicated id rather than drawing the chip twice', () => {
    expect(resolveViewProps(['a', 'a'], props).visible.map((p) => p.id)).toEqual(['a']);
  });

  it('puts a newly added property in Hidden, not on every card', () => {
    const { visible, hidden } = resolveViewProps(['a'], [...props, prop('e')]);
    expect(visible.map((p) => p.id)).toEqual(['a']);
    expect(hidden.map((p) => p.id)).toContain('e');
  });
});

describe('moveInOrder', () => {
  it('swaps with the neighbour', () => {
    expect(moveInOrder(['a', 'b', 'c'], 'b', -1)).toEqual(['b', 'a', 'c']);
    expect(moveInOrder(['a', 'b', 'c'], 'b', 1)).toEqual(['a', 'c', 'b']);
  });

  it('is a no-op at either end, and for an id that is not there', () => {
    const order = ['a', 'b'];
    expect(moveInOrder(order, 'a', -1)).toBe(order);
    expect(moveInOrder(order, 'b', 1)).toBe(order);
    expect(moveInOrder(order, 'zz', 1)).toBe(order);
  });
});
