import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

/** A single keycap. `onDark` variant sits inside dark tooltips. */
export function Kbd({ children, onDark }: { children: ReactNode; onDark?: boolean }) {
  return (
    <kbd
      className={cn(
        'inline-flex min-w-[16px] items-center justify-center rounded px-1 font-sans text-3xs font-medium leading-[16px]',
        onDark
          ? 'bg-white/20 text-white'
          : 'bg-hover text-muted ring-1 ring-inset ring-line',
      )}
    >
      {children}
    </kbd>
  );
}
