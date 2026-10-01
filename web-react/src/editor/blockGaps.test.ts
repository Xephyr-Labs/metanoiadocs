import { describe, expect, it } from 'vitest';
import { gapAt, type GapBlock } from './blockGaps';

const block = (id: string, top: number, bottom: number, card = false): GapBlock =>
  ({ id, top, bottom, left: 0, right: 700, card });

describe('gapAt', () => {
  const page = [block('p1', 100, 124), block('img', 142, 442, true), block('p2', 460, 484)];

  it('finds the gap above an image', () => {
    expect(gapAt(page, 300, 130)).toEqual({ id: 'img', side: 'above' });
  });

  it('finds the gap below an image', () => {
    expect(gapAt(page, 300, 450)).toEqual({ id: 'img', side: 'below' });
  });

  it('leaves clicks on the image and on text alone', () => {
    expect(gapAt(page, 300, 300)).toBeNull();
    expect(gapAt(page, 300, 110)).toBeNull();
  });

  it('gives a block at the top or bottom of the page room of its own', () => {
    const alone = [block('img', 100, 400, true)];
    expect(gapAt(alone, 300, 85)).toEqual({ id: 'img', side: 'above' });
    expect(gapAt(alone, 300, 415)).toEqual({ id: 'img', side: 'below' });
    expect(gapAt(alone, 300, 60)).toBeNull();
  });

  it('opens a line between two images', () => {
    const two = [block('a', 100, 300, true), block('b', 320, 520, true)];
    expect(gapAt(two, 300, 310)).toEqual({ id: 'a', side: 'below' });
  });

  it('ignores a point outside the block horizontally', () => {
    expect(gapAt(page, 900, 130)).toBeNull();
  });
});
