import { describe, expect, it } from 'vitest';
import { alignBoxes, movedBoxes, MIN_FOR, type Box } from './align';

const box = (x: number, y: number, w = 10, h = 10): Box => ({ x, y, w, h });

describe('alignBoxes', () => {
  it('pulls every box to the outermost edge', () => {
    const boxes = [box(0, 0, 10), box(30, 50, 20), box(15, 20, 5)];
    expect(alignBoxes(boxes, 'left').map((b) => b.x)).toEqual([0, 0, 0]);
    // right edges land together: 30 + 20 = 50
    expect(alignBoxes(boxes, 'right').map((b) => b.x + b.w)).toEqual([50, 50, 50]);
    expect(alignBoxes(boxes, 'top').map((b) => b.y)).toEqual([0, 0, 0]);
    expect(alignBoxes(boxes, 'bottom').map((b) => b.y + b.h)).toEqual([60, 60, 60]);
  });

  it('centres on the selection bounds, so one wide box does not drag the axis', () => {
    // Bounds run 0..100; the centre is 50 whatever the widths are.
    const boxes = [box(0, 0, 100), box(40, 0, 10)];
    const centred = alignBoxes(boxes, 'center-x');
    expect(centred.map((b) => b.x + b.w / 2)).toEqual([50, 50]);

    const rows = [box(0, 0, 10, 100), box(0, 40, 10, 10)];
    expect(alignBoxes(rows, 'middle').map((b) => b.y + b.h / 2)).toEqual([50, 50]);
  });

  it('leaves the other axis alone', () => {
    const boxes = [box(0, 7), box(30, 19)];
    expect(alignBoxes(boxes, 'left').map((b) => b.y)).toEqual([7, 19]);
    expect(alignBoxes(boxes, 'top').map((b) => b.x)).toEqual([0, 30]);
  });

  it('refuses to act below the useful count, rather than doing something odd', () => {
    expect(MIN_FOR('left')).toBe(2);
    expect(MIN_FOR('distribute-x')).toBe(3);
    const one = [box(5, 5)];
    expect(alignBoxes(one, 'left')).toEqual(one);
    const two = [box(0, 0), box(50, 0)];
    expect(alignBoxes(two, 'distribute-x')).toEqual(two);
    expect(alignBoxes([], 'left')).toEqual([]);
  });
});

describe('distribute', () => {
  it('equalises the gaps and keeps the outer two still', () => {
    // widths 10/20/10 across 0..100 → 60 free, two gaps of 30
    const boxes = [box(0, 0, 10), box(15, 0, 20), box(90, 0, 10)];
    const out = alignBoxes(boxes, 'distribute-x');
    expect(out[0].x).toBe(0);
    expect(out[2].x).toBe(90);
    expect(out[1].x).toBe(40); // 0 + 10 + 30
    const gapA = out[1].x - (out[0].x + out[0].w);
    const gapB = out[2].x - (out[1].x + out[1].w);
    expect(gapA).toBeCloseTo(gapB);
  });

  it('distributes by position, not by the order they were selected in', () => {
    const boxes = [box(90, 0, 10), box(0, 0, 10), box(40, 0, 10)];
    const out = alignBoxes(boxes, 'distribute-x');
    // the leftmost and rightmost stay put wherever they sit in the array
    expect(out[1].x).toBe(0);
    expect(out[0].x).toBe(90);
    expect(out[2].x).toBe(45);
  });

  it('handles the vertical axis the same way', () => {
    const boxes = [box(0, 0, 10, 10), box(0, 12, 10, 10), box(0, 100, 10, 10)];
    const out = alignBoxes(boxes, 'distribute-y');
    expect(out[0].y).toBe(0);
    expect(out[2].y).toBe(100);
    expect(out[1].y).toBe(50);
  });

  it('stays sane when the boxes overlap more than the span', () => {
    const boxes = [box(0, 0, 100), box(10, 0, 100), box(20, 0, 100)];
    const out = alignBoxes(boxes, 'distribute-x');
    expect(out.every((b) => Number.isFinite(b.x))).toBe(true);
    expect(out[0].x).toBe(0);
    expect(out[2].x).toBe(20);
  });
});

describe('movedBoxes', () => {
  it('reports only what actually moved', () => {
    const before = [box(0, 0), box(30, 0), box(60, 0)];
    const after = alignBoxes(before, 'left');
    expect(movedBoxes(before, after)).toEqual([1, 2]);
  });

  it('ignores sub-pixel drift from the maths', () => {
    const before = [box(0, 0), box(10, 0)];
    const after = [box(0.001, 0), box(10, 0)];
    expect(movedBoxes(before, after)).toEqual([]);
  });
});
