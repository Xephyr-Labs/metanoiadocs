import * as DM from '@radix-ui/react-dropdown-menu';
import { ChevronRight } from 'lucide-react';
import type { ComponentType, ReactNode } from 'react';
import { cn } from '../../lib/cn';

export interface MenuItem {
  /** Lucide icon or any small component accepting size/className (e.g. a color dot). */
  icon?: ComponentType<{ size?: number | string; strokeWidth?: number | string; className?: string }>;
  label: string;
  shortcut?: string;
  danger?: boolean;
  onSelect?: () => void;
  separatorBefore?: boolean;
  /** Nested items. Present ⇒ this row opens a submenu instead of firing onSelect. */
  items?: MenuItem[];
}

interface Props {
  trigger: ReactNode;
  items: MenuItem[];
  align?: 'start' | 'center' | 'end';
  side?: 'top' | 'right' | 'bottom' | 'left';
  width?: number;
}

const itemCls = (danger?: boolean) =>
  cn(
    'flex cursor-pointer select-none items-center gap-2.5 rounded px-2 py-[6px] text-sm outline-none',
    'data-[highlighted]:bg-hover data-[state=open]:bg-hover',
    danger ? 'text-danger data-[highlighted]:bg-danger/10' : 'text-ink',
  );

/* A menu is placed against the trigger, so a long one used to run past the
 * bottom of the window with its last rows unreachable. Radix measures the room
 * it actually has and publishes it as --radix-dropdown-menu-content-available-height;
 * capping to that and scrolling the overflow keeps every row reachable, whether
 * the trigger sits at the top of the sidebar or the bottom. */
const surfaceCls =
  'scrollarea z-50 max-h-[var(--radix-dropdown-menu-content-available-height)] overflow-y-auto ' +
  'rounded-lg border border-line bg-canvas p-1 shadow-pop animate-scale-in';

function Rows({ items }: { items: MenuItem[] }) {
  return (
    <>
      {items.map((it, i) => (
        <div key={it.label + i}>
          {it.separatorBefore && <DM.Separator className="my-1 h-px bg-line" />}
          {it.items?.length ? (
            <DM.Sub>
              <DM.SubTrigger className={itemCls(it.danger)}>
                {it.icon && <it.icon size={16} strokeWidth={1.75} className="shrink-0 opacity-80" />}
                <span className="flex-1 truncate">{it.label}</span>
                <ChevronRight size={14} className="shrink-0 text-faint" />
              </DM.SubTrigger>
              <DM.Portal>
                <DM.SubContent
                  sideOffset={2}
                  alignOffset={-4}
                  collisionPadding={8}
                  style={{ width: 220 }}
                  className={surfaceCls}
                >
                  <Rows items={it.items} />
                </DM.SubContent>
              </DM.Portal>
            </DM.Sub>
          ) : (
            <DM.Item className={itemCls(it.danger)} onSelect={it.onSelect}>
              {it.icon && <it.icon size={16} strokeWidth={1.75} className="shrink-0 opacity-80" />}
              <span className="flex-1 truncate">{it.label}</span>
              {it.shortcut && <span className="text-2xs text-faint">{it.shortcut}</span>}
            </DM.Item>
          )}
        </div>
      ))}
    </>
  );
}

/** Command-menu-style dropdown with icons + shortcuts. Items carrying `items`
 *  nest into a submenu, which is how lists that grow with the workspace —
 *  folders, colours — stay one row instead of dozens. */
export function Menu({ trigger, items, align = 'start', side = 'bottom', width = 220 }: Props) {
  return (
    <DM.Root>
      <DM.Trigger asChild>{trigger}</DM.Trigger>
      <DM.Portal>
        <DM.Content
          align={align}
          side={side}
          sideOffset={4}
          collisionPadding={8}
          style={{ width }}
          className={surfaceCls}
        >
          <Rows items={items} />
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  );
}
