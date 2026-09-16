import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { Tooltip } from './Tooltip';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: ReactNode;
  label: string;
  keys?: string[];
  active?: boolean;
  size?: 'sm' | 'md';
  tone?: 'default' | 'danger';
  /** Which side the tooltip opens on. A vertical rail needs `right`; the
   *  default `bottom` would cover the next icon down. */
  side?: 'top' | 'right' | 'bottom' | 'left';
}

/** Square ghost control for toolbars and the top bar. Always tooltip-labelled. */
export const IconButton = forwardRef<HTMLButtonElement, Props>(function IconButton(
  { icon, label, keys, active, size = 'md', tone = 'default', side, className, ...rest },
  ref,
) {
  return (
    <Tooltip label={label} keys={keys} side={side}>
      <button
        ref={ref}
        type="button"
        aria-label={label}
        aria-pressed={active}
        className={cn(
          'inline-flex shrink-0 items-center justify-center rounded-md text-muted transition-colors duration-120 ease-out',
          'hover:bg-hover hover:text-ink active:bg-selected disabled:pointer-events-none disabled:opacity-40',
          size === 'sm' ? 'h-6 w-6' : 'h-7 w-7',
          // Pressed is a neutral fill, like a nav row: a toolbar toggle says
          // "this panel is open", which is not news worth the accent.
          active && 'bg-selected text-ink hover:bg-selected hover:text-ink',
          tone === 'danger' && 'hover:bg-danger-soft hover:text-danger-strong',
          className,
        )}
        {...rest}
      >
        {icon}
      </button>
    </Tooltip>
  );
});
