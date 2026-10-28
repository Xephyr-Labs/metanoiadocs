import { describe, expect, it } from 'vitest';
import type { Folder, Page } from './types';
import { isUnseen, unseenBelow, unseenInFolder } from './unseen';

const page = (id: string, children: string[] = [], unseen = false) => ({ id, children, unseen }) as unknown as Page;
const folder = (id: string, documentIds: string[], children: string[] = []) => ({ id, documentIds, children }) as unknown as Folder;

describe('unseen', () => {
  const pages = { a: page('a', ['b']), b: page('b', ['c']), c: page('c', [], true), d: page('d', [], true) };

  it('a changed page is unseen until it is the open one', () => {
    expect(isUnseen(pages, null, 'd')).toBe(true);
    expect(isUnseen(pages, 'd', 'd')).toBe(false);
    expect(isUnseen(pages, null, 'a')).toBe(false);
    expect(isUnseen(pages, null, 'missing')).toBe(false);
  });

  it('a parent knows about an unseen page any depth below it, unless that page is open', () => {
    expect(unseenBelow(pages, null, 'a')).toBe(true);
    expect(unseenBelow(pages, 'c', 'a')).toBe(false);
    expect(unseenBelow(pages, null, 'c')).toBe(false);
  });

  it('survives pages nested inside each other', () => {
    const loop = { x: page('x', ['y']), y: page('y', ['x']) };
    expect(unseenBelow(loop, null, 'x')).toBe(false);
  });

  it('a folder sees its pages, what is under them, and its subfolders', () => {
    const folders = { f: folder('f', ['a']), g: folder('g', [], ['h']), h: folder('h', ['d']), e: folder('e', []) };
    expect(unseenInFolder(folders, pages, null, 'f')).toBe(true);
    expect(unseenInFolder(folders, pages, null, 'g')).toBe(true);
    expect(unseenInFolder(folders, pages, 'd', 'g')).toBe(false);
    expect(unseenInFolder(folders, pages, null, 'e')).toBe(false);
  });
});
