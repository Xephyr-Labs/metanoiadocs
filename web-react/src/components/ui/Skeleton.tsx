import { cn } from '../../lib/cn';

/** Subtle shimmer block that mirrors final layout dimensions. */
export function Skeleton({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <div
      style={style}
      className={cn(
        'relative overflow-hidden rounded bg-surface',
        'before:absolute before:inset-0 before:-translate-x-full',
        'before:bg-gradient-to-r before:from-transparent before:via-black/[0.04] before:to-transparent',
        'before:animate-[shimmer_1.4s_infinite] dark:before:via-white/[0.05]',
        className,
      )}
    />
  );
}

export function SidebarSkeleton() {
  return (
    <div className="space-y-1.5 px-3 py-2">
      {[68, 82, 74, 90, 60].map((w, i) => (
        <div key={i} className="flex items-center gap-2 py-1">
          <Skeleton className="h-4 w-4 rounded" />
          <Skeleton className="h-3.5" style={{ width: `${w}%` }} />
        </div>
      ))}
    </div>
  );
}

export function PageSkeleton() {
  return (
    <div className="mx-auto w-full max-w-[720px] space-y-4 px-6 pt-24">
      <Skeleton className="h-9 w-2/3 rounded-md" />
      <div className="space-y-2.5 pt-4">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-[92%]" />
        <Skeleton className="h-4 w-[80%]" />
        <Skeleton className="h-4 w-[88%]" />
      </div>
    </div>
  );
}
