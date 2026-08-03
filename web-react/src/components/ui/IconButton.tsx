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
}

/** Square ghost control for toolbars and the top bar. Always tooltip-labelled. */
export const IconButton = forwardRef<HTMLButtonElement, Props>(function IconButton(
  { icon, label, keys, active, size = 'md', tone = 'default', className, ...rest },
  ref,
) {
  return (
    <Tooltip label={label} keys={keys}>
      <button
        ref={ref}
        type="button"
        aria-label={label}
        aria-pressed={active}
        className={cn(
          'inline-flex shrink-0 items-center justify-center rounded-md text-muted transition-colors duration-120 ease-out',
          'hover:bg-hover hover:text-ink active:bg-selected disabled:pointer-events-none disabled:opacity-40',
          size === 'sm' ? 'h-6 w-6' : 'h-7 w-7',
          active && 'bg-hover text-ink',
          tone === 'danger' && 'hover:bg-danger/10 hover:text-danger',
          className,
        )}
        {...rest}
      >
        {icon}
      </button>
    </Tooltip>
  );
});
