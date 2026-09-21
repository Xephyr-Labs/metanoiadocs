import { describe, expect, it } from 'vitest';
import { click, prune, range, toggle } from './selection';

const ids = ['a', 'b', 'c', 'd', 'e'];

describe('toggle', () => {
  it('adds what is missing and removes what is there', () => {
    expect([...toggle(new Set(), 'a')]).toEqual(['a']);
    expect([...toggle(new Set(['a', 'b']), 'a')]).toEqual(['b']);
  });

  it('never mutates the set it was given', () => {
    const before = new Set(['a']);
    toggle(before, 'b');
    expect([...before]).toEqual(['a']);
  });
});

describe('range', () => {
  it('runs in list order whichever way it was clicked', () => {
    expect(range(ids, 'b', 'd')).toEqual(['b', 'c', 'd']);
    expect(range(ids, 'd', 'b')).toEqual(['b', 'c', 'd']);
  });

  it('is just the row itself when there is nothing to measure from', () => {
    expect(range(ids, null, 'c')).toEqual(['c']);
    // The anchor row was filtered out from under the selection.
    expect(range(ids, 'zz', 'c')).toEqual(['c']);
  });

  it('is empty when the row clicked is not in the list at all', () => {
    expect(range(ids, 'a', 'zz')).toEqual([]);
  });
});

describe('click', () => {
  it('moves the anchor on a plain click', () => {
    expect(click(new Set(), ids, null, 'c', false)).toEqual({ selected: new Set(['c']), anchor: 'c' });
  });

  it('extends from the anchor and leaves it where it was', () => {
    const first = click(new Set(), ids, null, 'b', false);
    const second = click(first.selected, ids, first.anchor, 'd', true);
    expect([...second.selected].sort()).toEqual(['b', 'c', 'd']);
    expect(second.anchor).toBe('b');
    // Shift-clicking again re-measures from the same row rather than growing.
    const third = click(second.selected, ids, second.anchor, 'c', true);
    expect([...third.selected].sort()).toEqual(['b', 'c', 'd']);
  });

  // A shift-click only ever adds. Un-picking a row is what a plain click is for.
  it('never drops a row on a shift-click', () => {
    const start = new Set(['e']);
    const out = click(start, ids, 'a', 'b', true);
    expect([...out.selected].sort()).toEqual(['a', 'b', 'e']);
  });
});

describe('prune', () => {
  it('drops ids the list no longer has', () => {
    expect([...prune(new Set(['a', 'zz']), ids)]).toEqual(['a']);
  });

  it('hands back the same set when nothing changed, so nothing re-renders', () => {
    const set = new Set(['a', 'b']);
    expect(prune(set, ids)).toBe(set);
  });
});
