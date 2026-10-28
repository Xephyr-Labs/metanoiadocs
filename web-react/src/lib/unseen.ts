import type { Folder, Page, PageId } from './types';

// "Someone changed this since you last looked", for the sidebar. The server
// decides per page (Page.unseen); the open page never counts — you are looking.

type Pages = Record<PageId, Page>;

export const isUnseen = (pages: Pages, currentId: PageId | null, id: PageId): boolean =>
  id !== currentId && !!pages[id]?.unseen;

/** Whether anything nested under this page is unseen — for a collapsed parent's dot. */
export function unseenBelow(pages: Pages, currentId: PageId | null, id: PageId, seen = new Set<PageId>()): boolean {
  for (const child of pages[id]?.children ?? []) {
    // Page links can loop (A inside B inside A); each page is visited once.
    if (seen.has(child)) continue;
    seen.add(child);
    if (isUnseen(pages, currentId, child) || unseenBelow(pages, currentId, child, seen)) return true;
  }
  return false;
}

/** Whether a folder holds an unseen page, in it, under its pages or in its subfolders. */
export function unseenInFolder(folders: Record<string, Folder>, pages: Pages, currentId: PageId | null, id: string, seen = new Set<string>()): boolean {
  if (seen.has(id)) return false;
  seen.add(id);
  const f = folders[id];
  if (!f) return false;
  return f.documentIds.some((p) => isUnseen(pages, currentId, p) || unseenBelow(pages, currentId, p))
    || f.children.some((c) => unseenInFolder(folders, pages, currentId, c, seen));
}
