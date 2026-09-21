/**
 * What a keystroke means, decided without touching the DOM.
 *
 * The hook that listens is a few lines of plumbing; this is the part with the
 * rules in it, and the part worth a test — a shortcut that fires while someone
 * is typing is the kind of bug you only find in a paragraph you have already
 * ruined.
 *
 * The same list drives the help dialog, so the sheet cannot drift from the
 * behaviour: there is one description of what `g t` does.
 */

export type HotkeyAction =
  | 'palette' | 'sidebar' | 'theme' | 'shortcuts'
  | 'home' | 'tasks' | 'docs' | 'inbox' | 'create';

/** The parts of a KeyboardEvent this needs. */
export interface KeyLike {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
}

export interface HotkeyContext {
  /** Something is listening for text — a field, or the editor. */
  typing: boolean;
  /** A chord key pressed within the window, or null. Only 'g' so far. */
  armed: string | null;
}

export interface HotkeyResult {
  /** What to do. Absent when the key only arms a chord. */
  action?: HotkeyAction;
  /** Hold this key: the next one decides where to go. */
  arm?: string;
}

/** Where `g` can take you. */
const GO: Record<string, HotkeyAction> = {
  h: 'home',
  t: 'tasks',
  d: 'docs',
  i: 'inbox',
};

/**
 * The action a keystroke asks for, or null for "not ours — leave it alone".
 *
 * Returning null rather than throwing or defaulting matters: every key this
 * does not claim has to reach the page untouched, and that is most of them.
 */
export function resolveHotkey(e: KeyLike, ctx: HotkeyContext): HotkeyResult | null {
  const mod = e.metaKey || e.ctrlKey;

  // Modified keys work anywhere, mid-sentence included: no editor wants them,
  // and a palette you cannot open from inside a document is a palette for
  // people who were not working.
  if (mod && !e.altKey) {
    const k = e.key.toLowerCase();
    if (k === 'k') return { action: 'palette' };
    if (e.key === '\\') return { action: 'sidebar' };
    if (k === 'j') return { action: 'theme' };
    return null;
  }

  // Everything past here is a bare key, so everything past here is off-limits
  // while someone is writing.
  if (e.altKey || e.ctrlKey || e.metaKey) return null;
  if (ctx.typing) return null;

  if (ctx.armed === 'g') {
    const action = GO[e.key.toLowerCase()];
    // An unrecognised second key ends the chord without doing anything, rather
    // than falling through to the single-key table — `g` then `c` should not
    // make a page.
    return action ? { action } : null;
  }

  if (e.key === 'g') return { arm: 'g' };
  // `?` arrives as the character on every layout that has one, which is what to
  // match on — the physical key behind it differs.
  if (e.key === '?') return { action: 'shortcuts' };
  if (e.key === '/') return { action: 'palette' };
  if (e.key === 'c') return { action: 'create' };
  return null;
}

export interface ShortcutRow {
  /** Written the way the dialog shows it: ['g', 'h'] is a chord, ['⌘', 'K'] a combination. */
  keys: string[];
  label: string;
  chord?: boolean;
}

export interface ShortcutGroup {
  title: string;
  rows: ShortcutRow[];
}

/** Whether to draw ⌘ or Ctrl. Read once, at module load. */
export const MOD_LABEL = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || '')
  ? '⌘' : 'Ctrl';

export const SHORTCUTS: ShortcutGroup[] = [
  {
    title: 'Anywhere',
    rows: [
      { keys: [MOD_LABEL, 'K'], label: 'Search pages, tasks and commands' },
      { keys: ['/'], label: 'Search — same palette, one key' },
      { keys: [MOD_LABEL, '\\'], label: 'Show or hide the sidebar' },
      { keys: [MOD_LABEL, 'J'], label: 'Switch between light and dark' },
      { keys: ['?'], label: 'This list' },
    ],
  },
  {
    title: 'Go to',
    rows: [
      { keys: ['G', 'H'], label: 'Home', chord: true },
      { keys: ['G', 'T'], label: 'My tasks', chord: true },
      { keys: ['G', 'D'], label: 'All documents', chord: true },
      { keys: ['G', 'I'], label: 'Inbox', chord: true },
    ],
  },
  {
    title: 'Make something',
    rows: [
      { keys: ['C'], label: 'New page — or a new task, on a database' },
    ],
  },
  {
    title: 'In a task list',
    rows: [
      { keys: ['J'], label: 'Next task' },
      { keys: ['K'], label: 'Previous task' },
      { keys: ['Enter'], label: 'Open the task' },
      { keys: ['X'], label: 'Select it, to act on several at once' },
      { keys: [MOD_LABEL, 'click'], label: 'Pick a card on the board — shift-click for a run of rows' },
      { keys: ['Esc'], label: 'Clear the selection' },
    ],
  },
];
