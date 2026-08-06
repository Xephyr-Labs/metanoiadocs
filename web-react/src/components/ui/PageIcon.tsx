import { DocIcon } from './DocIcon';

/** A page's emoji when one was chosen; the quiet monochrome glyph otherwise. */
export function PageIcon({ icon, size = 16, className }: { icon?: string | null; size?: number; className?: string }) {
  if (icon && icon !== '📄') {
    return (
      <span className={className ?? 'shrink-0'} style={{ fontSize: size - 1, lineHeight: 1 }} aria-hidden>
        {icon}
      </span>
    );
  }
  return <DocIcon size={size} className={className ?? 'shrink-0 text-faint'} />;
}
