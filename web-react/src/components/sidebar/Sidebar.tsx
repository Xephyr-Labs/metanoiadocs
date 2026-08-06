import {
  ChevronDown,
  ChevronRight,
  ChevronsLeftRight,
  Home,
  Inbox,
  LogOut,
  Plus,
  Search,
  Settings,
  Star,
  Trash2,
} from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { avatarFor } from '../../lib/avatar';
import { swatch } from '../../lib/tagColors';
import { LogoMark } from '../brand/Logo';
import { PageIcon } from '../ui/PageIcon';
import { tasksApi } from '../../lib/tasksApi';
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
      <span className="flex h-5 flex-1 !self-center items-center truncate text-left">{label}</span>
      {trailing}
    </button>
  );
}

function SectionLabel({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex h-7 items-center justify-between px-2">
      <span className="text-2xs font-semibold uppercase tracking-wide text-faint">{children}</span>
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
        className="group flex h-7 w-full items-center gap-1 px-2 text-2xs font-semibold uppercase tracking-wide text-faint hover:text-muted"
      >
        <ChevronRight size={12} className={cn('transition-transform duration-180', open && 'rotate-90')} />
        {label}
      </button>
      {open && <div className="mt-0.5">{children}</div>}
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
      <span className="flex h-5 flex-1 !self-center items-center truncate text-left">{p.title}</span>
      {p.favorite && <Star size={14} className="shrink-0 fill-current text-amber-400" />}
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

  // The name is typed in the tree itself; `naming` is just whether that row is
  // showing. Errors surface inside it, so nothing is caught here.
  const [naming, setNaming] = useState(false);
  const createProject = async (name: string) => {
    const p = await tasksApi.createProject({ name });
    await ws.refreshProjects();
    setNaming(false);
    ws.openProject(p.id);
  };

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
    <aside className="relative flex h-full shrink-0 flex-col bg-canvas" style={{ width: ws.sidebarWidth }}>
      {/* workspace switcher */}
      <div className="flex h-[45px] shrink-0 items-center px-2">
        <Menu
          width={248}
          items={[
            { label: `${activeWs.icon}  ${activeWs.name}` },
            { icon: Settings, label: 'Settings', separatorBefore: true, onSelect: () => ws.setSettingsOpen(true) },
            { icon: LogOut, label: 'Log out', danger: true, onSelect: () => auth.logout() },
          ]}
          trigger={
            <button className="group flex h-8 w-full items-center gap-2 rounded-md px-2 text-left leading-5 transition-colors duration-120 hover:bg-hover">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center">
                <LogoMark size={16} />
              </span>
              <span className="flex h-5 flex-1 !self-center items-center truncate text-base font-semibold text-ink">{activeWs.name}</span>
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

        {ws.favoriteIds.length > 0 && (
          <section className="mb-5">
            <SectionLabel>Favorites</SectionLabel>
            <div className="space-y-px">{ws.favoriteIds.map((id) => <DocRow key={id} id={id} />)}</div>
          </section>
        )}

        <section className="mb-5">
          <SectionLabel
            action={
              <button type="button" onClick={() => setNaming(true)} className={rowAction} aria-label="New project">
                <Plus size={14} />
              </button>
            }
          >
            Projects
          </SectionLabel>
          {naming && (
            <RowInput
              icon={<span className="text-md leading-none">📋</span>}
              placeholder="Project name…"
              label="New project name"
              onCommit={createProject}
              onCancel={() => setNaming(false)}
            />
          )}
          {ws.projects.length ? (
            <div className="space-y-px">
              {ws.projects.map((p) => {
                const open = Number(p.total) - Number(p.done);
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => ws.openProject(p.id)}
                    className={cn(
                      'flex h-8 w-full items-center gap-1.5 rounded-md px-2 text-base leading-5 transition-colors duration-120',
                      ws.view === 'project' && ws.activeProjectId === p.id ? 'bg-accent-soft text-accent' : 'text-ink hover:bg-hover',
                    )}
                  >
                    <span className="text-md leading-none">{p.icon}</span>
                    <span className="flex h-5 flex-1 !self-center items-center truncate text-left">{p.name}</span>
                    {Number(p.overdue) > 0 ? (
                      <span className="shrink-0 text-2xs font-semibold text-danger">{p.overdue}</span>
                    ) : open > 0 ? (
                      <span className="shrink-0 text-2xs text-faint">{open}</span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          ) : naming ? null : (
            <button onClick={() => setNaming(true)} className="mt-0.5 flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-faint hover:bg-hover hover:text-muted">
              <Plus size={14} /> New project
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
                  <span className="flex h-5 flex-1 !self-center items-center truncate text-left">{t.name}</span>
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
                <span className="flex h-5 flex-1 !self-center items-center truncate text-left">{t.name}</span>
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
