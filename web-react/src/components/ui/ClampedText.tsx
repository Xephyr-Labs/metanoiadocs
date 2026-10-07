import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '../../lib/cn';

/**
 * A comment body that stops at five lines until asked for the rest.
 *
 * One pasted spec in a thread used to push every other comment off the panel.
 * The cut is CSS line-clamp, and the "See more" only appears when the clamp
 * actually hid something — measured, not guessed from a character count, which
 * gets a narrow panel and a list of short lines both wrong.
 */
export function ClampedText({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [open, setOpen] = useState(false);
  const [overflows, setOverflows] = useState(false);

  // Only a clamped box can tell whether it overflows; while open, the button
  // stays so the reader can fold it back. Runs after every render because an
  // edit changes the text without changing the clamped box's size.
  const measure = () => {
    const el = ref.current;
    if (el && !open) setOverflows(el.scrollHeight > el.clientHeight + 1);
  };
  useLayoutEffect(measure);
  // The panel is resizable and the window can narrow, so the same text can
  // start or stop overflowing without re-rendering.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <>
      <p ref={ref} className={cn('whitespace-pre-wrap break-words', !open && 'line-clamp-5', className)}>
        {children}
      </p>
      {(overflows || open) && (
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className="mt-0.5 text-xs font-medium text-accent-strong hover:underline"
        >
          {open ? 'See less' : 'See more'}
        </button>
      )}
    </>
  );
}
