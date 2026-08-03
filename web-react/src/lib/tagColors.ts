// Notion-muted tag palette. Each color maps to a chip (bg+text) and a solid dot.
// Values chosen to read on both light and dark surfaces.
export const TAG_COLORS = ['gray', 'red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink'] as const;
export type TagColor = (typeof TAG_COLORS)[number];

interface Swatch { chip: string; dot: string }

const MAP: Record<string, Swatch> = {
  gray:   { chip: 'bg-gray-500/12 text-gray-600 dark:text-gray-300',     dot: 'bg-gray-400' },
  red:    { chip: 'bg-red-500/12 text-red-600 dark:text-red-400',        dot: 'bg-red-500' },
  orange: { chip: 'bg-orange-500/14 text-orange-600 dark:text-orange-400', dot: 'bg-orange-500' },
  yellow: { chip: 'bg-yellow-500/16 text-yellow-700 dark:text-yellow-400', dot: 'bg-yellow-500' },
  green:  { chip: 'bg-green-500/12 text-green-600 dark:text-green-400',   dot: 'bg-green-500' },
  teal:   { chip: 'bg-teal-500/12 text-teal-600 dark:text-teal-400',     dot: 'bg-teal-500' },
  blue:   { chip: 'bg-blue-500/12 text-blue-600 dark:text-blue-400',     dot: 'bg-blue-500' },
  purple: { chip: 'bg-purple-500/12 text-purple-600 dark:text-purple-400', dot: 'bg-purple-500' },
  pink:   { chip: 'bg-pink-500/12 text-pink-600 dark:text-pink-400',     dot: 'bg-pink-500' },
};

export const swatch = (color: string): Swatch => MAP[color] ?? MAP.gray;
