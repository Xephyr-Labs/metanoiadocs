import { cn } from '../../lib/cn';

/** The one on/off control. It lived inside SettingsDialog until the webhooks
 *  screen wanted the same thing; a second copy is how two toggles end up
 *  animating differently in the same dialog. */
export function Switch({ on, onChange, disabled, label }: {
  on: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  /** Accessible name, for a switch with no visible text beside it. */
  label?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={cn('mn-hit relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors duration-180 disabled:opacity-60', on ? 'bg-accent' : 'bg-line-strong')}
    >
      {/* A CSS transform, not a framer layout animation: inside a scrolled dialog the layout
          projection started from the wrong offset and the knob slid in from below the track. */}
      <span
        className={cn(
          'absolute left-[3px] top-[3px] h-4 w-4 rounded-full bg-white shadow transition-transform duration-180 ease-[cubic-bezier(0.16,1,0.3,1)]',
          on && 'translate-x-4',
        )}
      />
    </button>
  );
}
