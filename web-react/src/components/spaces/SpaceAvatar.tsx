import { cn } from '../../lib/cn';
import { spaceInitial } from '../../lib/spaceTree';
import { swatch } from '../../lib/tagColors';
import { tintFor } from '../ui/ProjectIcon';

/** A space's mark, Notion-workspace style: its initial on a tile tinted per space. */
export function SpaceAvatar({ space, size = 20, className }: {
  space: { id: string; name: string };
  size?: number;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn('inline-flex shrink-0 items-center justify-center rounded font-semibold leading-none', swatch(tintFor(space.id)).chip, className)}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.6) }}
    >
      {spaceInitial(space.name)}
    </span>
  );
}
