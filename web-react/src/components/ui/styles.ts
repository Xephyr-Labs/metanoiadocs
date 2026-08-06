/** The one text-field look: 32px, hairline drawn as an inset ring (a border
 * would add a layout pixel), thickening to the accent on focus. Use it for
 * `input`, `select` and `textarea` alike so a form never mixes two hairlines.
 *
 *   <input className={field} />
 *   <select className={cn(field, 'h-7 w-auto text-xs')} />
 */
export const field =
  'h-8 w-full rounded-md bg-surface px-2.5 text-sm text-ink outline-none ring-1 ring-inset ring-line ' +
  'placeholder:text-faint transition-shadow duration-120 focus:ring-2 focus:ring-accent ' +
  'disabled:opacity-50';

/** The 20px affordance that appears on hover inside a tree/list row (⋯, +, ×).
 * Too small for IconButton's 28px hit box, so it gets its own one-liner rather
 * than eight near-copies that drift apart. */
export const rowAction =
  'flex h-5 w-5 shrink-0 items-center justify-center rounded text-faint ' +
  'transition-colors duration-120 hover:bg-hover hover:text-muted';
