import { Download, ExternalLink, FileText, FileType, Link2, Pin, Printer, Star, Trash2 } from 'lucide-react';
import type { MenuItem } from '../components/ui/Menu';
import { copyLink } from '../lib/clipboard';
import { downloadDocx, downloadMarkdown, printDoc } from '../lib/docFiles';
import { docUrl } from '../lib/route';
import { requestTitleFocus } from '../lib/titleFocus';
import type { PageId } from '../lib/types';
import { useWorkspace } from '../store/workspace';
import { useMoveToFolder } from './useMoveToFolder';

/**
 * The actions a document carries, wherever its row is drawn.
 *
 * There were four different menus. The sidebar tree had favourites, a link,
 * rename, export and delete (and a "Duplicate" row wired to nothing at all);
 * Recent, Favorites, Designs and the home cards had "Move to" and otherwise
 * nothing — so the pages you reach most often were the ones you could do least
 * with, and "open this in another tab" existed nowhere. One list now, and a new
 * action appears everywhere at once.
 *
 * `onOpenNewTab` is a plain link, not a router call: a second tab is the whole
 * point, and `/d/<id>` is a real address the app restores on load.
 */
export function useDocMenu(
  id: PageId,
  {
    onRename,
    extra,
  }: {
    onRename?: () => void;
    /** Rows that only make sense where this menu is being drawn — "Add a page
     *  inside" belongs to the tree, not to a card on Home. They sit after the
     *  navigation rows so the shared ones keep the same order everywhere. */
    extra?: MenuItem[];
  } = {},
): MenuItem[] {
  const ws = useWorkspace();
  const moveTo = useMoveToFolder(id);
  // A card on Home can name a document the page store has not cached. Every
  // action here addresses the document by id, so they all still work; the
  // favourite and pin toggles simply read as "add", which is the safe way round.
  const page = ws.pages[id] ?? null;
  const fav = ws.favoriteIds.includes(id);

  const rename = onRename ?? (() => { requestTitleFocus(id); ws.select(id); });

  return [
    {
      icon: ExternalLink,
      label: 'Open in a new tab',
      onSelect: () => { window.open(docUrl(id), '_blank', 'noopener,noreferrer'); },
    },
    { icon: Link2, label: 'Copy link', onSelect: () => { copyLink(docUrl(id)); } },
    ...(extra ?? []),
    {
      icon: Star,
      label: fav ? 'Remove from Favorites' : 'Add to Favorites',
      separatorBefore: true,
      onSelect: () => ws.toggleFavorite(id),
    },
    // Favorites are yours; a pin is the whole team's. It lived only in the
    // folder tree, which meant the one place a page is pinned from was the one
    // place you had already found it.
    {
      icon: Pin,
      label: page?.pinned ? 'Unpin for everyone' : 'Pin for everyone',
      onSelect: () => ws.togglePin(id),
    },
    { icon: FileText, label: 'Rename', onSelect: rename },
    ...(moveTo ? [moveTo] : []),
    {
      icon: Download,
      label: 'Export',
      items: [
        { icon: FileType, label: 'Word (.docx)', onSelect: () => downloadDocx(id) },
        { icon: FileText, label: 'Markdown (.md)', onSelect: () => downloadMarkdown(id) },
        { icon: Printer, label: 'PDF', onSelect: () => printDoc(id) },
      ],
    },
    {
      icon: Trash2,
      label: 'Delete',
      danger: true,
      separatorBefore: true,
      onSelect: () => ws.deletePage(id),
    },
  ];
}
