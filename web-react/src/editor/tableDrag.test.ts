import { describe, expect, it } from 'vitest';
import { areaBetween, bandAt } from './tableDrag';

describe('bandAt', () => {
  const edges = [0, 100, 200, 300]; // three bands
  it('finds the band a point is in', () => {
    expect(bandAt(edges, 50)).toBe(0);
    expect(bandAt(edges, 100)).toBe(1);
    expect(bandAt(edges, 250)).toBe(2);
  });
  it('clamps a point past either end to the first or last band', () => {
    expect(bandAt(edges, -40)).toBe(0);
    expect(bandAt(edges, 900)).toBe(2);
  });
});

describe('areaBetween', () => {
  it('spans two corners whichever way the drag went', () => {
    expect(areaBetween({ row: 5, column: 1 }, { row: 2, column: 4 })).toEqual({
      type: 'area', rowStartIndex: 2, rowEndIndex: 5, columnStartIndex: 1, columnEndIndex: 4,
    });
  });
});
