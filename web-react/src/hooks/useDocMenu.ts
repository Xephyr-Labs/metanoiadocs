import { Download, ExternalLink, FileText, FileType, Link2, Printer, Star, Trash2 } from 'lucide-react';
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
export function useDocMenu(id: PageId, { onRename }: { onRename?: () => void } = {}): MenuItem[] {
  const ws = useWorkspace();
  const moveTo = useMoveToFolder(id);
  // A card on Home can name a document the page store has not cached. Every
  // action here addresses the document by id, so they all still work; the
  // favourite toggle simply reads as "add", which is the safe way round.
  const fav = ws.favoriteIds.includes(id);

  const rename = onRename ?? (() => { requestTitleFocus(id); ws.select(id); });

  return [
    {
      icon: ExternalLink,
      label: 'Open in a new tab',
      onSelect: () => { window.open(docUrl(id), '_blank', 'noopener,noreferrer'); },
    },
    { icon: Link2, label: 'Copy link', onSelect: () => { copyLink(docUrl(id)); } },
    {
      icon: Star,
      label: fav ? 'Remove from Favorites' : 'Add to Favorites',
      separatorBefore: true,
      onSelect: () => ws.toggleFavorite(id),
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
