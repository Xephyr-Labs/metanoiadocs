import { describe, expect, it } from 'vitest';
import { allMarked, historyKey, isLinkKey, markForKey, selectedCellKeys, shortcutLetter } from './tableFormat';

const key = (k: string, mods: Partial<{ code: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }> = {}) =>
  ({ key: k, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...mods });

describe('markForKey', () => {
  it('reads the text format hotkeys with Ctrl off a Mac', () => {
    expect(markForKey(key('b', { ctrlKey: true }), false)).toBe('bold');
    expect(markForKey(key('i', { ctrlKey: true }), false)).toBe('italic');
    expect(markForKey(key('u', { ctrlKey: true }), false)).toBe('underline');
    expect(markForKey(key('e', { ctrlKey: true }), false)).toBe('code');
    expect(markForKey(key('S', { ctrlKey: true, shiftKey: true }), false)).toBe('strike');
  });

  it('wants Cmd on a Mac, and nothing extra', () => {
    expect(markForKey(key('b', { metaKey: true }), true)).toBe('bold');
    expect(markForKey(key('b', { ctrlKey: true }), true)).toBeNull();
    expect(markForKey(key('b', { ctrlKey: true, altKey: true }), false)).toBeNull();
    expect(markForKey(key('B', { ctrlKey: true, shiftKey: true }), false)).toBeNull();
    expect(markForKey(key('b'), false)).toBeNull();
  });
});

describe('shortcutLetter', () => {
  it('reads the letter a non-Latin layout types from the physical key', () => {
    expect(shortcutLetter({ key: 'и', code: 'KeyB' })).toBe('b');
    expect(markForKey(key('и', { code: 'KeyB', ctrlKey: true }), false)).toBe('bold');
  });

  it('trusts a Latin key over its position, as BlockSuite does', () => {
    // Dvorak: the key labelled B sits where QWERTY has N.
    expect(shortcutLetter({ key: 'b', code: 'KeyN' })).toBe('b');
    expect(shortcutLetter({ key: 'S', code: 'KeyS' })).toBe('s');
  });
});

describe('isLinkKey and historyKey', () => {
  it('take Ctrl+K off a Mac and Cmd+K on one, nothing else', () => {
    expect(isLinkKey(key('k', { ctrlKey: true }), false)).toBe(true);
    expect(isLinkKey(key('k', { metaKey: true }), true)).toBe(true);
    expect(isLinkKey(key('k', { ctrlKey: true }), true)).toBe(false);
    expect(isLinkKey(key('K', { ctrlKey: true, shiftKey: true }), false)).toBe(false);
    expect(isLinkKey(key('л', { code: 'KeyK', ctrlKey: true }), false)).toBe(true);
  });

  it('reads undo and both redo bindings', () => {
    expect(historyKey(key('z', { ctrlKey: true }), false)).toBe('undo');
    expect(historyKey(key('Z', { metaKey: true, shiftKey: true }), true)).toBe('redo');
    expect(historyKey(key('y', { ctrlKey: true }), false)).toBe('redo');
  });
});

describe('selectedCellKeys', () => {
  // Stored out of order on purpose: the table sorts by `order`, not by key.
  const rows = { r2: { rowId: 'r2', order: 'b' }, r1: { rowId: 'r1', order: 'a' }, r3: { rowId: 'r3', order: 'c' } };
  const columns = { c2: { columnId: 'c2', order: 'b' }, c1: { columnId: 'c1', order: 'a' } };

  it('takes every cell of a row', () => {
    expect(selectedCellKeys(rows, columns, { type: 'row', rowId: 'r2' })).toEqual(['r2:c1', 'r2:c2']);
  });

  it('takes every cell of a column, top to bottom', () => {
    expect(selectedCellKeys(rows, columns, { type: 'column', columnId: 'c2' })).toEqual(['r1:c2', 'r2:c2', 'r3:c2']);
  });

  it('takes a range by position', () => {
    expect(selectedCellKeys(rows, columns, {
      type: 'area', rowStartIndex: 1, rowEndIndex: 2, columnStartIndex: 1, columnEndIndex: 1,
    })).toEqual(['r2:c2', 'r3:c2']);
  });
});

describe('allMarked', () => {
  it('is true only when every character has the mark', () => {
    expect(allMarked([[{ insert: 'ab', attributes: { bold: true } }], [{ insert: 'c', attributes: { bold: true } }]], 'bold')).toBe(true);
    expect(allMarked([[{ insert: 'ab', attributes: { bold: true } }], [{ insert: 'c' }]], 'bold')).toBe(false);
  });

  it('ignores empty cells and embeds, and treats nothing as unmarked', () => {
    expect(allMarked([[], [{ insert: 'x', attributes: { italic: true } }], [{ insert: { mention: 1 } }]], 'italic')).toBe(true);
    expect(allMarked([[], []], 'bold')).toBe(false);
  });
});
