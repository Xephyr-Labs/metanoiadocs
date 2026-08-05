import { AnimatePresence, motion } from 'framer-motion';
import { ChevronRight, Copy, FileText, Link2, MoreHorizontal, Plus, Star, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { cn } from '../../lib/cn';
import type { PageId } from '../../lib/types';
import { useWorkspace } from '../../store/workspace';
import { DocIcon } from '../ui/DocIcon';
import { Menu } from '../ui/Menu';

function Row({ id, depth }: { id: PageId; depth: number }) {
  const ws = useWorkspace();
  const page = ws.pages[id];
  const [hover, setHover] = useState(false);
  if (!page) return null;
  const selected = ws.currentId === id;
  const hasChildren = page.children.length > 0;
  const fav = ws.favoriteIds.includes(id);

  return (
    <>
      <div
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
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
          'group/row flex h-8 cursor-pointer items-center rounded-md pr-1 text-[14px] leading-5 transition-colors duration-120',
          selected ? 'bg-accent-soft text-accent' : 'text-ink hover:bg-hover',
        )}
        style={{ paddingLeft: 8 + depth * 16 }}
      >
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
                'absolute inset-0 flex items-center justify-center rounded text-faint transition-opacity hover:bg-line-strong/60',
                hover || selected ? 'opacity-100' : 'opacity-0',
              )}
              aria-label={page.expanded ? 'Collapse' : 'Expand'}
              tabIndex={-1}
            >
              <ChevronRight
                size={14}
                className={cn('transition-transform duration-150', page.expanded && 'rotate-90')}
              />
            </button>
          )}
        </span>
        <span className={cn('flex h-5 flex-1 !self-center items-center truncate', selected && 'font-medium text-accent')}>
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
                className="flex h-5 w-5 items-center justify-center rounded text-faint hover:bg-line-strong/60 hover:text-muted"
                aria-label="Page actions"
              >
                <MoreHorizontal size={15} />
              </button>
            }
            items={[
              { icon: Star, label: fav ? 'Remove from Favorites' : 'Add to Favorites', onSelect: () => ws.toggleFavorite(id) },
              { icon: Link2, label: 'Copy link' },
              { icon: Copy, label: 'Duplicate' },
              { icon: FileText, label: 'Rename', onSelect: () => ws.select(id) },
              { icon: Trash2, label: 'Delete', danger: true, separatorBefore: true, onSelect: () => ws.deletePage(id) },
            ]}
          />
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              ws.createPage(null);
            }}
            className="flex h-5 w-5 items-center justify-center rounded text-faint hover:bg-line-strong/60 hover:text-muted"
            aria-label="New page"
          >
            <Plus size={15} />
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
