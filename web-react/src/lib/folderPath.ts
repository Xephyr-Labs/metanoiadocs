import type { Folder } from './types';

/**
 * The folders from the top level down to `id`, inclusive — the breadcrumb a
 * folder link lands on.
 *
 * A missing parent ends the chain (the folder simply reads as top-level) and a
 * parent loop is cut where it closes, the same defence `nestByParent` makes for
 * the sidebar: a cycle here would spin forever while rendering a header.
 */
export function folderChain(folders: Record<string, Folder>, id: string): Folder[] {
  const chain: Folder[] = [];
  const seen = new Set<string>();
  let cur: Folder | undefined = folders[id];
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    chain.unshift(cur);
    cur = cur.parentId ? folders[cur.parentId] : undefined;
  }
  return chain;
}
