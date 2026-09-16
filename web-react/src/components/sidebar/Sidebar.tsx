/* Hallmark · component: the workspace rail — an icon strip and the panel it
 *              switches · genre: modern-minimal
 * pre-emit critique: P5 H4 E4 S5 R4 V4
 * theme: project tokens (index.css)
 * states: default · hover · focus-visible · active (section showing) ·
 *         section folded · section capped ("N more") · empty section ·
 *         collapsed sidebar · mobile drawer · resizing
 * contrast: pass (40-41)
 * note: the rail narrows the sidebar, it does not gate it — `Everything` is
 *       first and is the default, so nobody's navigation moves on upgrade.
 */
import {
  Archive,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Files,
  Folder,
  Home,
  Link2,
  Inbox,
  KanbanSquare,
  LayoutList,
  LayoutTemplate,
  LogOut,
  MoreHorizontal,
  PanelLeftClose,
  Plus,
  Settings,
  Shapes,
  Star,
  Table2,
  Tag as TagIcon,
  Trash2,
  Upload,
} from 'lucide-react';
import { Children, useMemo, useRef, useState, type ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { SECTION_LIMIT, collapsedSections, railSection, setRailSection, toggleSection, type RailSection } from '../../lib/sidebarPrefs';
import { copyLink } from '../../lib/clipboard';
import { dbUrl } from '../../lib/route';
import { pickImportFiles } from '../../lib/docFiles';
import { avatarFor } from '../../lib/avatar';
import { nestByParent } from '../../lib/pageTree';
import { swatch } from '../../lib/tagColors';
import { toast } from '../../lib/toast';
import { LogoMark } from '../brand/Logo';
import { PageIcon } from '../ui/PageIcon';
import { tasksApi, type ProjectMode, type ProjectRow } from '../../lib/tasksApi';
import type { Tag } from '../../lib/types';
import { workspaces } from '../../data/mock';
import { templates } from '../../data/templates';
import { useAuth } from '../../store/auth';
import { useWorkspace } from '../../store/workspace';
import { IconButton } from '../ui/IconButton';
import { Menu } from '../ui/Menu';
import { RowInput } from '../ui/RowInput';
import { rowAction } from '../ui/styles';
import { PageTree } from './PageTree';
import { FolderTree } from './FolderTree';
import { DOC_MIME, dragSource } from './rowDrag';
import { useDocMenu } from '../../hooks/useDocMenu';

/**
 * Only `alert` spends the accent. "You are here" is a neutral fill — where you
 * are is already obvious from the page in front of you, and a rail that tints
 * the current row leaves the accent competing with itself the moment something
 * genuinely wants attention. `alert` is that something: accent lettering plus
 * its badge, and in a neutral rail it is the only coloured thing in the column.
 */
function NavItem({ icon, label, onClick, trailing, active, alert }: { icon: ReactNode; label: string; onClick?: () => void; trailing?: ReactNode; active?: boolean; alert?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group flex h-7 w-full items-center gap-2 rounded-md px-2 text-sm leading-5 transition-colors duration-120',
        active ? 'bg-selected font-medium text-ink' : alert ? 'font-medium text-accent-strong hover:bg-hover' : 'text-ink hover:bg-hover',
      )}
    >
      <span className={cn('flex h-5 w-5 shrink-0 items-center justify-center', alert ? 'text-accent-strong' : active ? 'text-ink' : 'text-muted group-hover:text-ink')}>{icon}</span>
      <span className="block h-5 min-w-0 flex-1 !self-center truncate leading-5 text-left">{label}</span>
      {trailing}
    </button>
  );
}

function SectionLabel({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mt-3 flex h-6 items-center justify-between px-2 first:mt-0">
      <span className="mn-side-label text-2xs font-semibold uppercase text-muted">{children}</span>
      {action}
    </div>
  );
}

/**
 * A section label that folds its body away, and remembers that you folded it.
 *
 * It used to hold `open` in component state seeded from a prop, so every reload
 * re-opened what you had just put away — the sidebar forgot the one thing you
 * had told it. The set now lives once, up in `Sidebar`, because the rail also
 * has to open a section: clicking Templates in the rail when Templates is
 * folded has to show you templates, and it cannot do that if each section
 * keeps a private copy of the answer.
 *
 * `count` and `action` exist so a folded section still says how much is inside
 * it and still offers its "+" — a fold that hides the count turns "collapse"
 * into "forget", and you stop folding things.
 */
function CollapsibleSection({ sectionKey, label, collapsed, onToggle, count, action, children }: {
  sectionKey: string;
  label: string;
  collapsed: Set<string>;
  onToggle: (key: string) => void;
  count?: number;
  action?: ReactNode;
  children: ReactNode;
}) {
  const open = !collapsed.has(sectionKey);

  return (
    <>
      <div className="mt-3 flex h-6 items-center gap-1 pr-2 first:mt-0">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => onToggle(sectionKey)}
          className="mn-side-label group flex h-6 min-w-0 flex-1 items-center gap-1 px-2 text-2xs font-semibold uppercase text-muted hover:text-ink"
        >
          <ChevronRight size={12} className={cn('shrink-0 transition-transform duration-180', open && 'rotate-90')} />
          <span className="truncate">{label}</span>
          {/* Only while folded: an expanded section is already showing them. */}
          {!open && count ? <span className="ml-1 shrink-0 tabular-nums text-faint">{count}</span> : null}
        </button>
        {action}
      </div>
      {open && <div className="mt-0.5">{children}</div>}
    </>
  );
}

/**
 * A list that shows the first few and offers the rest behind a click.
 *
 * Not a scrollbar: a list that scrolls inside a sidebar that also scrolls is two
 * scrollbars answering the same gesture, and neither one tells you how much you
 * have not seen. A count does.
 */
function Capped({ limit = SECTION_LIMIT, children }: { limit?: number; children: ReactNode }) {
  const [all, setAll] = useState(false);
  const items = Children.toArray(children);
  if (items.length <= limit) return <>{items}</>;
  return (
    <>
      {all ? items : items.slice(0, limit)}
      <button
        type="button"
        onClick={() => setAll((v) => !v)}
        className="flex h-6 w-full items-center gap-1 rounded-md px-2 text-2xs text-faint
                   transition-colors duration-120 hover:bg-hover hover:text-muted"
      >
        {all ? 'Show fewer' : `${items.length - limit} more`}
      </button>
    </>
  );
}

/**
 * A database in the tree. Kept as a recursive component (not a flat map) so
 * a database can nest under another; the naming input for "new sub-database
 * under this row" lives one level down, alongside its siblings, and its
 * placement is driven by `namingParent` — see `Sidebar`'s comment.
 *
 * Which id belongs under which parent is decided once, up in `Sidebar`, by
 * `nestByParent` — the same helper the page and folder trees use. That's what
 * keeps a project whose parent got archived (or a parent_id that loops back
 * on itself) visible at the top level instead of vanishing or hanging the
 * recursion; re-filtering `ws.projects` by `parent_id` at each level here
 * would lose both guarantees.
 */
function ProjectRows({
  parentId,
  depth,
  roots,
  childrenOf,
  namingParent,
  onNewUnder,
  onArchive,
  onSetMode,
  onCommitName,
  onCancelName,
}: {
  parentId: string | null;
  depth: number;
  roots: string[];
  childrenOf: Map<string, string[]>;
  namingParent: string | null | undefined;
  onNewUnder: (parentId: string, mode: ProjectMode) => void;
  onArchive: (project: ProjectRow) => void;
  onSetMode: (project: ProjectRow, mode: ProjectMode) => void;
  onCommitName: (name: string) => void;
  onCancelName: () => void;
}) {
  const ws = useWorkspace();
  const ids = parentId === null ? roots : (childrenOf.get(parentId) ?? []);
  const kids = ids.map((id) => ws.projects.find((p) => p.id === id)).filter((p): p is ProjectRow => !!p);
  const naming = namingParent === parentId;
  if (!kids.length && !naming) return null;
  return (
    <>
      {kids.map((p) => {
        const open = Number(p.total) - Number(p.done);
        return (
          <div key={p.id}>
            <div className="group flex items-center">
              <button
                type="button"
                onClick={() => ws.openProject(p.id)}
                style={{ paddingLeft: 8 + depth * 16 }}
                className={cn(
                  'flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-md pr-2 text-sm leading-5 transition-colors duration-120',
                  ws.view === 'project' && ws.activeProjectId === p.id ? 'bg-selected font-medium text-ink' : 'text-ink hover:bg-hover',
                )}
              >
                <span className="text-md leading-none">{p.icon}</span>
                <span className="block h-5 min-w-0 flex-1 !self-center truncate leading-5 text-left">{p.name}</span>
                {Number(p.overdue) > 0 ? (
                  <span className="shrink-0 text-2xs font-semibold text-danger-strong">{p.overdue}</span>
                ) : open > 0 ? (
                  // muted, not faint: this count is information. Faint is for
                  // affordances — hover chevrons and the like.
                  <span className="shrink-0 text-2xs text-muted">{open}</span>
                ) : null}
              </button>
              <button
                type="button"
                aria-label={`New database under ${p.name}`}
                onClick={() => onNewUnder(p.id, 'tasks')}
                className={cn(rowAction, 'opacity-0 group-hover:opacity-100')}
              >
                <Plus size={14} />
              </button>
              <Menu
                trigger={
                  <button
                    type="button"
                    aria-label={`Actions for ${p.name}`}
                    className={cn(rowAction, 'opacity-0 group-hover:opacity-100')}
                  >
                    <MoreHorizontal size={16} />
                  </button>
                }
                items={[
                  // A database has an address now, so it links and opens like a
                  // page does — see lib/route's dbUrl.
                  {
                    icon: ExternalLink,
                    label: 'Open in a new tab',
                    onSelect: () => { window.open(dbUrl(p.id), '_blank', 'noopener,noreferrer'); },
                  },
                  { icon: Link2, label: 'Copy link', onSelect: () => { copyLink(dbUrl(p.id)); } },
                  { icon: KanbanSquare, label: 'New database inside', separatorBefore: true, onSelect: () => onNewUnder(p.id, 'tasks') },
                  { icon: Table2, label: 'New data database inside', onSelect: () => onNewUnder(p.id, 'data') },
                  {
                    icon: p.mode === 'data' ? KanbanSquare : Table2,
                    label: p.mode === 'data' ? 'Turn into a task database' : 'Turn into a data database',
                    separatorBefore: true,
                    onSelect: () => onSetMode(p, p.mode === 'data' ? 'tasks' : 'data'),
                  },
                  {
                    icon: Archive,
                    label: 'Archive database',
                    danger: true,
                    separatorBefore: true,
                    onSelect: () => onArchive(p),
                  },
                ]}
              />
            </div>
            <ProjectRows
              parentId={p.id}
              depth={depth + 1}
              roots={roots}
              childrenOf={childrenOf}
              namingParent={namingParent}
              onNewUnder={onNewUnder}
              onArchive={onArchive}
              onSetMode={onSetMode}
              onCommitName={onCommitName}
              onCancelName={onCancelName}
            />
          </div>
        );
      })}
      {naming && (
        <RowInput
          icon={<span className="text-md leading-none">📋</span>}
          placeholder="Database name…"
          label="New database name"
          depth={depth}
          onCommit={onCommitName}
          onCancel={onCancelName}
        />
      )}
    </>
  );
}

/** A row in Recent, Pinned, Favorites, Designs or Public links. Draggable onto
 *  a folder like a tree row, and carrying the same menu the tree does — these
 *  are the pages reached most often, and they used to be the ones you could do
 *  least with. */
function DocRow({ id }: { id: string }) {
  const ws = useWorkspace();
  const p = ws.pages[id];
  const menu = useDocMenu(id);
  if (!p) return null;
  return (
    <div className="group/row relative flex items-center">
      <button
        type="button"
        onClick={() => ws.select(id)}
        {...dragSource(DOC_MIME, id)}
        className={cn('flex h-7 w-full items-center gap-1.5 rounded-md px-2 pr-7 text-sm leading-5 transition-colors duration-120', ws.currentId === id ? 'bg-selected font-medium text-ink' : 'text-ink hover:bg-hover')}
      >
        <PageIcon icon={p.icon} size={16} />
        <span className="block h-5 min-w-0 flex-1 !self-center truncate leading-5 text-left">{p.title}</span>
        {p.favorite && <Star size={14} className="shrink-0 fill-current text-amber-400" />}
      </button>
      <span className="absolute right-1 opacity-0 transition-opacity duration-120 focus-within:opacity-100 group-hover/row:opacity-100">
        <Menu
          align="end"
          items={menu}
          trigger={<button type="button" onClick={(e) => e.stopPropagation()} className={rowAction} aria-label={`Actions for ${p.title}`}><MoreHorizontal size={14} /></button>}
        />
      </span>
    </div>
  );
}

/**
 * A tag in the rail.
 *
 * The menu exists for one row: a tag could be taken off a page but never
 * removed from the workspace, so one made by a typo stayed in the sidebar and
 * in every picker for good. Deleting is admin-only server-side, so the refusal
 * is reported rather than swallowed — a row that appears to do nothing is
 * worse than one that says why.
 */
function TagRow({ tag }: { tag: Tag }) {
  const ws = useWorkspace();
  return (
    <div className="group/row relative flex items-center">
      <button
        type="button"
        onClick={() => ws.setTagFilter([tag.id])}
        className="flex h-7 w-full items-center gap-2 rounded-md px-2 pr-7 text-sm leading-5 text-ink transition-colors duration-120 hover:bg-hover"
      >
        <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', swatch(tag.color).dot)} />
        <span className="block h-5 min-w-0 flex-1 !self-center truncate leading-5 text-left">{tag.name}</span>
        {tag.count ? <span className="text-2xs text-faint">{tag.count}</span> : null}
      </button>
      <span className="absolute right-1 opacity-0 transition-opacity duration-120 focus-within:opacity-100 group-hover/row:opacity-100">
        <Menu
          align="end"
          trigger={<button type="button" className={rowAction} aria-label={`Actions for ${tag.name}`}><MoreHorizontal size={14} /></button>}
          items={[
            { icon: TagIcon, label: 'Show pages', onSelect: () => ws.setTagFilter([tag.id]) },
            {
              icon: Trash2,
              label: 'Delete tag',
              danger: true,
              separatorBefore: true,
              onSelect: () => {
                // Count first: "on 14 pages" is the only thing that makes this
                // a decision rather than a reflex, and the tag is gone from all
                // of them at once.
                const where = tag.count ? ` It is on ${tag.count} page${tag.count === 1 ? '' : 's'}.` : '';
                if (!window.confirm(`Delete the tag "${tag.name}"?${where}`)) return;
                ws.deleteTag(tag.id).then((err) => {
                  toast(err ?? `Deleted the tag ${tag.name}.`);
                });
              },
            },
          ]}
        />
      </span>
    </div>
  );
}

function FavoriteFolderRow({ id }: { id: string }) {
  const ws = useWorkspace();
  const f = ws.folders[id];
  if (!f) return null;
  return (
    <button
      type="button"
      onClick={() => ws.openFolder(id)}
      className={cn(
        'flex h-7 w-full items-center gap-1.5 rounded-md px-2 text-sm leading-5 transition-colors duration-120',
        ws.view === 'folder' && ws.activeFolderId === id ? 'bg-selected font-medium text-ink' : 'text-ink hover:bg-hover',
      )}
    >
      <Folder size={16} className="shrink-0" />
      <span className="block h-5 min-w-0 flex-1 !self-center truncate leading-5 text-left">{f.name}</span>
      <Star size={14} className="shrink-0 fill-current text-amber-400" />
    </button>
  );
}

/**
 * The icon rail.
 *
 * The sidebar's problem is not that it holds too much, it is that it holds all
 * of it at once: a real workspace stacks Recent, Pinned, Favorites, Projects,
 * Designs, Folders, Private, Public, Shared, Tags and Templates down one
 * column, and by the fourth section you are scrolling to navigate the thing
 * that exists so you do not have to navigate. The rail turns that stack into a
 * choice — one group in the panel, the rest one click away.
 *
 * `Everything` stays first and stays the default: the rail is a way to narrow
 * the sidebar, not a wall put in front of it, and nobody's navigation should
 * move under them on upgrade.
 *
 * Six fixed destinations, so there is no overflow menu and no compact mode —
 * VS Code needs both because extensions add icons to its rail; nothing here
 * adds one. Icon-only, but every button is tooltip-labelled and carries its
 * name to a screen reader, which is what `IconButton` was already doing for
 * the top bar.
 */
const RAIL: { key: RailSection; icon: ReactNode; label: string }[] = [
  { key: 'all', icon: <LayoutList size={16} />, label: 'Everything' },
  { key: 'docs', icon: <Files size={16} />, label: 'Documents' },
  { key: 'projects', icon: <KanbanSquare size={16} />, label: 'Projects' },
  { key: 'designs', icon: <Shapes size={16} />, label: 'Designs' },
  { key: 'tags', icon: <TagIcon size={16} />, label: 'Tags' },
  { key: 'templates', icon: <LayoutTemplate size={16} />, label: 'Templates' },
];

function Rail({ section, onPick }: { section: RailSection; onPick: (s: RailSection) => void }) {
  return (
    // The rail's first icon lines up with the panel's first nav row: the header
    // height plus that row's own top padding. Both read --mn-head-h, so neither
    // drifts when the header does.
    <div className="flex w-11 shrink-0 flex-col items-center gap-0.5 border-r border-line pt-[calc(var(--mn-head-h)+0.5rem)]">
      {RAIL.map((r) => (
        <IconButton
          key={r.key}
          icon={r.icon}
          label={r.label}
          side="right"
          active={section === r.key}
          onClick={() => onPick(r.key)}
        />
      ))}
    </div>
  );
}

export function Sidebar() {
  const ws = useWorkspace();
  const auth = useAuth();
  const activeWs = workspaces[0];
  const av = avatarFor(auth.user?.name || auth.user?.username || 'You');
  const dragging = useRef(false);
  const [, force] = useState(0);

  // Which rail section is showing, and which sections are folded. Both live
  // here rather than in the sections themselves because picking a rail section
  // has to be able to unfold it — see `pickSection`.
  const [section, setSection] = useState<RailSection>(railSection);
  const [collapsed, setCollapsed] = useState<Set<string>>(collapsedSections);
  /** `all` shows every group, which is what the sidebar has always done. */
  const shows = (s: RailSection) => section === 'all' || section === s;
  const pickSection = (s: RailSection) => {
    setSection(s);
    setRailSection(s);
    // Clicking Templates in the rail and landing on a folded Templates header
    // would read as a broken button. Asking for a section opens it.
    if (s !== 'all' && collapsed.has(s)) setCollapsed(toggleSection(s));
  };
  const toggle = (key: string) => setCollapsed(toggleSection(key));

  // The name is typed in the tree itself. `namingParent` is which row shows
  // that input: undefined = none, null = new top-level database, a string =
  // new sub-database of that project id. One value keeps a single input on
  // screen whether it was opened from the section header or a row's +.
  // Errors surface inside the input, so nothing is caught here.
  const [namingParent, setNamingParent] = useState<string | null | undefined>(undefined);
  // Which kind of database the open naming input will make. A data database
  // holds records — no status, no assignee, no dates — so the choice is made
  // when it is created rather than discovered later.
  const [namingMode, setNamingMode] = useState<ProjectMode>('tasks');
  const startNaming = (parentId: string | null, mode: ProjectMode) => {
    setNamingMode(mode);
    setNamingParent(parentId);
  };
  const createProject = async (name: string) => {
    const p = await tasksApi.createProject({ name, parentId: namingParent ?? null, mode: namingMode });
    await ws.refreshProjects();
    setNamingParent(undefined);
    ws.openProject(p.id);
  };

  /** Switching mode hides fields, it never drops them: the task columns keep
   *  their values underneath, so this is reversible from the same menu. */
  const setProjectMode = async (project: ProjectRow, mode: ProjectMode) => {
    try {
      await tasksApi.patchProject(project.id, { mode });
    } catch {
      toast(`Could not change ${project.name}.`);
      return;
    }
    await ws.refreshProjects();
    toast(mode === 'data'
      ? `${project.name} is a data database. Its task fields are hidden, not deleted.`
      : `${project.name} is a task database again.`);
  };

  /** Archiving hides a database and its rows without destroying either, so the
   *  toast offers the way back rather than a confirmation before the fact. */
  const archiveProject = async (project: ProjectRow) => {
    try {
      await tasksApi.archiveProject(project.id);
    } catch {
      toast(`Could not archive ${project.name}.`);
      return;
    }
    if (ws.activeProjectId === project.id) ws.openHome();
    await ws.refreshProjects();
    toast(`Archived ${project.name}.`, {
      label: 'Undo',
      onSelect: () => {
        tasksApi
          .patchProject(project.id, { archived: false })
          .then(() => ws.refreshProjects())
          .catch(() => toast(`Could not restore ${project.name}.`));
      },
    });
  };

  // Computed once for the whole tree: a project whose parent was archived (or
  // whose parent_id loops) comes back as a root here instead of disappearing.
  const projectTree = useMemo(
    () => nestByParent(ws.projects.map((p) => ({ id: p.id, parentId: p.parent_id }))),
    [ws.projects],
  );

  const onResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    const startX = e.clientX;
    const startW = ws.sidebarWidth;
    const onMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      // +44 for the rail, so the panel beside it still ranges 220–420.
      ws.setSidebarWidth(Math.min(464, Math.max(264, startW + ev.clientX - startX)));
      force((n) => n + 1);
    };
    const onUp = () => {
      dragging.current = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  return (
    <aside className="mn-side relative flex h-full shrink-0 bg-canvas" style={{ width: ws.sidebarWidth, maxWidth: '100%' }}>
      <Rail section={section} onPick={pickSection} />
      <div className="flex min-w-0 flex-1 flex-col">
      {/* workspace switcher, and the way to put the rail away. The « shows on
          hover like Notion's — the row is the first thing the eye lands on, so
          a control that lived here permanently would be the loudest thing in
          the rail. Always visible where there is no hover (touch). */}
      <div className="group/head flex h-[var(--mn-head-h)] shrink-0 items-center gap-1 px-2">
        <Menu
          width={248}
          items={[
            { label: `${activeWs.icon}  ${activeWs.name}` },
            {
              icon: Upload,
              label: 'Import…',
              separatorBefore: true,
              // No folder: an import from here lands beside the other unfiled
              // documents, and the per-folder menu is where you say otherwise.
              onSelect: () => { pickImportFiles().then((f) => { if (f.length) ws.importFiles(f, null); }); },
            },
            { icon: Settings, label: 'Settings', separatorBefore: true, onSelect: () => ws.setSettingsOpen(true) },
            { icon: LogOut, label: 'Log out', danger: true, onSelect: () => auth.logout() },
          ]}
          trigger={
            <button className="group flex h-7 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left leading-5 transition-colors duration-120 hover:bg-hover">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center">
                <LogoMark size={16} />
              </span>
              <span className="block h-5 min-w-0 flex-1 !self-center truncate text-sm font-semibold leading-5 text-ink">{activeWs.name}</span>
              <ChevronDown size={16} className="shrink-0 text-faint opacity-0 transition-opacity group-hover:opacity-100" />
            </button>
          }
        />
        <IconButton
          icon={<PanelLeftClose size={16} />}
          label="Close sidebar"
          keys={['⌘', '\\']}
          onClick={() => ws.setSidebarCollapsed(true)}
          className="mn-hover-reveal opacity-0 transition-opacity duration-120 group-hover/head:opacity-100"
        />
      </div>

      {/* primary nav — Search lives on the top bar now, where it acts on the
          whole workspace; this tree is a list of places to go. */}
      <div className="px-2 pt-2">
        <NavItem icon={<Home size={16} />} label="Home" active={ws.view === 'home'} onClick={ws.openHome} />
        <NavItem
          icon={<Inbox size={16} />}
          label="Inbox"
          alert={ws.unreadCount > 0}
          onClick={() => ws.setInboxOpen(true)}
          // accent-strong, not accent: white on #2383e2 is 4.0:1, and this is
          // 11px lettering inside a 16px pill.
          trailing={ws.unreadCount > 0 ? (
            <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-accent-strong px-1 text-3xs font-semibold text-white">
              {ws.unreadCount > 99 ? '99+' : ws.unreadCount}
            </span>
          ) : undefined}
        />
        <NavItem icon={<CheckSquare size={16} />} label="Tasks" active={ws.view === 'tasks'} onClick={ws.openTasks} />
        {/* The tree below only draws a page once it has been filed somewhere,
            so the ones easiest to lose are the ones it never shows. */}
        <NavItem icon={<Files size={16} />} label="All documents" active={ws.view === 'docs'} onClick={ws.openAllDocs} />
        <NavItem icon={<Settings size={16} />} label="Settings" onClick={() => ws.setSettingsOpen(true)} />
      </div>

      {/* scroll region */}
      <div className="scrollarea mt-4 flex-1 overflow-y-auto px-2 pb-2">
        {shows('docs') && ws.recentIds.length > 0 && (
          <section className="mb-5">
            <CollapsibleSection collapsed={collapsed} onToggle={toggle} sectionKey="recent" label="Recent" count={ws.recentIds.length}>
              <div className="space-y-px">
                <Capped limit={5}>{ws.recentIds.map((id) => <DocRow key={id} id={id} />)}</Capped>
              </div>
            </CollapsibleSection>
          </section>
        )}

        {/* Above Favorites on purpose: the team's shelf outranks your own. */}
        {shows('docs') && (ws.pinnedFolderIds.length > 0 || ws.pinnedIds.length > 0) && (
          <section className="mb-5">
            <CollapsibleSection collapsed={collapsed} onToggle={toggle} sectionKey="pinned" label="Pinned" count={ws.pinnedFolderIds.length + ws.pinnedIds.length}>
            <div className="space-y-px">
              <Capped>
                {[...ws.pinnedFolderIds.map((id) => <FavoriteFolderRow key={`f${id}`} id={id} />),
                  ...ws.pinnedIds.map((id) => <DocRow key={id} id={id} />)]}
              </Capped>
            </div>
            </CollapsibleSection>
          </section>
        )}

        {shows('docs') && (ws.favoriteFolderIds.length > 0 || ws.favoriteIds.length > 0) && (
          <section className="mb-5">
            <CollapsibleSection collapsed={collapsed} onToggle={toggle} sectionKey="favorites" label="Favorites" count={ws.favoriteFolderIds.length + ws.favoriteIds.length}>
            <div className="space-y-px">
              <Capped>
                {[...ws.favoriteFolderIds.map((id) => <FavoriteFolderRow key={`f${id}`} id={id} />),
                  ...ws.favoriteIds.map((id) => <DocRow key={id} id={id} />)]}
              </Capped>
            </div>
            </CollapsibleSection>
          </section>
        )}

        {shows('projects') && (
        <section className="mb-5">
          <SectionLabel
            action={
              <Menu
                align="end"
                trigger={
                  <button type="button" className={rowAction} aria-label="New database">
                    <Plus size={14} />
                  </button>
                }
                items={[
                  { icon: KanbanSquare, label: 'New database', onSelect: () => startNaming(null, 'tasks') },
                  { icon: Table2, label: 'New data database', onSelect: () => startNaming(null, 'data') },
                ]}
              />
            }
          >
            Projects
          </SectionLabel>
          {ws.projects.length || namingParent !== undefined ? (
            <div className="space-y-px">
              <ProjectRows
                parentId={null}
                depth={0}
                roots={projectTree.roots}
                childrenOf={projectTree.childrenOf}
                namingParent={namingParent}
                onNewUnder={startNaming}
                onArchive={archiveProject}
                onSetMode={setProjectMode}
                onCommitName={createProject}
                onCancelName={() => setNamingParent(undefined)}
              />
            </div>
          ) : (
            <button onClick={() => startNaming(null, 'tasks')} className="mt-0.5 flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-faint hover:bg-hover hover:text-muted">
              <Plus size={14} /> New project
            </button>
          )}
        </section>
        )}

        {/* Designs are documents that open on the canvas, so they also show up
            in folders and search — this section is the shortcut to them, not
            their only home. */}
        {shows('designs') && (
        <section className="mb-5">
          <SectionLabel
            action={
              <button type="button" onClick={() => { ws.createDesign(); }} className={rowAction} aria-label="New design">
                <Plus size={14} />
              </button>
            }
          >
            Designs
          </SectionLabel>
          {ws.designIds.length ? (
            <div className="space-y-px">{ws.designIds.map((id) => <DocRow key={id} id={id} />)}</div>
          ) : (
            <button onClick={() => { ws.createDesign(); }} className="mt-0.5 flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-faint hover:bg-hover hover:text-muted">
              <Plus size={14} /> New design
            </button>
          )}
        </section>
        )}

        {shows('docs') && (
        <section className="mb-5">
            <SectionLabel
            action={
              <button type="button" onClick={() => ws.createFolder(null)} className={rowAction} aria-label="New folder">
                <Plus size={14} />
              </button>
            }
          >
            Folders
          </SectionLabel>
          {ws.folderRootIds.length || ws.unfiledIds.length ? (
            <FolderTree roots={ws.folderRootIds} unfiled={ws.unfiledIds} />
          ) : (
            <button onClick={() => ws.createFolder(null)} className="mt-0.5 flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-faint hover:bg-hover hover:text-muted">
              <Plus size={14} /> New folder
            </button>
          )}
        </section>
        )}

        {shows('docs') && ws.privateRootIds.length > 0 && (
          <section className="mb-5">
            <CollapsibleSection collapsed={collapsed} onToggle={toggle} sectionKey="private" label="Private" count={ws.privateRootIds.length}>
              <PageTree roots={ws.privateRootIds} />
            </CollapsibleSection>
          </section>
        )}

        {shows('docs') && ws.sharedRootIds.length > 0 && (
          <section className="mb-5">
            <CollapsibleSection collapsed={collapsed} onToggle={toggle} sectionKey="public" label="Public links" count={ws.sharedRootIds.length}>
              <div className="space-y-px">
                <Capped>{ws.sharedRootIds.map((id) => <DocRow key={id} id={id} />)}</Capped>
              </div>
            </CollapsibleSection>
          </section>
        )}

        {shows('docs') && ws.libraryRootIds.length > 0 && (
          <section className="mb-5">
            <CollapsibleSection collapsed={collapsed} onToggle={toggle} sectionKey="shared" label="Shared with me" count={ws.libraryRootIds.length}>
              <PageTree roots={ws.libraryRootIds} />
            </CollapsibleSection>
          </section>
        )}

        {shows('tags') && ws.allTags.length > 0 && (
          <section className="mb-5">
            <CollapsibleSection collapsed={collapsed} onToggle={toggle} sectionKey="tags" label="Tags" count={ws.allTags.length}>
              <div className="space-y-px">
                {/* Tags grow one per label anyone invents — the list most
                    likely to run past a screen on a real workspace. */}
                <Capped limit={10}>{ws.allTags.map((t) => <TagRow key={t.id} tag={t} />)}</Capped>
              </div>
            </CollapsibleSection>
          </section>
        )}

        {shows('templates') && (
        <section className="mb-1 mt-2">
          <CollapsibleSection collapsed={collapsed} onToggle={toggle} sectionKey="templates" label="Templates" count={templates.length}>
          <div className="space-y-px">
            {templates.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => ws.createFromTemplate(t)}
                className="flex h-7 w-full items-center gap-1.5 rounded-md px-2 text-sm leading-5 text-ink transition-colors duration-120 hover:bg-hover"
              >
                <span className="text-md leading-none">{t.icon}</span>
                <span className="block h-5 min-w-0 flex-1 !self-center truncate leading-5 text-left">{t.name}</span>
                <Plus size={14} className="shrink-0 text-faint" />
              </button>
            ))}
          </div>
          </CollapsibleSection>
        </section>
        )}
      </div>

      {/* footer */}
      <div className="border-t border-line px-2 py-2">
        <div className="mb-1.5">
          <NavItem icon={<Trash2 size={16} />} label="Trash" onClick={() => ws.setTrashOpen(true)} />
        </div>
        <div className="flex items-center gap-2 rounded-md px-1.5 py-1">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-3xs font-semibold text-white" style={{ background: av.color }}>{av.initials}</span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-ink">{auth.user?.name ?? 'User'}</p>
            <p className="truncate text-2xs text-faint">{auth.user?.role === 'admin' ? 'Admin' : `@${auth.user?.username ?? 'you'}`}</p>
          </div>
          <button type="button" onClick={() => auth.logout()} className="flex h-6 w-6 items-center justify-center rounded text-faint hover:bg-hover hover:text-danger-strong" aria-label="Log out">
            <LogOut size={16} />
          </button>
        </div>
      </div>
      </div>

      <div onMouseDown={onResizeStart} className="group absolute right-0 top-0 h-full w-1 cursor-col-resize" role="separator" aria-label="Resize sidebar">
        <div className="absolute right-0 top-0 h-full w-px bg-line transition-colors group-hover:w-0.5 group-hover:bg-accent" />
      </div>
    </aside>
  );
}
