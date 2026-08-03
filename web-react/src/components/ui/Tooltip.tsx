import * as RT from '@radix-ui/react-tooltip';
import type { ReactNode } from 'react';
import { Kbd } from './Kbd';

interface Props {
  label: ReactNode;
  keys?: string[];
  side?: 'top' | 'right' | 'bottom' | 'left';
  children: ReactNode;
}

/** Compact, low-latency tooltip used across chrome controls. */
export function Tooltip({ label, keys, side = 'bottom', children }: Props) {
  return (
    <RT.Root delayDuration={280}>
      <RT.Trigger asChild>{children}</RT.Trigger>
      <RT.Portal>
        <RT.Content
          side={side}
          sideOffset={6}
          className="z-50 flex items-center gap-1.5 rounded-md bg-[#2f2f2c] px-2 py-1 text-2xs font-medium text-white shadow-pop animate-scale-in dark:bg-[#3a3a37]"
        >
          {label}
          {keys && (
            <span className="flex gap-0.5">
              {keys.map((k) => (
                <Kbd key={k} onDark>
                  {k}
                </Kbd>
              ))}
            </span>
          )}
        </RT.Content>
      </RT.Portal>
    </RT.Root>
  );
}

export const TooltipProvider = RT.Provider;
