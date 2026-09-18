import { beforeEach, describe, expect, it } from 'vitest';
import { collapsedSections, panelClosed, railSection, setPanelClosed, setRailSection, toggleSection } from './sidebarPrefs';

// The suite runs in node, and nothing else here needs a DOM. Six lines of Map
// is cheaper than pulling jsdom in to store two keys.
const store = new Map<string, string>();
globalThis.localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() { return store.size; },
};

beforeEach(() => localStorage.clear());

describe('collapsed sections', () => {
  it('starts with Templates folded and nothing else', () => {
    // Twelve permanent rows for something reached once a week was a third of
    // the sidebar's height on a workspace with no documents in it yet.
    expect([...collapsedSections()]).toEqual(['templates']);
  });

  it('remembers a fold across a reload', () => {
    toggleSection('tags');
    expect(collapsedSections().has('tags')).toBe(true);
  });

  it('unfolding Templates sticks, rather than reverting to the default', () => {
    // The bug this replaced: the default was re-applied on every read, so the
    // one section people actually open kept closing itself again.
    toggleSection('templates');
    expect(collapsedSections().has('templates')).toBe(false);
  });
});

describe('the panel beside the rail', () => {
  it('is open until someone puts it away', () => {
    expect(panelClosed()).toBe(false);
  });

  it('remembers being put away, and does not take the rest of the prefs with it', () => {
    toggleSection('tags');
    setRailSection('projects');
    setPanelClosed(true);
    expect(panelClosed()).toBe(true);
    expect(railSection()).toBe('projects');
    expect(collapsedSections().has('tags')).toBe(true);
  });

  it('opens again', () => {
    setPanelClosed(true);
    setPanelClosed(false);
    expect(panelClosed()).toBe(false);
  });
});

describe('rail section', () => {
  it('shows everything until someone picks otherwise', () => {
    expect(railSection()).toBe('all');
  });

  it('remembers the pick, and keeps the folds beside it', () => {
    toggleSection('tags');
    setRailSection('projects');
    expect(railSection()).toBe('projects');
    expect(collapsedSections().has('tags')).toBe(true);
  });
});
