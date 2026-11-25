/** The one text-field look: 32px, hairline drawn as an inset ring (a border
 * would add a layout pixel), thickening to the accent on focus. Use it for
 * `input`, `select` and `textarea` alike so a form never mixes two hairlines.
 *
 *   <input className={field} />
 *   <select className={cn(field, 'h-7 w-auto text-xs')} />
 */
export const field =
  'h-8 coarse:min-h-11 w-full rounded-md bg-surface px-2.5 text-sm text-ink outline-none ring-1 ring-inset ring-line ' +
  'placeholder:text-faint transition-shadow duration-120 focus:ring-2 focus:ring-accent ' +
  'disabled:opacity-50';

/**
 * The same field, for a `select`. `mn-select` (index.css) drops the OS widget
 * and draws one chevron, so a form does not show three different arrows on
 * three different platforms — and so the control looks the same in dark.
 *
 *   <select className={selectField} />
 */
export const selectField = `${field} mn-select cursor-pointer`;

/**
 * The same field with the box taken off — for a grid and for the peek's
 * property rail, where a permanent border on every value turns a table into a
 * form. Fifteen columns of boxed inputs is what made Points and Progress the
 * only two columns you could see when the grid was doing nothing.
 *
 * Same hairline language as the rest: transparent at rest, the line on hover,
 * the accent on focus. Same 10px inset as `field`, so a value lines up with
 * its column head whichever control happens to be drawing it.
 */
export const cellField =
  'h-7 w-full rounded bg-transparent px-2.5 text-sm text-ink outline-none ring-1 ring-inset ring-transparent ' +
  'placeholder:text-faint transition-shadow duration-120 hover:ring-line focus:ring-2 focus:ring-accent';

/** The 20px affordance that appears on hover inside a tree/list row (⋯, +, ×).
 * Too small for IconButton's 28px hit box, so it gets its own one-liner rather
 * than eight near-copies that drift apart. */
export const rowAction =
  'mn-hit flex h-5 w-5 shrink-0 items-center justify-center rounded text-faint ' +
  'transition-colors duration-120 hover:bg-hover hover:text-muted';

/** A tree row's hover actions while nobody is pointing at the row: out of the
 * layout, so the title truncates at the row's end rather than short of two
 * invisible buttons. They come back for keyboard focus inside the row and while
 * their menu is open (the pointer has left for the menu, the trigger has to
 * stay put for it to hang from). Pair with `group/row` on the row. */
export const rowActionsAtRest =
  'hidden group-focus-within/row:flex group-has-[[data-state=open]]/row:flex';

/**
 * The frame of a top-level page (Home, All documents, Drive, a space,
 * Workflows): one width, one inset, one top margin. Each page carried its own
 * copy, and they had drifted to 1000, 1100 and 1440px — so the title jumped
 * 60px sideways and 18px down as you went down the sidebar.
 *
 *   <div className="scrollarea h-full overflow-y-auto bg-canvas">
 *     <div className={pageFrame}>…</div>
 *   </div>
 */
export const pageFrame = 'mx-auto max-w-[1440px] px-6 py-8 md:px-10';

/** The title those pages open with. Home's greeting is the one larger one. */
export const pageTitle = 'font-display text-2xl font-semibold leading-7 tracking-[-0.03em] text-ink md:text-3xl';
