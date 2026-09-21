import { describe, expect, it } from 'vitest';
import { resolveHotkey, type KeyLike } from './hotkeys';

const key = (k: string, mods: Partial<KeyLike> = {}): KeyLike =>
  ({ key: k, metaKey: false, ctrlKey: false, altKey: false, ...mods });

const idle = { typing: false, armed: null };

describe('resolveHotkey', () => {
  it('claims the modified keys anywhere, typing or not', () => {
    for (const ctx of [idle, { typing: true, armed: null }]) {
      expect(resolveHotkey(key('k', { metaKey: true }), ctx)).toEqual({ action: 'palette' });
      expect(resolveHotkey(key('K', { ctrlKey: true }), ctx)).toEqual({ action: 'palette' });
      expect(resolveHotkey(key('\\', { metaKey: true }), ctx)).toEqual({ action: 'sidebar' });
      expect(resolveHotkey(key('j', { metaKey: true }), ctx)).toEqual({ action: 'theme' });
    }
  });

  // The rule the whole design rests on: a bare letter is never a shortcut while
  // someone is writing.
  it('keeps its hands off bare keys while text is being typed', () => {
    const typing = { typing: true, armed: null };
    for (const k of ['c', 'n', 'g', '/', '?']) {
      expect(resolveHotkey(key(k), typing)).toBeNull();
    }
  });

  // The bug: reading the `?` sheet and pressing `c` to see what it does made a
  // page behind the dialog and navigated to it.
  it('keeps its hands off bare keys while a dialog is being read', () => {
    const reading = { typing: false, inDialog: true, armed: null };
    for (const k of ['c', 'n', 'g', '/', '?']) {
      expect(resolveHotkey(key(k), reading)).toBeNull();
    }
  });

  // A dialog does not want ⌘K, ⌘\\ or ⌘J, so those still work over one.
  it('still takes the modified keys over a dialog', () => {
    const reading = { typing: false, inDialog: true, armed: null };
    expect(resolveHotkey(key('k', { metaKey: true }), reading)).toEqual({ action: 'palette' });
    expect(resolveHotkey(key('j', { ctrlKey: true }), reading)).toEqual({ action: 'theme' });
  });

  it('reads the bare keys when nothing is listening for text', () => {
    expect(resolveHotkey(key('/'), idle)).toEqual({ action: 'palette' });
    expect(resolveHotkey(key('?'), idle)).toEqual({ action: 'shortcuts' });
    expect(resolveHotkey(key('c'), idle)).toEqual({ action: 'create' });
    expect(resolveHotkey(key('n'), idle)).toEqual({ action: 'capture' });
  });

  it('arms g, then reads the letter that says where to go', () => {
    expect(resolveHotkey(key('g'), idle)).toEqual({ arm: 'g' });
    const armed = { typing: false, armed: 'g' };
    expect(resolveHotkey(key('h'), armed)).toEqual({ action: 'home' });
    expect(resolveHotkey(key('T'), armed)).toEqual({ action: 'tasks' });
    expect(resolveHotkey(key('d'), armed)).toEqual({ action: 'docs' });
    expect(resolveHotkey(key('i'), armed)).toEqual({ action: 'inbox' });
  });

  // `g` then `c` must not make a page: the chord ends, and nothing happens.
  it('a chord that goes nowhere does nothing at all', () => {
    expect(resolveHotkey(key('c'), { typing: false, armed: 'g' })).toBeNull();
    expect(resolveHotkey(key('z'), { typing: false, armed: 'g' })).toBeNull();
  });

  it('leaves every other key to the page', () => {
    for (const k of ['a', 'Enter', 'ArrowDown', 'Escape', 'F5', ' ']) {
      expect(resolveHotkey(key(k), idle)).toBeNull();
    }
    expect(resolveHotkey(key('c', { altKey: true }), idle)).toBeNull();
  });
});
