import { AnimatePresence, motion } from 'framer-motion';
import { ChevronRight, MoreHorizontal, Plus } from 'lucide-react';
import { useState } from 'react';
import { cn } from '../../lib/cn';
import { useDocMenu } from '../../hooks/useDocMenu';
import { okToCross } from '../../hooks/useMoveToSpace';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { requestTitleFocus } from '../../lib/titleFocus';
import type { PageId } from '../../lib/types';
import { useWorkspace } from '../../store/workspace';
import { DocIcon } from '../ui/DocIcon';
import { Menu } from '../ui/Menu';
import { rowAction, rowActionsAtRest } from '../ui/styles';
import { DOC_MIME, dragSource, useRowDrop } from './rowDrag';
import { ShowMoreRow, useShowMore } from './showMore';

function Row({ id, depth }: { id: PageId; depth: number }) {
  const ws = useWorkspace();
  const page = ws.pages[id];
  const [hovered, setHover] = useState(false);
  // No pointer to hover with on a phone: chevrons and row actions stay shown.
  const hover = useMediaQuery('(hover: none)') || hovered;
  const menu = useDocMenu(id);
  // Same gesture as the folder tree: the outer quarters place this page above or
  // below its neighbour, the middle nests it under them.
  const drop = useRowDrop({
    accept: { [DOC_MIME]: 'thirds' },
    onDrop: async (_mime, draggedId, zone) => {
      if (draggedId === id) return;
      // Only nesting crosses spaces here: this tree mixes them (Private, Shared),
      // and a drop beside a top-level page keeps the dragged page's space.
      if (zone === 'inside' && !(await okToCross(ws.spaces, 'doc', draggedId, ws.pages[draggedId]?.spaceId, page?.spaceId))) return;
      if (zone === 'inside') ws.linkPage(id, draggedId);
      else ws.reorderPage(draggedId, id, zone);
    },
  });
  const kids = useShowMore(page?.children ?? [], ws.currentId);
  if (!page) return null;
  const selected = ws.currentId === id;
  const hasChildren = page.children.length > 0;

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
          'group/row relative flex h-7 coarse:h-11 cursor-pointer items-center rounded-md pr-1 text-sm leading-5 transition-colors duration-120',
          selected ? 'bg-selected font-medium text-ink' : 'text-ink hover:bg-hover',
          drop.zone === 'inside' && 'bg-accent-soft text-accent-strong',
        )}
        style={{ paddingLeft: 4 + depth * 16 }}
      >
        {(drop.zone === 'before' || drop.zone === 'after') && (
          <span
            className={cn('pointer-events-none absolute left-1 right-1 h-0.5 rounded-full bg-accent', drop.zone === 'before' ? 'top-0' : 'bottom-0')}
          />
        )}
        {/* The chevron has a slot of its own, left of the icon, so a page keeps
            its face while you point at it. Drawn whenever there is something
            to open, so a parent reads as one at rest, not only under a pointer. */}
        <span className="flex h-5 w-4 shrink-0 items-center justify-center">
          {hasChildren && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                ws.toggleExpand(id);
              }}
              className={cn(rowAction, 'w-4')}
              aria-label={page.expanded ? `Collapse ${page.title}` : `Expand ${page.title}`}
            >
              <ChevronRight
                size={12}
                className={cn('transition-transform duration-180', page.expanded && 'rotate-90')}
              />
            </button>
          )}
        </span>
        <span className={cn('mr-2 flex h-5 w-5 shrink-0 items-center justify-center', selected ? 'text-ink' : 'text-muted')}>
          <DocIcon hasChildren={hasChildren} size={16} className="" />
        </span>
        {/* Rename lives on the name, not the whole row: the chevron and the ⋯
            button are double-click targets too, and neither means "rename". */}
        <span
          onDoubleClick={() => { requestTitleFocus(id); ws.select(id); }}
          className={cn('block h-5 min-w-0 flex-1 !self-center truncate leading-5', selected && 'font-medium')}
        >
          {page.title}
        </span>

        {/* hover actions — out of the layout at rest, so the title runs to the
            row's end instead of stopping short of two invisible buttons. */}
        <span className={cn('shrink-0 items-center gap-0.5 coarse:gap-2', hover ? 'flex' : rowActionsAtRest)}>
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
            items={menu}
          />
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              ws.createChildPage(id);
            }}
            className={rowAction}
            aria-label={`Add a page inside ${page.title}`}
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
            {kids.shown.map((c) => (
              <Row key={c} id={c} depth={depth + 1} />
            ))}
            <ShowMoreRow rest={kids.rest} depth={depth + 1} onClick={kids.more} />
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

export function PageTree({ roots, depth = 0 }: { roots: PageId[]; depth?: number }) {
  const ws = useWorkspace();
  const top = useShowMore(roots, ws.currentId);
  return (
    <div role="tree" className="space-y-px">
      {top.shown.map((id) => (
        <Row key={id} id={id} depth={depth} />
      ))}
      <ShowMoreRow rest={top.rest} depth={depth} onClick={top.more} />
    </div>
  );
}
