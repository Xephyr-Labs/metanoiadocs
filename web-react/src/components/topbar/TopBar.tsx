import {
  ArrowUpRight,
  ChevronDown,
  Cloud,
  Download,
  FileText,
  FileType,
  FolderOpen,
  Globe,
  History,
  Link2,
  Lock,
  MessageSquareText,
  Moon,
  MoreHorizontal,
  PanelLeft,
  PanelRight,
  Pin,
  Printer,
  Search,
  Share2,
  Sparkles,
  Star,
  Sun,
  Trash2,
} from 'lucide-react';
import type { Page } from '../../lib/types';
import { avatarFor } from '../../lib/avatar';
import { usePresence } from '../../editor/presence';
import { relativeTime } from '../../lib/time';
import { useWorkspace } from '../../store/workspace';
import { cn } from '../../lib/cn';
import { useOpenCommentCount } from '../../editor/comments';
import { downloadDocx, downloadMarkdown, printDoc } from '../../lib/docFiles';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { Button } from '../ui/Button';
import { PageIcon } from '../ui/PageIcon';
import { IconButton } from '../ui/IconButton';
import { Menu } from '../ui/Menu';
import { useMoveToFolder } from '../../hooks/useMoveToFolder';
import { copyLink } from '../../lib/clipboard';

/** Google-Docs-style stack of everyone else currently in the open doc. */
function PresenceStack() {
  const people = usePresence();
  // One avatar per person, even when they have the doc open in several tabs.
  const unique = [...new Map(people.map((p) => [p.name, p])).values()];
  if (unique.length === 0) return null;
  const shown = unique.slice(0, 3);
  const extra = unique.length - shown.length;
  return (
    <div className="mr-0.5 flex items-center -space-x-1.5" aria-label={`Also here: ${unique.map((p) => p.name).join(', ')}`}>
      {shown.map((p) => (
        <span
          key={p.name}
          title={p.name}
          className="flex h-[22px] w-[22px] items-center justify-center rounded-full text-3xs font-semibold text-white ring-2 ring-canvas"
          style={{ background: p.color }}
        >
          {avatarFor(p.name).initials}
        </span>
      ))}
      {extra > 0 && (
        <span
          title={unique.slice(3).map((p) => p.name).join(', ')}
          className="flex h-[22px] w-[22px] items-center justify-center rounded-full bg-surface text-3xs font-semibold text-muted ring-2 ring-canvas"
        >
          +{extra}
        </span>
      )}
    </div>
  );
}


/**
 * One step of the path in the bar, with the separator that precedes it.
 *
 * A slash rather than a chevron, and the same 12px for every step: the bar
 * says *where you are*, and the page under it is already saying *what this
 * is* in display type. The bar used to repeat that title — two headings, one
 * of them redundant.
 */
function Crumb({
  children, icon, current, onClick,
}: {
  children: React.ReactNode;
  icon?: React.ReactNode;
  current?: boolean;
  onClick?: () => void;
}) {
  const body = (
    <>
      {icon}
      <span className="truncate">{children}</span>
    </>
  );
  return (
    <span className="flex min-w-0 items-center">
      <span aria-hidden className="mx-0.5 shrink-0 select-none text-faint">/</span>
      {onClick && !current ? (
        <button
          type="button"
          onClick={onClick}
          className="flex min-w-0 items-center gap-1.5 rounded px-1.5 py-1 text-muted transition-colors duration-120 hover:bg-hover hover:text-ink"
        >
          {body}
        </button>
      ) : (
        <span
          aria-current={current ? 'page' : undefined}
          className={cn(
            'flex min-w-0 items-center gap-1.5 px-1.5 py-1',
            current ? 'font-medium text-ink' : 'text-muted',
          )}
        >
          {body}
        </span>
      )}
    </span>
  );
}

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
  const openComments = useOpenCommentCount();
  // Home and project views keep currentPage around for "continue where you left
  // off", but the doc breadcrumb and doc actions must not follow them there.
  const page = ws.view === 'doc' ? ws.currentPage : null;
  const project = ws.view === 'project' ? ws.projects.find((p) => p.id === ws.activeProjectId) : null;
  const folder = ws.view === 'folder' && ws.activeFolderId ? ws.folders[ws.activeFolderId] : null;
  const isMobile = useMediaQuery('(max-width: 767px)');
  const moveTo = useMoveToFolder(page?.id);

  return (
    <header className="sticky top-0 z-30 flex h-11 shrink-0 items-center gap-1 border-b border-line bg-canvas px-2.5">
      {(isMobile || ws.sidebarCollapsed) && (
        <IconButton
          icon={<PanelLeft size={16} />}
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

      <nav aria-label="Breadcrumb" className="mn-crumbs flex min-w-0 flex-1 items-center text-xs">
        {/* The workspace is the root of every path, and the way home. */}
        <Crumb onClick={ws.openHome}>Metanoia</Crumb>
        {page ? (
          ancestry(ws.pages, page.id).map((p, i, arr) => (
            <Crumb
              key={p.id}
              icon={<PageIcon icon={p.icon} size={14} />}
              current={i === arr.length - 1}
              onClick={() => ws.select(p.id)}
            >
              {p.title || 'Untitled'}
            </Crumb>
          ))
        ) : project ? (
          <Crumb icon={<span className="text-sm leading-none">{project.icon}</span>} current>
            {project.name}
          </Crumb>
        ) : folder ? (
          // The folder's own page carries its full path; the bar just says
          // which folder you are in, the way it says which page.
          <Crumb icon={<FolderOpen size={14} className="text-faint" />} current>
            {folder.name}
          </Crumb>
        ) : ws.view === 'home' ? (
          <Crumb current>Home</Crumb>
        ) : null}
      </nav>

      {/* Search belongs on the bar, not in the sidebar tree: it is an action on
          the whole workspace, and the tree is a list of places. */}
      <button
        type="button"
        onClick={() => ws.setPaletteOpen(true)}
        aria-label="Search"
        aria-keyshortcuts="Meta+K"
        className={cn(
          'group mr-1 flex h-7 shrink-0 items-center gap-1.5 rounded-lg border border-line bg-surface text-2xs text-muted',
          'transition-colors duration-120 ease-out hover:border-line-strong hover:text-ink',
          'w-7 justify-center px-0 sm:w-[188px] sm:justify-start sm:px-2',
        )}
      >
        <Search size={14} className="shrink-0 text-faint" />
        <span className="hidden flex-1 text-left sm:inline">Search</span>
        <kbd className="hidden shrink-0 font-sans text-3xs tracking-wide text-faint sm:inline">⌘K</kbd>
      </button>

      {/* Non-doc views keep a small global cluster: Ask AI + theme. Without it
          the top-right is empty on Home (the sign-in landing view). */}
      {!page && (
        <div className="flex shrink-0 items-center gap-0.5 border-l border-line pl-1.5">
          <IconButton
            icon={<Sparkles size={16} />}
            label="Ask AI"
            active={ws.rightPanel === 'ai'}
            onClick={() => ws.setRightPanel(ws.rightPanel === 'ai' ? null : 'ai')}
          />
          <IconButton
            icon={ws.theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
            label={ws.theme === 'dark' ? 'Light mode' : 'Dark mode'}
            keys={['⌘', 'J']}
            onClick={ws.toggleTheme}
          />
        </div>
      )}

      {page && (
        <div className="flex shrink-0 items-center gap-0.5 border-l border-line pl-1.5">
          <span className="mr-1 hidden items-center gap-1 text-2xs text-faint md:flex">
            <Cloud size={14} /> Edited {relativeTime(page.updatedAt)}
          </span>
          <PresenceStack />
          {page.role === 'owner' ? (
            <Menu
              align="end"
              width={248}
              items={[
                { icon: Globe, label: 'Team · everyone in the workspace', onSelect: () => ws.setVisibility(page.id, 'team') },
                { icon: Lock, label: 'Private · only you', onSelect: () => ws.setVisibility(page.id, 'private') },
              ]}
              trigger={
                <button className="flex h-7 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-muted transition-colors hover:bg-hover">
                  {page.visibility === 'private' ? <Lock size={14} /> : <Globe size={14} />}
                  <span>{page.visibility === 'private' ? 'Private' : 'Team'}</span>
                  <ChevronDown size={14} className="text-faint" />
                </button>
              }
            />
          ) : (
            <span className="flex h-7 items-center gap-1.5 px-2 text-sm text-faint" title="Visibility (owner controls this)">
              {page.visibility === 'private' ? <Lock size={14} /> : <Globe size={14} />}
              <span className="hidden sm:inline">{page.visibility === 'private' ? 'Private' : 'Team'}</span>
            </span>
          )}
          <Button variant="ghost" size="sm" onClick={() => ws.setShareOpen(true)} className="hidden sm:inline-flex">
            Share
          </Button>
          <IconButton
            icon={<Sparkles size={16} />}
            label="Ask AI"
            active={ws.rightPanel === 'ai'}
            onClick={() => ws.setRightPanel(ws.rightPanel === 'ai' ? null : 'ai')}
          />
          {/* The count is the whole point: without it, an open thread is
              invisible until someone thinks to look in the panel. */}
          <span className="relative inline-flex">
            <IconButton
              icon={<MessageSquareText size={16} />}
              label={openComments ? `Comments (${openComments} open)` : 'Comments'}
              active={ws.rightPanel === 'comments'}
              onClick={() => ws.setRightPanel(ws.rightPanel === 'comments' ? null : 'comments')}
            />
            {openComments > 0 && (
              <span className="pointer-events-none absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-accent px-1 text-3xs font-semibold tabular-nums text-white ring-2 ring-canvas">
                {openComments}
              </span>
            )}
          </span>
          <IconButton
            className="hidden sm:inline-flex"
            icon={<Star size={16} className={cn(page.favorite && 'fill-amber-400 text-amber-400')} />}
            label={page.favorite ? 'Remove from Favorites' : 'Add to Favorites'}
            onClick={() => ws.toggleFavorite(page.id)}
          />
          <IconButton
            className="hidden sm:inline-flex"
            icon={ws.theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
            label={ws.theme === 'dark' ? 'Light mode' : 'Dark mode'}
            keys={['⌘', 'J']}
            onClick={ws.toggleTheme}
          />
          <IconButton
            className="hidden sm:inline-flex"
            icon={<PanelRight size={16} />}
            label="Side panel"
            active={!!ws.rightPanel}
            onClick={() => ws.setRightPanel(ws.rightPanel ? null : 'outline')}
          />
          <Menu
            align="end"
            items={[
              // On phones the toolbar icons collapse in here so the bar isn't crammed.
              ...(isMobile ? [
                { icon: Share2, label: 'Share', onSelect: () => ws.setShareOpen(true) },
                { icon: Star, label: page.favorite ? 'Remove from Favorites' : 'Add to Favorites', onSelect: () => ws.toggleFavorite(page.id) },
                { icon: ws.theme === 'dark' ? Sun : Moon, label: ws.theme === 'dark' ? 'Light mode' : 'Dark mode', onSelect: ws.toggleTheme },
                { icon: PanelRight, label: 'Outline & details', onSelect: () => ws.setRightPanel(ws.rightPanel ? null : 'outline') },
              ] : []),
              // Favorites are per person; a pin puts it on the team's shelf.
              { icon: Pin, label: page.pinned ? 'Unpin for everyone' : 'Pin for everyone', separatorBefore: isMobile, onSelect: () => ws.togglePin(page.id) },
              { icon: Link2, label: 'Copy link', onSelect: () => { copyLink(location.href); } },
              { icon: History, label: 'Version history', onSelect: () => ws.openHistory(page.id) },
              { icon: ArrowUpRight, label: 'Open in new tab', onSelect: () => window.open(location.href, '_blank') },
              // One row instead of three: the formats belong together and this
              // menu already carries everything else a page can do.
              // A design is a canvas: docx, markdown and the print stylesheet all
              // render its (empty) page mode, so the export that means anything
              // lives on the canvas bar instead.
              ...(page.kind === 'design' ? [] : [{
                icon: Download,
                label: 'Export',
                separatorBefore: true,
                items: [
                  { icon: FileType, label: 'Word (.docx)', onSelect: () => downloadDocx(page.id) },
                  { icon: FileText, label: 'Markdown (.md)', onSelect: () => downloadMarkdown(page.id) },
                  { icon: Printer, label: 'PDF', onSelect: () => printDoc(page.id) },
                ],
              }]),
              ...(moveTo ? [{ ...moveTo, separatorBefore: true }] : []),
              { icon: Trash2, label: 'Move to Trash', danger: true, separatorBefore: true, onSelect: () => ws.deletePage(page.id) },
            ]}
            trigger={<span><IconButton icon={<MoreHorizontal size={16} />} label="More" /></span>}
          />
        </div>
      )}
    </header>
  );
}
