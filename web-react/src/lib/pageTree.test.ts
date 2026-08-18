import { describe, expect, it } from 'vitest';
import { nestByParent } from './pageTree';

const row = (id: string, parentId: string | null = null) => ({ id, parentId });

describe('nestByParent', () => {
  it('hands a nested page to its parent and keeps it out of the top level', () => {
    const t = nestByParent([row('a'), row('b', 'a'), row('c')]);
    expect(t.roots).toEqual(['a', 'c']);
    expect(t.childrenOf.get('a')).toEqual(['b']);
  });

  it('keeps the given order among siblings', () => {
    const t = nestByParent([row('a'), row('c', 'a'), row('b', 'a')]);
    expect(t.childrenOf.get('a')).toEqual(['c', 'b']);
  });

  // A parent in the trash, or private to someone else, is simply not in the
  // list. Its children must come back to the top rather than disappear.
  it('returns orphans to the top level', () => {
    const t = nestByParent([row('b', 'gone')]);
    expect(t.roots).toEqual(['b']);
  });

  // The server refuses to build one, but a bad row must not hang the sidebar:
  // rendering recurses through these children.
  it('breaks a parent cycle instead of looping forever', () => {
    const t = nestByParent([row('a', 'b'), row('b', 'a')]);
    expect(t.roots.length).toBeGreaterThan(0);
    expect(t.roots.concat([...t.childrenOf.values()].flat()).sort()).toEqual(['a', 'b']);
  });

  it('treats a page parented to itself as a top-level page', () => {
    const t = nestByParent([row('a', 'a')]);
    expect(t.roots).toEqual(['a']);
    expect(t.childrenOf.get('a')).toBeUndefined();
  });
});
