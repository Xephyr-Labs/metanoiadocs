import { AnimatePresence, motion } from 'framer-motion';
import { ChevronRight, Copy, Download, FileText, FileType, Link2, MoreHorizontal, Plus, Printer, Star, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { cn } from '../../lib/cn';
import { downloadDocx, downloadMarkdown, printDoc } from '../../lib/docFiles';
import { docUrl } from '../../lib/route';
import type { PageId } from '../../lib/types';
import { useWorkspace } from '../../store/workspace';
import { DocIcon } from '../ui/DocIcon';
import { Menu } from '../ui/Menu';
import { rowAction } from '../ui/styles';
import { DOC_MIME, dragSource, useRowDrop } from './rowDrag';
import { copyLink } from '../../lib/clipboard';

function Row({ id, depth }: { id: PageId; depth: number }) {
  const ws = useWorkspace();
  const page = ws.pages[id];
  const [hover, setHover] = useState(false);
  // Same gesture as the folder tree: the outer quarters place this page above or
  // below its neighbour, the middle nests it under them.
  const drop = useRowDrop({
    accept: { [DOC_MIME]: 'thirds' },
    onDrop: (_mime, draggedId, zone) => {
      if (draggedId === id) return;
      if (zone === 'inside') ws.linkPage(id, draggedId);
      else ws.reorderPage(draggedId, id, zone);
    },
  });
  if (!page) return null;
  const selected = ws.currentId === id;
  const hasChildren = page.children.length > 0;
  const fav = ws.favoriteIds.includes(id);

  return (
    <>
      <div
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        {...dragSource(DOC_MIME, id)}
        {...drop.props}
        onClick={() => ws.select(id)}
        role="treeitem"
        aria-selected={selected}
        aria-expanded={hasChildren ? !!page.expanded : undefined}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter') ws.select(id);
          if (e.key === 'ArrowRight' && hasChildren && !page.expanded) ws.toggleExpand(id);
          if (e.key === 'ArrowLeft' && hasChildren && page.expanded) ws.toggleExpand(id);
        }}
        className={cn(
          'group/row relative flex h-8 cursor-pointer items-center rounded-md pr-1 text-base leading-5 transition-colors duration-120',
          selected ? 'bg-accent-soft text-accent' : 'text-ink hover:bg-hover',
          drop.zone === 'inside' && 'bg-accent-soft text-accent',
        )}
        style={{ paddingLeft: 8 + depth * 16 }}
      >
        {(drop.zone === 'before' || drop.zone === 'after') && (
          <span
            className={cn('pointer-events-none absolute left-1 right-1 h-0.5 rounded-full bg-accent', drop.zone === 'before' ? 'top-0' : 'bottom-0')}
          />
        )}
        {/* One icon slot shared by the doc icon and the expand chevron — the
            chevron overlays the icon on hover/select. Keeps every top-level row's
            icon in the SAME column as the nav + Recent icons above, instead of a
            reserved chevron slot pushing the whole tree ~20px to the right. */}
        <span className="relative mr-1.5 flex h-5 w-5 shrink-0 items-center justify-center">
          <span
            className={cn(
              'flex items-center justify-center transition-opacity',
              selected ? 'text-accent' : 'text-faint',
              hasChildren && (hover || selected) && 'opacity-0',
            )}
          >
            <DocIcon hasChildren={hasChildren} size={16} className="" />
          </span>
          {hasChildren && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                ws.toggleExpand(id);
              }}
              className={cn(
                'absolute inset-0 flex items-center justify-center rounded text-faint transition-opacity hover:bg-hover',
                hover || selected ? 'opacity-100' : 'opacity-0',
              )}
              aria-label={page.expanded ? 'Collapse' : 'Expand'}
              tabIndex={-1}
            >
              <ChevronRight
                size={14}
                className={cn('transition-transform duration-180', page.expanded && 'rotate-90')}
              />
            </button>
          )}
        </span>
        <span className={cn('block h-5 min-w-0 flex-1 !self-center truncate leading-5', selected && 'font-medium text-accent')}>
          {page.title}
        </span>

        {/* hover actions */}
        <span
          className={cn(
            'flex shrink-0 items-center gap-0.5 transition-opacity',
            hover ? 'opacity-100' : 'opacity-0',
          )}
        >
          <Menu
            trigger={
              <button
                type="button"
                onClick={(e) => e.stopPropagation()}
                className={rowAction}
                aria-label="Page actions"
              >
                <MoreHorizontal size={16} />
              </button>
            }
            items={[
              { icon: Star, label: fav ? 'Remove from Favorites' : 'Add to Favorites', onSelect: () => ws.toggleFavorite(id) },
              { icon: Link2, label: 'Copy link', onSelect: () => { copyLink(docUrl(id)); } },
              { icon: Copy, label: 'Duplicate' },
              { icon: FileText, label: 'Rename', onSelect: () => ws.select(id) },
              {
                icon: Download,
                label: 'Export',
                items: [
                  { icon: FileType, label: 'Word (.docx)', onSelect: () => downloadDocx(id) },
                  { icon: FileText, label: 'Markdown (.md)', onSelect: () => downloadMarkdown(id) },
                  { icon: Printer, label: 'PDF', onSelect: () => printDoc(id) },
                ],
              },
              { icon: Trash2, label: 'Delete', danger: true, separatorBefore: true, onSelect: () => ws.deletePage(id) },
            ]}
          />
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              ws.createPage(null);
            }}
            className={rowAction}
            aria-label="New page"
          >
            <Plus size={16} />
          </button>
        </span>
      </div>

      <AnimatePresence initial={false}>
        {hasChildren && page.expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            {page.children.map((c) => (
              <Row key={c} id={c} depth={depth + 1} />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

export function PageTree({ roots, depth = 0 }: { roots: PageId[]; depth?: number }) {
  return (
    <div role="tree" className="space-y-px">
      {roots.map((id) => (
        <Row key={id} id={id} depth={depth} />
      ))}
    </div>
  );
}
