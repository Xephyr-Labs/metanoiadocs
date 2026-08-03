import {
  ChevronDown,
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
import { DocIcon } from '../ui/DocIcon';
import { workspaces } from '../../data/mock';
import { templates } from '../../data/templates';
import { useAuth } from '../../store/auth';
import { useWorkspace } from '../../store/workspace';
import { Menu } from '../ui/Menu';
import { PageTree } from './PageTree';

function NavItem({ icon, label, onClick, trailing, active }: { icon: ReactNode; label: string; onClick?: () => void; trailing?: ReactNode; active?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn('group flex h-[29px] w-full items-center gap-2 rounded-md px-2 text-[14px] transition-colors duration-120', active ? 'bg-selected text-ink' : 'text-muted hover:bg-hover')}
    >
      <span className="flex h-5 w-5 shrink-0 items-center justify-center text-faint group-hover:text-muted">{icon}</span>
      <span className="flex-1 truncate text-left">{label}</span>
      {trailing}
    </button>
  );
}

function SectionLabel({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex h-6 items-center justify-between px-2">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-faint">{children}</span>
      {action}
    </div>
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
      className={cn('flex h-[27px] w-full items-center gap-1.5 rounded-md px-2 text-[14px] transition-colors duration-120', ws.currentId === id ? 'bg-selected text-ink' : 'text-muted hover:bg-hover')}
    >
      <DocIcon hasChildren={p.children.length > 0} size={16} />
      <span className="flex-1 truncate text-left">{p.title}</span>
      {p.favorite && <Star size={13} className="shrink-0 fill-current text-amber-400" />}
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
    <aside className="relative flex h-full shrink-0 flex-col bg-surface-2" style={{ width: ws.sidebarWidth }}>
      {/* workspace switcher */}
      <div className="px-2 pt-2.5">
        <Menu
          width={248}
          items={[
            { label: `${activeWs.icon}  ${activeWs.name}` },
            { icon: Settings, label: 'Settings', separatorBefore: true, onSelect: () => ws.setSettingsOpen(true) },
            { icon: LogOut, label: 'Log out', danger: true, onSelect: () => auth.logout() },
          ]}
          trigger={
            <button className="group flex h-9 w-full items-center gap-2 rounded-md px-2 text-left transition-colors duration-120 hover:bg-hover">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center">
                <LogoMark size={20} />
              </span>
              <span className="flex-1 truncate text-[14px] font-semibold text-ink">{activeWs.name}</span>
              <ChevronDown size={15} className="shrink-0 text-faint opacity-0 transition-opacity group-hover:opacity-100" />
            </button>
          }
        />
      </div>

      {/* primary nav */}
      <div className="px-2 pt-1.5">
        <NavItem icon={<Search size={16} />} label="Search" onClick={() => ws.setPaletteOpen(true)} trailing={<span className="text-2xs text-faint">⌘K</span>} />
        <NavItem icon={<Home size={16} />} label="Home" onClick={() => ws.rootIds[0] && ws.select(ws.rootIds[0])} />
        <NavItem
          icon={<Inbox size={16} />}
          label="Inbox"
          onClick={() => ws.setInboxOpen(true)}
          trailing={ws.unreadCount > 0 ? (
            <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold text-white">
              {ws.unreadCount > 99 ? '99+' : ws.unreadCount}
            </span>
          ) : undefined}
        />
        <NavItem icon={<Settings size={16} />} label="Settings" onClick={() => ws.setSettingsOpen(true)} />
      </div>

      {/* scroll region */}
      <div className="scrollarea mt-3 flex-1 overflow-y-auto px-2 pb-2">
        {ws.recentIds.length > 0 && (
          <section className="mb-3">
            <SectionLabel>Recent</SectionLabel>
            <div className="space-y-px">{ws.recentIds.map((id) => <DocRow key={id} id={id} />)}</div>
          </section>
        )}

        {ws.favoriteIds.length > 0 && (
          <section className="mb-3">
            <SectionLabel>Favorites</SectionLabel>
            <div className="space-y-px">{ws.favoriteIds.map((id) => <DocRow key={id} id={id} />)}</div>
          </section>
        )}

        <section className="mb-3">
          <SectionLabel
            action={
              <button type="button" onClick={() => ws.createPage(null)} className="flex h-5 w-5 items-center justify-center rounded text-faint hover:bg-hover hover:text-muted" aria-label="New page">
                <Plus size={14} />
              </button>
            }
          >
            Workspace
          </SectionLabel>
          {ws.workspaceRootIds.length ? (
            <PageTree roots={ws.workspaceRootIds} />
          ) : (
            <button onClick={() => ws.createPage(null)} className="mt-0.5 flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-[13px] text-faint hover:bg-hover hover:text-muted">
              <Plus size={14} /> New page
            </button>
          )}
        </section>

        {ws.privateRootIds.length > 0 && (
          <section className="mb-3">
            <SectionLabel>Private</SectionLabel>
            <PageTree roots={ws.privateRootIds} />
          </section>
        )}

        {ws.sharedRootIds.length > 0 && (
          <section className="mb-3">
            <SectionLabel>Public links</SectionLabel>
            <div className="space-y-px">{ws.sharedRootIds.map((id) => <DocRow key={id} id={id} />)}</div>
          </section>
        )}

        {ws.libraryRootIds.length > 0 && (
          <section className="mb-3">
            <SectionLabel>Shared with me</SectionLabel>
            <PageTree roots={ws.libraryRootIds} />
          </section>
        )}

        {ws.allTags.length > 0 && (
          <section className="mb-3">
            <SectionLabel>Tags</SectionLabel>
            <div className="space-y-px">
              {ws.allTags.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => ws.setTagFilter(t.id)}
                  className="flex h-[27px] w-full items-center gap-2 rounded-md px-2 text-[14px] text-muted transition-colors duration-120 hover:bg-hover"
                >
                  <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', swatch(t.color).dot)} />
                  <span className="flex-1 truncate text-left">{t.name}</span>
                  {t.count ? <span className="text-2xs text-faint">{t.count}</span> : null}
                </button>
              ))}
            </div>
          </section>
        )}

        <section className="mb-1">
          <SectionLabel>Templates</SectionLabel>
          <div className="space-y-px">
            {templates.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => ws.createFromTemplate(t)}
                className="flex h-[27px] w-full items-center gap-1.5 rounded-md px-2 text-[14px] text-muted transition-colors duration-120 hover:bg-hover"
              >
                <span className="text-[15px] leading-none">{t.icon}</span>
                <span className="flex-1 truncate text-left">{t.name}</span>
                <Plus size={13} className="shrink-0 text-faint" />
              </button>
            ))}
          </div>
        </section>
      </div>

      {/* footer */}
      <div className="border-t border-line px-2 py-2">
        <div className="mb-1.5">
          <NavItem icon={<Trash2 size={16} />} label="Trash" onClick={() => ws.setTrashOpen(true)} />
        </div>
        <div className="flex items-center gap-2 rounded-md px-1.5 py-1">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white" style={{ background: av.color }}>{av.initials}</span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium text-ink">{auth.user?.name ?? 'User'}</p>
            <p className="truncate text-2xs text-faint">{auth.user?.role === 'admin' ? 'Admin' : `@${auth.user?.username ?? 'you'}`}</p>
          </div>
          <button type="button" onClick={() => auth.logout()} className="flex h-6 w-6 items-center justify-center rounded text-faint hover:bg-hover hover:text-danger" aria-label="Log out">
            <LogOut size={15} />
          </button>
          <button type="button" onClick={() => ws.setSidebarCollapsed(true)} className="flex h-6 w-6 items-center justify-center rounded text-faint hover:bg-hover hover:text-muted" aria-label="Collapse sidebar">
            <ChevronsLeftRight size={15} />
          </button>
        </div>
      </div>

      <div onMouseDown={onResizeStart} className="group absolute right-0 top-0 h-full w-1 cursor-col-resize" role="separator" aria-label="Resize sidebar">
        <div className="absolute right-0 top-0 h-full w-px bg-line transition-colors group-hover:w-0.5 group-hover:bg-accent" />
      </div>
    </aside>
  );
}
