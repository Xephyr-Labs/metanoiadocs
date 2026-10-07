// Phone navigation, at the bottom where the thumb is.
//
// On a phone every destination used to sit behind the drawer button in the
// top-left corner — the one spot a thumb can't reach — so going from a page to
// Tasks to the Inbox was open drawer, find row, tap, three times over. The four
// places people actually move between get a tab each; everything else (folders,
// projects, templates, trash) stays in the drawer, which the last tab opens.
import { CheckSquare, FileText, Home, Inbox, Menu as MenuIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { useWorkspace } from '../../store/workspace';

function Tab({ icon, label, active, badge, onClick }: {
  icon: ReactNode;
  label: string;
  active?: boolean;
  badge?: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'relative flex min-h-[52px] flex-1 flex-col items-center justify-center gap-0.5 whitespace-nowrap text-[11px] font-medium leading-none',
        'transition-[color,transform] duration-120 ease-out active:scale-95',
        'focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent',
        active ? 'text-accent-strong' : 'text-muted',
      )}
    >
      <span className="relative">
        {icon}
        {!!badge && (
          // Same pill as the drawer's Inbox row: accent-strong keeps white lettering legible.
          <span className="absolute -right-2.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent-fill px-1 text-3xs font-semibold text-white">
            {badge > 99 ? '99+' : badge}
          </span>
        )}
      </span>
      {label}
    </button>
  );
}

export function TabBar() {
  const ws = useWorkspace();
  return (
    <nav
      aria-label="Main"
      className="mn-tabbar flex shrink-0 bg-canvas pb-[env(safe-area-inset-bottom)] shadow-[inset_0_1px_0_var(--line)]"
    >
      <Tab icon={<Home size={22} />} label="Home" active={ws.view === 'home'} onClick={ws.openHome} />
      <Tab icon={<FileText size={22} />} label="Docs" active={ws.view === 'docs' || ws.view === 'doc' || ws.view === 'folder'} onClick={ws.openAllDocs} />
      <Tab icon={<CheckSquare size={22} />} label="Tasks" active={ws.view === 'tasks' || ws.view === 'project'} onClick={ws.openTasks} />
      <Tab icon={<Inbox size={22} />} label="Inbox" badge={ws.unreadCount} active={ws.inboxOpen} onClick={() => ws.setInboxOpen(true)} />
      <Tab icon={<MenuIcon size={22} />} label="Menu" active={ws.mobileDrawerOpen} onClick={() => ws.setMobileDrawer(true)} />
    </nav>
  );
}
