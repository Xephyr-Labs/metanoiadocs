import type { ReactNode } from 'react';

export interface CheckOption {
  value: string;
  label: string;
  /** Drawn before the label — a colour dot, an icon. */
  lead?: ReactNode;
  /** Drawn after it, right-aligned — a count. */
  trail?: ReactNode;
}

/**
 * The panel behind every "pick some of these" control.
 *
 * A row of chips is the obvious thing and is exactly what does not scale —
 * twenty labels is a wall — so the trigger stays one word wide and this opens
 * under it, scrolling past ten. Positioning is the caller's: the chip in the
 * filter bar and the button in a toolbar sit in different places, but the list
 * inside them has to behave identically.
 */
export function CheckList({
  options,
  chosen,
  onToggle,
  onClear,
  empty = 'Nothing to choose from yet.',
  className = 'absolute left-0 top-7 z-30 w-56',
}: {
  options: CheckOption[];
  chosen: string[];
  onToggle: (value: string) => void;
  onClear: () => void;
  empty?: string;
  className?: string;
}) {
  return (
    <div
      className={`scrollarea max-h-64 overflow-y-auto rounded-lg border border-line bg-canvas p-1 ${className}`}
    >
      {options.map((o) => (
        <label
          key={o.value}
          className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm text-ink hover:bg-hover"
        >
          <input type="checkbox" checked={chosen.includes(o.value)} onChange={() => onToggle(o.value)} />
          {o.lead}
          <span className="min-w-0 flex-1 truncate">{o.label}</span>
          {o.trail}
        </label>
      ))}
      {!options.length && <p className="px-2 py-1.5 text-2xs text-faint">{empty}</p>}
      {chosen.length > 0 && (
        <button
          type="button"
          onClick={onClear}
          className="mt-1 w-full rounded px-2 py-1.5 text-left text-2xs text-faint hover:bg-hover hover:text-ink"
        >
          Clear selection
        </button>
      )}
    </div>
  );
}
