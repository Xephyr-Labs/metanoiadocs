import { describe, expect, it } from 'vitest';
import { belongsOutside } from './foreignClipboard';

const inside = { closest: () => null };
const outside = { closest: () => null };
const field = { closest: (s: string) => (s === 'doc-title' ? null : {}) };
const host = { contains: (n: unknown) => n === inside };
const sel = (node: object | null) =>
  node ? { isCollapsed: false, rangeCount: 1, getRangeAt: () => ({ commonAncestorContainer: node }) } : { isCollapsed: true, rangeCount: 0, getRangeAt: () => { throw new Error('none'); } };

describe('belongsOutside', () => {
  it('lets the browser copy text selected outside the editor', () => {
    expect(belongsOutside('copy', host, null, sel(outside))).toBe(true);
    expect(belongsOutside('cut', host, null, sel(outside))).toBe(true);
  });

  it('leaves a selection in the page to BlockSuite', () => {
    expect(belongsOutside('copy', host, inside, sel(inside))).toBe(false);
  });

  it('leaves a block selection (no text range) to BlockSuite', () => {
    expect(belongsOutside('copy', host, inside, sel(null))).toBe(false);
  });

  it('gives a focused text box outside the editor its own clipboard', () => {
    expect(belongsOutside('copy', host, field, sel(null))).toBe(true);
    expect(belongsOutside('paste', host, field, sel(null))).toBe(true);
  });

  it('leaves the page title to its own clipboard handling', () => {
    // The title is a contenteditable outside editor-host; it must not read as a foreign field.
    const title = { closest: () => ({}) };
    expect(belongsOutside('paste', host, title, sel(null))).toBe(false);
    expect(belongsOutside('copy', host, title, sel(title))).toBe(false);
  });

  it('leaves a paste with no outside field to the page', () => {
    expect(belongsOutside('paste', host, inside, sel(outside))).toBe(false);
  });

  it('does nothing before the editor has a host', () => {
    expect(belongsOutside('copy', null, field, sel(outside))).toBe(false);
  });
});
