import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

interface Props {
  icon: LucideIcon;
  title: string;
  hint?: string;
  action?: ReactNode;
  compact?: boolean;
}

/** Calm, illustration-free empty state. Icon in a soft tile, one line of hint. */
export function EmptyState({ icon: Icon, title, hint, action, compact }: Props) {
  return (
    <div
      className={`flex flex-col items-center justify-center text-center ${
        compact ? 'gap-2 py-8' : 'gap-3 py-16'
      }`}
    >
      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-surface text-faint ring-1 ring-inset ring-line">
        <Icon size={18} strokeWidth={1.75} />
      </div>
      <div className="space-y-0.5">
        <p className="text-sm font-medium text-ink">{title}</p>
        {hint && <p className="max-w-[240px] text-[13px] text-muted">{hint}</p>}
      </div>
      {action}
    </div>
  );
}
