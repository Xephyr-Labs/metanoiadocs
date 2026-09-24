import { cn } from '../../lib/cn';
import { TAG_COLORS, swatch } from '../../lib/tagColors';

/** The icon a database gets when nobody chose one. Every board used to wear
 *  it, so a sidebar of projects read as a column of identical clipboards. */
export const DEFAULT_PROJECT_ICON = '📋';

// No gray (reads as disabled) and no red (the sidebar's overdue count is red,
// so a red tile beside it would look like an alarm).
const TINTS = TAG_COLORS.filter((c) => c !== 'gray' && c !== 'red');

/** Stable per project, so a board keeps its colour across reloads and people. */
function tintFor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return TINTS[Math.abs(h) % TINTS.length];
}

export const hasChosenIcon = (icon: string | null | undefined) =>
  !!icon && icon !== DEFAULT_PROJECT_ICON;

/**
 * A database's glyph: the emoji somebody picked, or else its initial on a
 * tinted tile — distinct per board without anyone having to choose.
 */
export function ProjectIcon({ project, size = 16, className }: {
  project: { id: string; name: string; icon?: string | null };
  size?: number;
  className?: string;
}) {
  if (hasChosenIcon(project.icon)) {
    return (
      <span aria-hidden className={cn('inline-flex shrink-0 items-center justify-center leading-none', className)} style={{ width: size, height: size, fontSize: size * 0.9 }}>
        {project.icon}
      </span>
    );
  }
  const initial = Array.from(project.name.trim())[0]?.toUpperCase() || '?';
  return (
    <span
      aria-hidden
      className={cn('inline-flex shrink-0 items-center justify-center rounded font-semibold leading-none', swatch(tintFor(project.id)).chip, className)}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.62) }}
    >
      {initial}
    </span>
  );
}
