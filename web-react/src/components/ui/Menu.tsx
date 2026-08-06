import * as DM from '@radix-ui/react-dropdown-menu';
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
    'data-[highlighted]:bg-hover',
    danger ? 'text-danger data-[highlighted]:bg-danger/10' : 'text-ink',
  );

/** Command-menu-style dropdown with icons + shortcuts. */
export function Menu({ trigger, items, align = 'start', side = 'bottom', width = 220 }: Props) {
  return (
    <DM.Root>
      <DM.Trigger asChild>{trigger}</DM.Trigger>
      <DM.Portal>
        <DM.Content
          align={align}
          side={side}
          sideOffset={4}
          style={{ width }}
          className="z-50 rounded-lg border border-line bg-canvas p-1 shadow-pop animate-scale-in"
        >
          {items.map((it, i) => (
            <div key={it.label + i}>
              {it.separatorBefore && <DM.Separator className="my-1 h-px bg-line" />}
              <DM.Item className={itemCls(it.danger)} onSelect={it.onSelect}>
                {it.icon && <it.icon size={16} strokeWidth={1.75} className="shrink-0 opacity-80" />}
                <span className="flex-1 truncate">{it.label}</span>
                {it.shortcut && <span className="text-2xs text-faint">{it.shortcut}</span>}
              </DM.Item>
            </div>
          ))}
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  );
}
