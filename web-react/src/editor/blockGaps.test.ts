import { afterEach, describe, expect, it, vi } from 'vitest';
import { focusDocEnd, gapAt, NO_DIRECT_ATTR, type GapBlock } from './blockGaps';
import { SUGGESTING_CLASS } from './suggest/suggestingInput';

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

describe('focusDocEnd: a click below a page that ends in a card', () => {
  afterEach(() => vi.unstubAllGlobals());

  /** A page whose last block is an image, on a host inside `marks` (attributes up the tree) under <html> classes `html`. */
  function page({ marks = [] as string[], html = [] as string[] } = {}) {
    vi.stubGlobal('document', { documentElement: { classList: { contains: (c: string) => html.includes(c) } } });
    vi.stubGlobal('requestAnimationFrame', () => 0);
    const image = { id: 'img', flavour: 'affine:image', text: null, children: [] };
    const note = { id: 'note', flavour: 'affine:note', children: [image] as unknown[] };
    const addBlock = vi.fn(() => 'p1');
    const drawn = { getBoundingClientRect: () => ({ bottom: 100 }), getClientRects: () => [1] };
    const std = {
      store: { readonly: false, root: { children: [note] }, addBlock, getModelById: () => ({ id: 'p1', text: { length: 0 } }) },
      view: { getBlock: () => drawn },
      selection: { create: () => ({}), setGroup: () => {} },
      event: { active: false },
    };
    const host = { std, closest: (sel: string) => (marks.some((m) => sel === `[${m}]`) ? {} : null) };
    const editor = { querySelector: () => host } as unknown as Element;
    return { editor, addBlock };
  }

  it('an editor gets a new line there', () => {
    const p = page();
    expect(focusDocEnd(p.editor, 500)).toBe(true);
    expect(p.addBlock).toHaveBeenCalledTimes(1);
  });

  it('a suggester (noDirect) or anyone in Suggesting mode does not: the unmarked line is never sent', () => {
    for (const p of [page({ marks: [NO_DIRECT_ATTR] }), page({ html: [SUGGESTING_CLASS] })]) {
      expect(focusDocEnd(p.editor, 500)).toBe(false);
      expect(p.addBlock).not.toHaveBeenCalled();
    }
  });
});
