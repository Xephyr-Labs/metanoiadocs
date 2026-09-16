/**
 * Which sidebar sections a person has collapsed, and which rail section they
 * are looking at.
 *
 * Per person, per browser — not shared. Whether *you* keep Tags folded away
 * says nothing about whether a colleague wants to see them, and pushing it into
 * the workspace would mean one person's tidy-up folds everybody else's sidebar.
 *
 * Every accessor is wrapped: localStorage throws in a private window, and a
 * sidebar that fails to render because a preference could not be read is a far
 * worse bug than a sidebar showing its defaults.
 */

const KEY = 'mn.sidebar.v1';

/** The panels the rail can show. `all` is the sidebar as it has always been —
 *  every section stacked — and stays the default so nobody's navigation moves
 *  under them on upgrade. */
export type RailSection =
  | 'all' | 'docs' | 'projects' | 'designs' | 'tags' | 'templates';

interface Prefs {
  /** Section keys the person has collapsed. Absent = expanded. */
  collapsed?: string[];
  /** Which rail section is showing. */
  section?: RailSection;
}

/**
 * Sections that start folded.
 *
 * Templates is the one that matters: twelve permanent rows for something reached
 * once a week, which on a fresh workspace was a third of the sidebar's height
 * before a single document existed. Folded by default, one click from open.
 */
const COLLAPSED_BY_DEFAULT = ['templates'];

function read(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? parsed as Prefs : {};
  } catch {
    return {};
  }
}

function write(next: Prefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* private window or full quota — the sidebar still works, just unremembered */
  }
}

export function collapsedSections(): Set<string> {
  const p = read();
  return new Set(p.collapsed ?? COLLAPSED_BY_DEFAULT);
}

export function toggleSection(key: string): Set<string> {
  const next = collapsedSections();
  if (next.has(key)) next.delete(key);
  else next.add(key);
  const p = read();
  write({ ...p, collapsed: [...next] });
  return next;
}

export function railSection(): RailSection {
  return read().section ?? 'all';
}

export function setRailSection(section: RailSection) {
  write({ ...read(), section });
}

/**
 * How many rows a list shows before it offers the rest behind a click.
 *
 * Not a scroll: a section that scrolls inside a sidebar that also scrolls is
 * two scrollbars answering the same gesture. A count and a button says how much
 * is hidden, which a cut-off list never does.
 */
export const SECTION_LIMIT = 8;
