import type { SpaceRow } from './spacesApi';

/**
 * Bucket items by space for the sidebar. Only joined spaces get a key; an item
 * with no space, or one this list does not know, falls under the default.
 */
export function groupBySpace<T extends { spaceId?: string | null }>(items: T[], spaces: SpaceRow[]): Map<string, T[]> {
  const out = new Map<string, T[]>();
  const known = new Set(spaces.map((s) => s.id));
  const def = spaces.find((s) => s.is_default)?.id;
  for (const s of spaces) if (s.joined) out.set(s.id, []);
  for (const it of items) {
    const id = it.spaceId && known.has(it.spaceId) ? it.spaceId : def;
    if (id) out.get(id)?.push(it);
  }
  return out;
}
