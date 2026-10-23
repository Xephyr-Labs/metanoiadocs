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

/** The space chip on All documents and Tasks: 'joined', 'all', or one space id. */
export type SpaceFilter = string;

export function inSpaceFilter(spaceId: string | null | undefined, filter: SpaceFilter, spaces: SpaceRow[]): boolean {
  if (filter === 'all' || !spaces.length) return true;
  const id = spaceOf(spaceId, spaces);
  if (filter === 'joined') return !!spaces.find((s) => s.id === id)?.joined;
  return id === filter;
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

/**
 * Search hits in your spaces, then the rest, each in the server's order. The
 * task a pasted key names stays with the first group whatever its space.
 */
export function splitByJoined<T extends { inJoinedSpace?: boolean; named?: boolean }>(rows: T[]): [T[], T[]] {
  const mine = (r: T) => r.named || r.inJoinedSpace !== false;
  return [rows.filter(mine), rows.filter((r) => !mine(r))];
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
