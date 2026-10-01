import { describe, expect, it } from 'vitest';
import { clampToColumn } from './fileDrop';

describe('clampToColumn', () => {
  const column = { left: 500, right: 1200 };
  const blocks = { top: 340, bottom: 480 };

  it('leaves a point over the text alone', () => {
    expect(clampToColumn(600, 400, column, blocks)).toEqual({ x: 600, y: 400 });
  });

  it('brings a drop in the left margin onto the line beside it', () => {
    expect(clampToColumn(440, 400, column, blocks)).toEqual({ x: 502, y: 400 });
  });

  it('brings a drop below the last line onto the last line', () => {
    expect(clampToColumn(600, 700, column, blocks)).toEqual({ x: 600, y: 479 });
  });
});
