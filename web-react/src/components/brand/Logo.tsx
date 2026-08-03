import { cn } from '../../lib/cn';

/**
 * MetanoiaDocs mark — an accent tile with a white "M" drawn as an upward
 * double-peak (metanoia = transformation / ascent) plus a folded page corner
 * to read as "docs". Flat, single-accent, no gradient.
 */
export function LogoMark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      role="img"
      aria-label="MetanoiaDocs"
      className={cn('shrink-0', className)}
    >
      <rect width="32" height="32" rx="7.5" fill="var(--accent)" />
      {/* folded page corner */}
      <path d="M22 6h4l0 4z" fill="#fff" fillOpacity="0.28" />
      {/* M as two upward strokes */}
      <path
        d="M8 23V12.4c0-.5.62-.74.95-.36L16 19.5l7.05-7.46c.33-.38.95-.14.95.36V23"
        stroke="#fff"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Full lockup: mark + wordmark. `Docs` sits in the muted tone. */
export function Logo({
  size = 28,
  showDocs = true,
  className,
}: {
  size?: number;
  showDocs?: boolean;
  className?: string;
}) {
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <LogoMark size={size} />
      <span className="text-[15px] font-semibold tracking-tight text-ink">
        Metanoia
        {showDocs && <span className="font-medium text-muted">Docs</span>}
      </span>
    </div>
  );
}
