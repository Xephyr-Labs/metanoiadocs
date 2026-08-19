import { describe, expect, it } from 'vitest';
import { folderChain } from './folderPath';
import type { Folder } from './types';

const folder = (id: string, parentId: string | null): Folder => ({
  id, name: id, color: 'gray', parentId, position: 0, documentIds: [], children: [],
});

const tree = (...folders: Folder[]): Record<string, Folder> =>
  Object.fromEntries(folders.map((f) => [f.id, f]));

describe('folderChain', () => {
  it('reads top-level down to the folder itself', () => {
    const folders = tree(folder('a', null), folder('b', 'a'), folder('c', 'b'));
    expect(folderChain(folders, 'c').map((f) => f.id)).toEqual(['a', 'b', 'c']);
    expect(folderChain(folders, 'a').map((f) => f.id)).toEqual(['a']);
  });

  it('stops at a parent that is not loaded', () => {
    const folders = tree(folder('b', 'gone'), folder('c', 'b'));
    expect(folderChain(folders, 'c').map((f) => f.id)).toEqual(['b', 'c']);
  });

  it('cuts a parent loop instead of spinning', () => {
    const folders = tree(folder('a', 'b'), folder('b', 'a'));
    expect(folderChain(folders, 'a').map((f) => f.id)).toEqual(['b', 'a']);
  });

  it('is empty for a folder that does not exist', () => {
    expect(folderChain({}, 'nope')).toEqual([]);
  });
});
