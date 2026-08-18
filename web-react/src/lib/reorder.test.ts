import { describe, expect, it } from 'vitest';
import { dropZone, placeAt } from './reorder';

describe('placeAt', () => {
  it('drops a row above its target', () => {
    expect(placeAt(['a', 'b', 'c'], 'c', 'a', 'before')).toEqual(['c', 'a', 'b']);
  });

  it('drops a row below its target', () => {
    expect(placeAt(['a', 'b', 'c'], 'a', 'c', 'after')).toEqual(['b', 'c', 'a']);
  });

  it('places a row arriving from another container', () => {
    expect(placeAt(['a', 'b'], 'x', 'a', 'after')).toEqual(['a', 'x', 'b']);
  });

  it('refuses a row dropped on itself', () => {
    expect(placeAt(['a', 'b'], 'a', 'a', 'after')).toBeNull();
  });

  it('refuses a target that is not in the list', () => {
    expect(placeAt(['a', 'b'], 'a', 'gone', 'after')).toBeNull();
  });
});

describe('dropZone', () => {
  it('reads the top quarter of a row as "drop above"', () => {
    expect(dropZone(0, 32)).toBe('before');
    expect(dropZone(7, 32)).toBe('before');
  });

  it('reads the bottom quarter as "drop below"', () => {
    expect(dropZone(31, 32)).toBe('after');
  });

  it('reads the middle half as "nest inside"', () => {
    expect(dropZone(8, 32)).toBe('inside');
    expect(dropZone(16, 32)).toBe('inside');
    expect(dropZone(23, 32)).toBe('inside');
  });

  it('never nests when the row refuses to be a container', () => {
    expect(dropZone(15, 32, false)).toBe('before');
    expect(dropZone(20, 32, false)).toBe('after');
  });
});
