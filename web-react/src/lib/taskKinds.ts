/**
 * What a task type looks like: its glyph, its colour and its name.
 *
 * Kept apart from the component that draws it so the choice can be tested
 * without a DOM, and so every view resolves a type the same way. The four
 * seeded keys get the glyphs people already know from Jira; a type someone
 * added is either a container (it holds children, like Epic) or it is not, and
 * that is the one thing about it a glyph can honestly say.
 */
import {
  Bookmark, Bug, CircleDot, Code, FileText, Flag, FlaskConical, Gauge, Globe, Layers, Lightbulb, Megaphone,
  MessageSquare, Package, Palette, Puzzle, Rocket, Search, Shield, Sparkles, SquareCheck, Star, Target, Users,
  Wrench, Zap, type LucideIcon,
} from 'lucide-react';

/** Fixed glyphs: these four keys draw the same everywhere, whatever is stored. */
const BY_KEY: Record<string, LucideIcon> = {
  epic: Zap,
  story: Bookmark,
  task: SquareCheck,
  bug: Bug,
};

/** The colours a new project is seeded with. Used where a row's own type list
 *  is not at hand — the cross-project task list gets keys and labels only. */
const SEED_COLOR: Record<string, string> = {
  epic: 'purple',
  story: 'green',
  task: 'gray',
  bug: 'red',
};

/**
 * What a custom type's creator can pick from, by the name stored in
 * task_kinds.icon. Order is the picker's order. Never rename a key: rows store it.
 */
export const KIND_ICONS: Record<string, { icon: LucideIcon; label: string }> = {
  flag: { icon: Flag, label: 'Flag' },
  star: { icon: Star, label: 'Star' },
  rocket: { icon: Rocket, label: 'Rocket' },
  target: { icon: Target, label: 'Target' },
  lightbulb: { icon: Lightbulb, label: 'Idea' },
  sparkles: { icon: Sparkles, label: 'Sparkles' },
  megaphone: { icon: Megaphone, label: 'Megaphone' },
  palette: { icon: Palette, label: 'Design' },
  'file-text': { icon: FileText, label: 'Document' },
  'message-square': { icon: MessageSquare, label: 'Message' },
  code: { icon: Code, label: 'Code' },
  wrench: { icon: Wrench, label: 'Wrench' },
  'flask-conical': { icon: FlaskConical, label: 'Experiment' },
  search: { icon: Search, label: 'Research' },
  shield: { icon: Shield, label: 'Shield' },
  gauge: { icon: Gauge, label: 'Gauge' },
  puzzle: { icon: Puzzle, label: 'Puzzle' },
  package: { icon: Package, label: 'Package' },
  globe: { icon: Globe, label: 'Globe' },
  users: { icon: Users, label: 'People' },
  layers: { icon: Layers, label: 'Layers' },
  'circle-dot': { icon: CircleDot, label: 'Dot' },
};

/** Epic, Story, Task and Bug: their glyph is fixed and offers no picker. */
export const isFixedKind = (key: string) => key in BY_KEY;

export function kindIcon(key: string, isGroup = false, icon?: string | null): LucideIcon {
  return BY_KEY[key] ?? (icon ? KIND_ICONS[icon]?.icon : undefined) ?? (isGroup ? Layers : CircleDot);
}

export interface KindVisual {
  icon: LucideIcon;
  color: string;
  label: string;
  /** The type was deleted from this project after the row was loaded. */
  missing: boolean;
}

/**
 * Resolve a task's `kind` key against the project's type rows.
 *
 * `rows` empty means the list is not known here (not loaded yet, or a view
 * that spans projects): the key's seeded look is the best guess, and for the
 * four seeded keys it is almost always the right one. `rows` present but
 * without this key means the type is gone, which is drawn in neutral grey so
 * the row does not look typed as something it is not.
 */
export function kindVisual(
  key: string,
  rows: readonly { key: string; label: string; color: string; is_group: boolean; icon?: string | null }[],
): KindVisual {
  const row = rows.find((r) => r.key === key);
  if (row) return { icon: kindIcon(row.key, row.is_group, row.icon), color: row.color, label: row.label, missing: false };
  const label = key ? key.charAt(0).toUpperCase() + key.slice(1) : 'Task';
  if (rows.length) return { icon: CircleDot, color: 'gray', label, missing: true };
  return { icon: kindIcon(key), color: SEED_COLOR[key] ?? 'gray', label, missing: false };
}

/**
 * Split a view's shown properties into "does it show the type" and the rest.
 *
 * One-line rows (gantt, calendar) lead the title with the type glyph instead
 * of carrying it among the chips after it, so the glyphs line up down the
 * column. The view's Type toggle still decides whether it is drawn. A view
 * with no property setting at all (`undefined`) shows it.
 */
export function splitKindProp<T extends { id: string }>(props: T[] | undefined): { showKind: boolean; rest: T[] } {
  if (!props) return { showKind: true, rest: [] };
  return { showKind: props.some((p) => p.id === 'sys:kind'), rest: props.filter((p) => p.id !== 'sys:kind') };
}
