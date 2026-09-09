import { FileText, Folder, FolderInput } from 'lucide-react';
import type { MenuItem } from '../components/ui/Menu';
import type { PageId } from '../lib/types';
import { useWorkspace } from '../store/workspace';

/**
 * The "Move to →" submenu for a page, as one MenuItem ready to drop into any
 * Menu. The sidebar tree grew this first; the doc header, the home recents and
 * a task's page all need the same thing, and a page is only reachable from the
 * sidebar once it already lives somewhere.
 *
 * Returns null when there is nowhere to move to, so a caller can spread it in
 * without a menu ever showing an empty submenu.
 */
export function useMoveToFolder(pageId: PageId | null | undefined): MenuItem | null {
  const ws = useWorkspace();
  if (!pageId) return null;
  // A caller outside the sidebar — a home card, a task's page — may name a doc
  // the page store has not cached. Offer every folder in that case rather than
  // hiding the menu: the move itself only needs the id.
  const page = ws.pages[pageId] ?? null;

  const targets: MenuItem[] = [
    // Also the way out of a parent page: a nested page has no folder to leave,
    // so without this its only escape is a drag onto the edge of another row.
    ...(!page || page.folderId || page.parentId
      ? [{ icon: FileText, label: 'Top level', onSelect: () => ws.movePage(pageId, null) }]
      : []),
    ...Object.values(ws.folders)
      .filter((folder) => folder.id !== page?.folderId)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((folder) => ({
        icon: Folder,
        label: folder.name,
        onSelect: () => ws.movePage(pageId, folder.id),
      })),
  ];

  if (!targets.length) return null;
  return { icon: FolderInput, label: 'Move to', items: targets };
}
