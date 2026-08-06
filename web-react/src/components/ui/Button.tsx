import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '../../lib/cn';

type Variant = 'primary' | 'secondary' | 'ghost' | 'subtle';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'sm' | 'md';
  leftIcon?: ReactNode;
  children: ReactNode;
}

// Flat, single-accent. No gradients — hover shifts brightness only.
const variants: Record<Variant, string> = {
  primary:
    'bg-accent text-white hover:brightness-[0.94] active:brightness-90 shadow-[0_1px_2px_rgba(15,15,15,0.08)]',
  secondary:
    'bg-transparent text-ink ring-1 ring-inset ring-line-strong hover:bg-hover active:bg-selected',
  ghost: 'bg-transparent text-muted hover:bg-hover hover:text-ink active:bg-selected',
  subtle: 'bg-surface text-ink hover:bg-hover active:bg-selected',
};

export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  { variant = 'secondary', size = 'md', leftIcon, className, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      className={cn(
        'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-[background-color,filter,box-shadow] duration-120 ease-out',
        'disabled:pointer-events-none disabled:opacity-50',
        size === 'sm' ? 'h-7 px-2.5 text-sm' : 'h-8 px-3 text-base',
        variants[variant],
        className,
      )}
      {...rest}
    >
      {leftIcon}
      {children}
    </button>
  );
});
