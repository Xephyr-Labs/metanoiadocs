// Notion-muted tag palette. Each color maps to a chip (bg+text) and a solid dot.
// Values chosen to read on both light and dark surfaces.
//
// Opacity modifiers must come from Tailwind's default scale. `/12`, `/14` and
// `/16` are NOT on it, so those classes emitted no CSS at all and every chip
// rendered on a transparent background — coloured text floating on the card,
// for as long as this palette has existed. Arbitrary values (`/[12%]`) would
// also work; scale values keep the class list boring.
//
// Light-mode text sits at 700-800, not 600. Measured against the painted chip
// (a 10-20% tint over the card, not over paper): at 600 the green chip came out
// at 2.66:1, orange 2.90, teal 3.00 — all under the 4.5:1 floor for 12px text.
// Dark mode keeps 400: it measures 5.7-10.8 against the dark card.
export const TAG_COLORS = ['gray', 'red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink'] as const;
export type TagColor = (typeof TAG_COLORS)[number];

interface Swatch {
  chip: string;
  dot: string;
  /** A filled area big enough that its colour is the only thing carrying the
   *  meaning — a chart segment, a progress band.
   *
   *  Not `dot`. A dot is 10px beside its own text label, so it can afford to be
   *  decorative; measured on the light surface the 500 steps run 1.8–2.4:1,
   *  under the 3:1 floor for a graphic that has to be read. One step darker in
   *  light clears it (yellow needs two — 600 is still 2.7:1); dark mode keeps
   *  the 500s, which measure 4.3–8.2:1 on the dark card. */
  bar: string;
}

const MAP: Record<string, Swatch> = {
  gray:   { chip: 'bg-gray-500/10 text-gray-700 dark:text-gray-300',       dot: 'bg-gray-400',   bar: 'bg-gray-600 dark:bg-gray-400' },
  red:    { chip: 'bg-red-500/10 text-red-700 dark:text-red-400',          dot: 'bg-red-500',    bar: 'bg-red-600 dark:bg-red-500' },
  orange: { chip: 'bg-orange-500/20 text-orange-800 dark:text-orange-400', dot: 'bg-orange-500', bar: 'bg-orange-600 dark:bg-orange-500' },
  yellow: { chip: 'bg-yellow-500/20 text-yellow-800 dark:text-yellow-400', dot: 'bg-yellow-500', bar: 'bg-yellow-700 dark:bg-yellow-500' },
  green:  { chip: 'bg-green-500/10 text-green-800 dark:text-green-400',    dot: 'bg-green-500',  bar: 'bg-green-600 dark:bg-green-500' },
  teal:   { chip: 'bg-teal-500/10 text-teal-800 dark:text-teal-400',       dot: 'bg-teal-500',   bar: 'bg-teal-600 dark:bg-teal-500' },
  blue:   { chip: 'bg-blue-500/10 text-blue-700 dark:text-blue-400',       dot: 'bg-blue-500',   bar: 'bg-blue-600 dark:bg-blue-500' },
  purple: { chip: 'bg-purple-500/10 text-purple-700 dark:text-purple-400', dot: 'bg-purple-500', bar: 'bg-purple-600 dark:bg-purple-500' },
  pink:   { chip: 'bg-pink-500/10 text-pink-700 dark:text-pink-400',       dot: 'bg-pink-500',   bar: 'bg-pink-600 dark:bg-pink-500' },
};

export const swatch = (color: string): Swatch => MAP[color] ?? MAP.gray;

/** Folder icon tint per palette colour; gray stays the quiet default. Lives
 *  here beside the swatches so the sidebar tree and the folder page cannot
 *  drift into two different greens. */
const FOLDER_TINT: Record<string, string> = {
  gray: 'text-faint',
  red: 'text-red-500',
  orange: 'text-orange-500',
  yellow: 'text-yellow-500',
  green: 'text-green-500',
  teal: 'text-teal-500',
  blue: 'text-blue-500',
  purple: 'text-purple-500',
  pink: 'text-pink-500',
};

export const folderTint = (color: string): string => FOLDER_TINT[color] ?? 'text-faint';
