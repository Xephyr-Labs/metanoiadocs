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
          'group/row flex h-[27px] cursor-pointer items-center rounded-md pr-1 text-[14px] transition-colors duration-120',
          selected ? 'bg-selected text-ink' : 'text-muted hover:bg-hover',
        )}
        style={{ paddingLeft: 8 + depth * 16 }}
      >
        {/* chevron / spacer */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (hasChildren) ws.toggleExpand(id);
          }}
          className={cn(
            'flex h-5 w-5 shrink-0 items-center justify-center rounded text-faint',
            hasChildren ? 'hover:bg-line-strong/60' : 'pointer-events-none',
            hasChildren && (hover || selected) ? 'opacity-100' : 'opacity-0',
          )}
          aria-label={page.expanded ? 'Collapse' : 'Expand'}
          tabIndex={-1}
        >
          <ChevronRight
            size={14}
            className={cn('transition-transform duration-150', page.expanded && 'rotate-90')}
          />
        </button>

        <span className="mr-1.5 flex h-5 w-5 shrink-0 items-center justify-center text-faint">
          <DocIcon hasChildren={hasChildren} size={16} className="" />
        </span>
        <span className={cn('flex-1 truncate', selected && 'font-medium text-ink')}>
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
              ws.createPage(id);
            }}
            className="flex h-5 w-5 items-center justify-center rounded text-faint hover:bg-line-strong/60 hover:text-muted"
            aria-label="Add page inside"
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
