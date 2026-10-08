import { describe, expect, it } from 'vitest';
import { coversAll, pageBlockIds } from './selectAll';

describe('select all', () => {
  it('counts an empty or fully selected line as already selected', () => {
    expect(coversAll(0, 0)).toBe(true);
    expect(coversAll(5, 5)).toBe(true);
    expect(coversAll(2, 5)).toBe(false);
  });

  it('takes every block of every page note, tables included, and skips canvas-only notes', () => {
    const root = {
      id: 'r', flavour: 'affine:page', children: [
        { id: 'n1', flavour: 'affine:note', children: [
          { id: 'p1', flavour: 'affine:paragraph', children: [] },
          { id: 't1', flavour: 'affine:table', children: [] },
        ] },
        { id: 's', flavour: 'affine:surface', children: [] },
        { id: 'n2', flavour: 'affine:note', props: { displayMode: 'edgeless' }, children: [
          { id: 'p2', flavour: 'affine:paragraph', children: [] },
        ] },
      ],
    };
    expect(pageBlockIds(root)).toEqual(['p1', 't1']);
  });
});
