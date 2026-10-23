import { describe, expect, it } from 'vitest';
import { groupBySpace, inSpaceFilter, moveSummary, pageSiblings, spaceOf, splitByJoined } from './spaceTree';
import type { SpaceRow } from './spacesApi';

const spaces = [
  { id: 'g', is_default: true, joined: true }, { id: 'm', is_default: false, joined: true }, { id: 'o', is_default: false, joined: false },
] as SpaceRow[];

describe('groupBySpace', () => {
  it('groups items under joined spaces, unknown under the default', () => {
    const out = groupBySpace([{ id: 1, spaceId: 'm' }, { id: 2, spaceId: null }, { id: 3, spaceId: 'o' }, { id: 4, spaceId: 'x' }], spaces);
    expect([...out.keys()]).toEqual(['g', 'm']);
    expect(out.get('g')!.map((i) => i.id)).toEqual([2, 4]);
    expect(out.get('m')!.map((i) => i.id)).toEqual([1]);
  });
});

describe('spaceOf', () => {
  it('resolves unknown and missing to the default', () => {
    expect(spaceOf('m', spaces)).toBe('m');
    expect(spaceOf(null, spaces)).toBe('g');
    expect(spaceOf('x', spaces)).toBe('g');
    expect(spaceOf('m', [])).toBe('');
  });
});

describe('inSpaceFilter', () => {
  it('joined keeps joined spaces, all keeps everything, an id keeps that space', () => {
    expect(inSpaceFilter('o', 'joined', spaces)).toBe(false);
    expect(inSpaceFilter(null, 'joined', spaces)).toBe(true);
    expect(inSpaceFilter('o', 'all', spaces)).toBe(true);
    expect(inSpaceFilter('o', 'o', spaces)).toBe(true);
    expect(inSpaceFilter('m', 'o', spaces)).toBe(false);
  });
  it('filters nothing while spaces are unknown', () => {
    expect(inSpaceFilter('o', 'joined', [])).toBe(true);
  });
});

describe('moveSummary', () => {
  it('names each non-zero part with the right plural', () => {
    expect(moveSummary({ docs: 1, folders: 0, projects: 0, hidden: false })).toBe('Moves 1 page');
    expect(moveSummary({ docs: 1, folders: 2, projects: 0, hidden: false })).toBe('Moves 1 page and 2 folders');
    expect(moveSummary({ docs: 12, folders: 1, projects: 3, hidden: false })).toBe('Moves 12 pages, 1 folder and 3 databases');
    expect(moveSummary({ docs: 0, folders: 0, projects: 1, hidden: false })).toBe('Moves 1 database');
  });
  it('mentions what you cannot see without a number', () => {
    expect(moveSummary({ docs: 2, folders: 1, projects: 0, hidden: true })).toBe("Moves 2 pages and 1 folder, and some pages you can't see");
    expect(moveSummary({ docs: 0, folders: 1, projects: 0, hidden: true })).toBe("Moves 1 folder and some pages you can't see");
    expect(moveSummary({ docs: 0, folders: 0, projects: 0, hidden: true })).toBe("Moves some pages you can't see");
  });
});

describe('splitByJoined', () => {
  it('keeps order, missing flag counts as joined', () => {
    const [mine, other] = splitByJoined([{ id: 1, inJoinedSpace: false }, { id: 2 }, { id: 3, inJoinedSpace: true }]);
    expect(mine.map((r) => r.id)).toEqual([2, 3]);
    expect(other.map((r) => r.id)).toEqual([1]);
  });
  it('keeps the task a pasted key names first, even from an unjoined space', () => {
    const [mine, other] = splitByJoined([{ id: 'MD-14', named: true, inJoinedSpace: false }, { id: 2 }, { id: 3, inJoinedSpace: false }]);
    expect(mine.map((r) => r.id)).toEqual(['MD-14', 2]);
    expect(other.map((r) => r.id)).toEqual([3]);
  });
});

describe('pageSiblings', () => {
  const folders = { F: { documentIds: ['a', 'b'] } };
  const trees = new Map([['g', { unfiledIds: ['u1', 'u2'] }], ['m', { unfiledIds: ['m1'] }]]);
  it('is what the sidebar draws for the target\'s container, never its sub-pages', () => {
    expect(pageSiblings({ folderId: 'F', parentId: null, spaceId: 'g' }, folders, trees, spaces)).toEqual(['a', 'b']);
    expect(pageSiblings({ folderId: null, parentId: null, spaceId: 'm' }, folders, trees, spaces)).toEqual(['m1']);
    expect(pageSiblings({ folderId: null, parentId: null, spaceId: null }, folders, trees, spaces)).toEqual(['u1', 'u2']);
  });
  it('has no list for a sub-page or an unknown container', () => {
    expect(pageSiblings({ folderId: 'F', parentId: 'a', spaceId: 'g' }, folders, trees, spaces)).toBeNull();
    expect(pageSiblings({ folderId: 'gone', parentId: null, spaceId: 'g' }, folders, trees, spaces)).toBeNull();
    expect(pageSiblings({ folderId: null, parentId: null, spaceId: 'o' }, folders, trees, spaces)).toBeNull();
  });
});
