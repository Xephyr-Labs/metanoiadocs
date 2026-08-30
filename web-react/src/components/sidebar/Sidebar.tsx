import {
  Archive,
  ChevronDown,
  ChevronRight,
  ChevronsLeftRight,
  Folder,
  Home,
  Inbox,
  KanbanSquare,
  LogOut,
  MoreHorizontal,
  Plus,
  Search,
  Settings,
  Star,
  Table2,
  Trash2,
  Upload,
} from 'lucide-react';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { pickImportFiles } from '../../lib/docFiles';
import { avatarFor } from '../../lib/avatar';
import { nestByParent } from '../../lib/pageTree';
import { swatch } from '../../lib/tagColors';
import { toast } from '../../lib/toast';
import { LogoMark } from '../brand/Logo';
import { PageIcon } from '../ui/PageIcon';
import { tasksApi, type ProjectMode, type ProjectRow } from '../../lib/tasksApi';
import { workspaces } from '../../data/mock';
import { templates } from '../../data/templates';
import { useAuth } from '../../store/auth';
import { useWorkspace } from '../../store/workspace';
import { Menu } from '../ui/Menu';
import { RowInput } from '../ui/RowInput';
import { rowAction } from '../ui/styles';
import { PageTree } from './PageTree';
import { FolderTree } from './FolderTree';

function NavItem({ icon, label, onClick, trailing, active }: { icon: ReactNode; label: string; onClick?: () => void; trailing?: ReactNode; active?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn('group flex h-8 w-full items-center gap-2 rounded-md px-2 text-base leading-5 transition-colors duration-120', active ? 'bg-accent-soft text-accent' : 'text-ink hover:bg-hover')}
    >
      <span className={cn('flex h-5 w-5 shrink-0 items-center justify-center', active ? 'text-accent' : 'text-faint group-hover:text-muted')}>{icon}</span>
      <span className="block h-5 min-w-0 flex-1 !self-center truncate leading-5 text-left">{label}</span>
      {trailing}
    </button>
  );
}

function SectionLabel({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex h-7 items-center justify-between px-2">
      <span className="mn-side-label text-2xs font-semibold uppercase text-muted">{children}</span>
      {action}
    </div>
  );
}

/** A section label that toggles its body — used to fold Templates away when the
 *  document tree is long, so the tree isn't buried under a wall of items. */
function CollapsibleSection({ label, defaultOpen, children }: { label: string; defaultOpen: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="mn-side-label group flex h-7 w-full items-center gap-1 px-2 text-2xs font-semibold uppercase text-muted hover:text-ink"
      >
        <ChevronRight size={12} className={cn('transition-transform duration-180', open && 'rotate-90')} />
        {label}
      </button>
      {open && <div className="mt-0.5">{children}</div>}
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
                  'flex h-8 min-w-0 flex-1 items-center gap-1.5 rounded-md pr-2 text-base leading-5 transition-colors duration-120',
                  ws.view === 'project' && ws.activeProjectId === p.id ? 'bg-accent-soft text-accent' : 'text-ink hover:bg-hover',
                )}
              >
                <span className="text-md leading-none">{p.icon}</span>
                <span className="block h-5 min-w-0 flex-1 !self-center truncate leading-5 text-left">{p.name}</span>
                {Number(p.overdue) > 0 ? (
                  <span className="shrink-0 text-2xs font-semibold text-danger">{p.overdue}</span>
                ) : open > 0 ? (
                  <span className="shrink-0 text-2xs text-faint">{open}</span>
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
                  { icon: KanbanSquare, label: 'New database inside', onSelect: () => onNewUnder(p.id, 'tasks') },
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

function DocRow({ id }: { id: string }) {
  const ws = useWorkspace();
  const p = ws.pages[id];
  if (!p) return null;
  return (
    <button
      type="button"
      onClick={() => ws.select(id)}
      className={cn('flex h-8 w-full items-center gap-1.5 rounded-md px-2 text-base leading-5 transition-colors duration-120', ws.currentId === id ? 'bg-accent-soft text-accent' : 'text-ink hover:bg-hover')}
    >
      <PageIcon icon={p.icon} size={16} />
      <span className="block h-5 min-w-0 flex-1 !self-center truncate leading-5 text-left">{p.title}</span>
      {p.favorite && <Star size={14} className="shrink-0 fill-current text-amber-400" />}
    </button>
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
        'flex h-8 w-full items-center gap-1.5 rounded-md px-2 text-base leading-5 transition-colors duration-120',
        ws.view === 'folder' && ws.activeFolderId === id ? 'bg-accent-soft text-accent' : 'text-ink hover:bg-hover',
      )}
    >
      <Folder size={16} className="shrink-0" />
      <span className="block h-5 min-w-0 flex-1 !self-center truncate leading-5 text-left">{f.name}</span>
      <Star size={14} className="shrink-0 fill-current text-amber-400" />
    </button>
  );
}

export function Sidebar() {
  const ws = useWorkspace();
  const auth = useAuth();
  const activeWs = workspaces[0];
  const av = avatarFor(auth.user?.name || auth.user?.username || 'You');
  const dragging = useRef(false);
  const [, force] = useState(0);

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
      ws.setSidebarWidth(Math.min(420, Math.max(220, startW + ev.clientX - startX)));
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
    <aside className="mn-side relative flex h-full shrink-0 flex-col bg-canvas" style={{ width: ws.sidebarWidth }}>
      {/* workspace switcher */}
      <div className="flex h-[45px] shrink-0 items-center px-2">
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
            <button className="group flex h-8 w-full items-center gap-2 rounded-md px-2 text-left leading-5 transition-colors duration-120 hover:bg-hover">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center">
                <LogoMark size={16} />
              </span>
              <span className="block h-5 min-w-0 flex-1 !self-center truncate leading-5 text-base font-semibold text-ink">{activeWs.name}</span>
              <ChevronDown size={16} className="shrink-0 text-faint opacity-0 transition-opacity group-hover:opacity-100" />
            </button>
          }
        />
      </div>

      {/* primary nav */}
      <div className="px-2 pt-2">
        <NavItem icon={<Search size={16} />} label="Search" onClick={() => ws.setPaletteOpen(true)} trailing={<span className="text-2xs text-faint">⌘K</span>} />
        <NavItem icon={<Home size={16} />} label="Home" active={ws.view === 'home'} onClick={ws.openHome} />
        <NavItem
          icon={<Inbox size={16} />}
          label="Inbox"
          onClick={() => ws.setInboxOpen(true)}
          trailing={ws.unreadCount > 0 ? (
            <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-3xs font-semibold text-white">
              {ws.unreadCount > 99 ? '99+' : ws.unreadCount}
            </span>
          ) : undefined}
        />
        <NavItem icon={<Settings size={16} />} label="Settings" onClick={() => ws.setSettingsOpen(true)} />
      </div>

      {/* scroll region */}
      <div className="scrollarea mt-4 flex-1 overflow-y-auto px-2 pb-2">
        {ws.recentIds.length > 0 && (
          <section className="mb-5">
            <SectionLabel>Recent</SectionLabel>
            <div className="space-y-px">{ws.recentIds.map((id) => <DocRow key={id} id={id} />)}</div>
          </section>
        )}

        {(ws.favoriteFolderIds.length > 0 || ws.favoriteIds.length > 0) && (
          <section className="mb-5">
            <SectionLabel>Favorites</SectionLabel>
            <div className="space-y-px">
              {ws.favoriteFolderIds.map((id) => <FavoriteFolderRow key={id} id={id} />)}
              {ws.favoriteIds.map((id) => <DocRow key={id} id={id} />)}
            </div>
          </section>
        )}

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

        {/* Designs are documents that open on the canvas, so they also show up
            in folders and search — this section is the shortcut to them, not
            their only home. */}
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

        {ws.privateRootIds.length > 0 && (
          <section className="mb-5">
            <SectionLabel>Private</SectionLabel>
            <PageTree roots={ws.privateRootIds} />
          </section>
        )}

        {ws.sharedRootIds.length > 0 && (
          <section className="mb-5">
            <SectionLabel>Public links</SectionLabel>
            <div className="space-y-px">{ws.sharedRootIds.map((id) => <DocRow key={id} id={id} />)}</div>
          </section>
        )}

        {ws.libraryRootIds.length > 0 && (
          <section className="mb-5">
            <SectionLabel>Shared with me</SectionLabel>
            <PageTree roots={ws.libraryRootIds} />
          </section>
        )}

        {ws.allTags.length > 0 && (
          <section className="mb-5">
            <SectionLabel>Tags</SectionLabel>
            <div className="space-y-px">
              {ws.allTags.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => ws.setTagFilter(t.id)}
                  className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-base leading-5 text-ink transition-colors duration-120 hover:bg-hover"
                >
                  <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', swatch(t.color).dot)} />
                  <span className="block h-5 min-w-0 flex-1 !self-center truncate leading-5 text-left">{t.name}</span>
                  {t.count ? <span className="text-2xs text-faint">{t.count}</span> : null}
                </button>
              ))}
            </div>
          </section>
        )}

        <section className="mb-1 mt-2">
          <CollapsibleSection label="Templates" defaultOpen={ws.workspaceRootIds.length <= 8}>
          <div className="space-y-px">
            {templates.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => ws.createFromTemplate(t)}
                className="flex h-8 w-full items-center gap-1.5 rounded-md px-2 text-base leading-5 text-ink transition-colors duration-120 hover:bg-hover"
              >
                <span className="text-md leading-none">{t.icon}</span>
                <span className="block h-5 min-w-0 flex-1 !self-center truncate leading-5 text-left">{t.name}</span>
                <Plus size={14} className="shrink-0 text-faint" />
              </button>
            ))}
          </div>
          </CollapsibleSection>
        </section>
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
          <button type="button" onClick={() => auth.logout()} className="flex h-6 w-6 items-center justify-center rounded text-faint hover:bg-hover hover:text-danger" aria-label="Log out">
            <LogOut size={16} />
          </button>
          <button type="button" onClick={() => ws.setSidebarCollapsed(true)} className="flex h-6 w-6 items-center justify-center rounded text-faint hover:bg-hover hover:text-muted" aria-label="Collapse sidebar">
            <ChevronsLeftRight size={16} />
          </button>
        </div>
      </div>

      <div onMouseDown={onResizeStart} className="group absolute right-0 top-0 h-full w-1 cursor-col-resize" role="separator" aria-label="Resize sidebar">
        <div className="absolute right-0 top-0 h-full w-px bg-line transition-colors group-hover:w-0.5 group-hover:bg-accent" />
      </div>
    </aside>
  );
}
