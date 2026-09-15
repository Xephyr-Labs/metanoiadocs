import { useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';

/** Below this much room, look up instead. Roughly six rows and a search box. */
const ROOMY = 200;

/**
 * Where to draw a menu so it escapes the box it was opened from.
 *
 * These menus open inside scrolling grids and side panels. An absolutely
 * positioned one is clipped by that scroll box, which is how the options of
 * the last visible row became unreachable — so the menu is rendered into
 * `document.body` (a portal) and given fixed coordinates measured off its
 * trigger. Re-measured on scroll and resize, in capture so a scroll in any
 * ancestor counts, not only the window's.
 *
 * Flips above the trigger when there is more room there: a list cut off by the
 * bottom of the window is the same bug as one clipped by a scroll box, one
 * level out.
 *
 * Returns the ref to put on the trigger and the style for the menu. A null
 * style means "not open, or not measured yet" — do not draw.
 */
export function useAnchoredPopover(open: boolean, minWidth = 240): {
  anchor: RefObject<HTMLButtonElement>;
  style: CSSProperties | null;
} {
  const anchor = useRef<HTMLButtonElement>(null);
  const [style, setStyle] = useState<CSSProperties | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setStyle(null);
      return;
    }
    const place = () => {
      const r = anchor.current?.getBoundingClientRect();
      if (!r) return;
      const width = Math.max(r.width, minWidth);
      const below = window.innerHeight - r.bottom - 16;
      const above = r.top - 16;
      const flip = below < ROOMY && above > below;
      setStyle({
        position: 'fixed',
        left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)),
        width,
        maxHeight: Math.max(160, flip ? above : below),
        ...(flip ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }),
      });
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open, minWidth]);

  return { anchor, style };
}
