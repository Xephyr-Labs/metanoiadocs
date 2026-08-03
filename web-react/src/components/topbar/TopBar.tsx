import {
  ArrowUpRight,
  ChevronDown,
  ChevronRight,
  Cloud,
  Copy,
  Globe,
  Link2,
  Lock,
  MessageSquareText,
  Moon,
  MoreHorizontal,
  PanelLeft,
  PanelRight,
  Star,
  Sun,
  Trash2,
} from 'lucide-react';
import type { Page } from '../../lib/types';
import { relativeTime } from '../../lib/time';
import { useWorkspace } from '../../store/workspace';
import { cn } from '../../lib/cn';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { Button } from '../ui/Button';
import { DocIcon } from '../ui/DocIcon';
import { IconButton } from '../ui/IconButton';
import { Menu } from '../ui/Menu';

function ancestry(pages: Record<string, Page>, id: string): Page[] {
  const chain: Page[] = [];
  const seen = new Set<string>();
  let cur: Page | undefined = pages[id];
  // `seen` guards against a parent_id cycle (A→B→A) hanging the render.
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    chain.unshift(cur);
    cur = cur.parentId ? pages[cur.parentId] : undefined;
  }
  return chain;
}

export function TopBar() {
  const ws = useWorkspace();
  const page = ws.currentPage;
  const isMobile = useMediaQuery('(max-width: 767px)');

  return (
    <header className="sticky top-0 z-30 flex h-[45px] shrink-0 items-center gap-1 border-b border-line bg-canvas/80 px-2.5 backdrop-blur-md">
      {(isMobile || ws.sidebarCollapsed) && (
        <IconButton
          icon={<PanelLeft size={17} />}
          label="Open sidebar"
          keys={['⌘', '\\']}
          onClick={() => {
            // On mobile the sidebar is a drawer (mobileDrawerOpen); toggling
            // sidebarCollapsed there would strand the button after a page open.
            if (isMobile) ws.setMobileDrawer(true);
            else ws.setSidebarCollapsed(false);
          }}
        />
      )}

      <nav aria-label="Breadcrumb" className="flex min-w-0 flex-1 items-center gap-0.5 text-[14px]">
        {page ? (
          ancestry(ws.pages, page.id).map((p, i, arr) => {
            const last = i === arr.length - 1;
            return (
              <div key={p.id} className="flex min-w-0 items-center">
                <button
                  type="button"
                  onClick={() => ws.select(p.id)}
                  className={cn(
                    'flex min-w-0 items-center gap-1.5 rounded px-1.5 py-1 transition-colors duration-120 hover:bg-hover',
                    last ? 'text-ink' : 'text-muted',
                  )}
                >
                  <DocIcon hasChildren={p.children.length > 0} size={15} />
                  <span className={cn('truncate', last && 'font-medium')}>{p.title}</span>
                </button>
                {!last && <ChevronRight size={14} className="mx-0.5 shrink-0 text-faint" />}
              </div>
            );
          })
        ) : (
          <span className="px-1.5 text-muted">Metanoia</span>
        )}
      </nav>

      {page && (
        <div className="flex shrink-0 items-center gap-0.5">
          <span className="mr-1 hidden items-center gap-1 text-2xs text-faint md:flex">
            <Cloud size={13} /> Edited {relativeTime(page.updatedAt)}
          </span>
          {page.role === 'owner' ? (
            <Menu
              align="end"
              width={248}
              items={[
                { icon: Globe, label: 'Team · everyone in the workspace', onSelect: () => ws.setVisibility(page.id, 'team') },
                { icon: Lock, label: 'Private · only you', onSelect: () => ws.setVisibility(page.id, 'private') },
              ]}
              trigger={
                <button className="flex h-7 items-center gap-1.5 rounded-md px-2 text-[13px] font-medium text-muted transition-colors hover:bg-hover">
                  {page.visibility === 'private' ? <Lock size={14} /> : <Globe size={14} />}
                  <span className="hidden sm:inline">{page.visibility === 'private' ? 'Private' : 'Team'}</span>
                  <ChevronDown size={13} className="text-faint" />
                </button>
              }
            />
          ) : (
            <span className="flex h-7 items-center gap-1.5 px-2 text-[13px] text-faint" title="Visibility (owner controls this)">
              {page.visibility === 'private' ? <Lock size={14} /> : <Globe size={14} />}
              <span className="hidden sm:inline">{page.visibility === 'private' ? 'Private' : 'Team'}</span>
            </span>
          )}
          <Button variant="ghost" size="sm" onClick={() => ws.setShareOpen(true)} className="hidden sm:inline-flex">
            Share
          </Button>
          <IconButton
            icon={<MessageSquareText size={17} />}
            label="Comments"
            active={ws.rightPanel === 'comments'}
            onClick={() => ws.setRightPanel(ws.rightPanel === 'comments' ? null : 'comments')}
          />
          <IconButton
            icon={<Star size={17} className={cn(page.favorite && 'fill-amber-400 text-amber-400')} />}
            label={page.favorite ? 'Remove from Favorites' : 'Add to Favorites'}
            onClick={() => ws.toggleFavorite(page.id)}
          />
          <IconButton
            icon={ws.theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
            label={ws.theme === 'dark' ? 'Light mode' : 'Dark mode'}
            keys={['⌘', 'J']}
            onClick={ws.toggleTheme}
          />
          <IconButton
            icon={<PanelRight size={17} />}
            label="Side panel"
            active={!!ws.rightPanel}
            onClick={() => ws.setRightPanel(ws.rightPanel ? null : 'outline')}
          />
          <Menu
            align="end"
            items={[
              { icon: Link2, label: 'Copy link', onSelect: () => navigator.clipboard?.writeText(location.href) },
              { icon: Copy, label: 'Version history', onSelect: () => ws.setRightPanel('history') },
              { icon: ArrowUpRight, label: 'Open in new tab', onSelect: () => window.open(location.href, '_blank') },
              { icon: Trash2, label: 'Move to Trash', danger: true, separatorBefore: true, onSelect: () => ws.deletePage(page.id) },
            ]}
            trigger={<span><IconButton icon={<MoreHorizontal size={17} />} label="More" /></span>}
          />
        </div>
      )}
    </header>
  );
}
