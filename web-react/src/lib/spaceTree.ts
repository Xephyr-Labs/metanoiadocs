import type { MovePreview, SpaceRow } from './spacesApi';

/** The space an item counts as in: its own when known, else the default. '' when no spaces loaded. */
export function spaceOf(spaceId: string | null | undefined, spaces: SpaceRow[]): string {
  if (spaceId && spaces.some((s) => s.id === spaceId)) return spaceId;
  return spaces.find((s) => s.is_default)?.id ?? '';
}

/**
 * Bucket items by space for the sidebar. Only joined spaces get a key; an item
 * with no space, or one this list does not know, falls under the default.
 */
export function groupBySpace<T extends { spaceId?: string | null }>(items: T[], spaces: SpaceRow[]): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const s of spaces) if (s.joined) out.set(s.id, []);
  for (const it of items) {
    const id = spaceOf(it.spaceId, spaces);
    if (id) out.get(id)?.push(it);
  }
  return out;
}

/**
 * The space you are in, Notion-workspace style: the remembered one while you
 * are still a member, else the default, else your first joined space. Never
 * '' while spaces exist, so the sidebar always has a space to draw.
 */
export function currentSpaceFrom(stored: string | null | undefined, spaces: SpaceRow[]): string {
  const joined = spaces.filter((s) => s.joined);
  if (stored && joined.some((s) => s.id === stored)) return stored;
  const def = spaces.find((s) => s.is_default);
  if (def?.joined) return def.id;
  return joined[0]?.id ?? def?.id ?? spaces[0]?.id ?? '';
}

/**
 * Whether an item shows while you are in `current`. Items in a space you have
 * not joined show in every space: you cannot switch there, and nothing you
 * could see before spaces may disappear.
 */
export function inCurrentSpace(spaceId: string | null | undefined, current: string, spaces: SpaceRow[]): boolean {
  if (!spaces.length) return true;
  const id = spaceOf(spaceId, spaces);
  return id === current || !spaces.find((s) => s.id === id)?.joined;
}

/** First letter of a space's name, for its avatar tile. */
export function spaceInitial(name: string): string {
  return Array.from(name.trim())[0]?.toUpperCase() || '?';
}

/** The space chip on All documents and Tasks: 'joined', 'all', or one space id. */
export type SpaceFilter = string;

export function inSpaceFilter(spaceId: string | null | undefined, filter: SpaceFilter, spaces: SpaceRow[]): boolean {
  if (filter === 'all' || !spaces.length) return true;
  const id = spaceOf(spaceId, spaces);
  if (filter === 'joined') return !!spaces.find((s) => s.id === id)?.joined;
  return id === filter;
}

/** A list's space chip: picking the space you are in reads like the sidebar
 *  (unjoined-space items too); any other pick is that space alone. */
export function inSpacePick(spaceId: string | null | undefined, pick: SpaceFilter, current: string, spaces: SpaceRow[]): boolean {
  return pick === current ? inCurrentSpace(spaceId, current, spaces) : inSpaceFilter(spaceId, pick, spaces);
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "Moves 12 pages, 1 folder and 3 databases", for the move confirmation. */
export function moveSummary(p: MovePreview): string {
  const parts = [
    p.docs ? count(p.docs, 'page', 'pages') : '',
    p.folders ? count(p.folders, 'folder', 'folders') : '',
    p.projects ? count(p.projects, 'database', 'databases') : '',
  ].filter(Boolean);
  const listed = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0] ?? '';
  if (!p.hidden) return `Moves ${listed || 'nothing'}`;
  if (!listed) return "Moves some pages you can't see";
  return `Moves ${listed}${parts.length > 1 ? ',' : ''} and some pages you can't see`;
}

/** Search hits in the space you are in, then every other space's. */
export function splitBySpace<T extends { space_id?: string | null; named?: boolean }>(rows: T[], current: string, spaces: SpaceRow[]): [T[], T[]] {
  const here = (r: T) => r.named || !spaces.length || spaceOf(r.space_id, spaces) === current;
  return [rows.filter(here), rows.filter((r) => !here(r))];
}

/**
 * The rows a drop beside `target` reorders: exactly what the sidebar draws in
 * its container (the folder's pages, or its space's unfiled ones), so a
 * sub-page never rides along and gets un-nested. Null when the target is a
 * sub-page or its container is not drawn.
 */
export function pageSiblings(
  target: { folderId: string | null; parentId: string | null; spaceId?: string | null },
  folders: Record<string, { documentIds: string[] }>,
  trees: Map<string, { unfiledIds: string[] }>,
  spaces: SpaceRow[],
): string[] | null {
  if (target.parentId) return null;
  if (target.folderId) return folders[target.folderId]?.documentIds ?? null;
  return trees.get(spaceOf(target.spaceId, spaces))?.unfiledIds ?? null;
}
