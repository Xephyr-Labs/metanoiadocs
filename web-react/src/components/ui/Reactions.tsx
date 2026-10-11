import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { SmilePlus } from 'lucide-react';
import { MORE_REACTIONS, QUICK_REACTIONS, type Reaction } from '../../lib/emoji';
import { useAnchoredPopover } from '../../hooks/useAnchoredPopover';
import { useOutsideClick } from '../../hooks/useOutsideClick';
import { cn } from '../../lib/cn';

/**
 * The reactions people have left under a comment — tap one to add yours or
 * take it back. Nothing at all when there are none: a row of every emoji under
 * every comment was noise. Adding a new one is ReactionPicker, which the
 * comment shows on hover the way Slack and Teams do. Without `onToggle` it
 * only shows what is there — a guest, or a viewer.
 */
export function Reactions({ reactions = [], onToggle, className }: {
  reactions?: Reaction[];
  onToggle?: (emoji: string) => void;
  className?: string;
}) {
  if (!reactions.length) return null;
  return (
    <div className={cn('mt-1.5 flex flex-wrap items-center gap-1', className)}>
      {reactions.map((r) => (
        <button
          key={r.emoji}
          type="button"
          disabled={!onToggle}
          onClick={() => onToggle?.(r.emoji)}
          title={r.names?.length ? `${r.names.join(', ')}` : undefined}
          aria-label={`${r.emoji} ${r.count}${r.mine ? ', including you' : ''}`}
          aria-pressed={!!r.mine}
          className={cn(
            'flex h-6 items-center gap-1 rounded-full px-1.5 text-xs tabular-nums ring-1 ring-inset transition-colors',
            r.mine ? 'bg-accent-soft text-accent-strong ring-accent' : 'bg-canvas text-muted ring-line',
            onToggle ? 'hover:ring-line-strong' : 'cursor-default',
          )}
        >
          <span className="mn-emoji text-sm leading-none">{r.emoji}</span>
          {r.count}
        </button>
      ))}
    </div>
  );
}

/**
 * The one "add a reaction" button. Hidden until the comment is hovered (the
 * caller's `reveal` group class), always there on a touch screen, and kept in
 * view while its menu is open.
 */
export function ReactionPicker({ reactions = [], onToggle, reveal }: {
  reactions?: Reaction[];
  onToggle: (emoji: string) => void;
  /** Tailwind classes that show the button, e.g. 'group-hover/card:opacity-100'. */
  reveal: string;
}) {
  const [open, setOpen] = useState(false);
  const pop = useRef<HTMLDivElement>(null);
  const { anchor, style } = useAnchoredPopover(open, 284);
  useOutsideClick(pop, () => setOpen(false), open);
  const used = new Set(reactions.filter((r) => r.mine).map((r) => r.emoji));
  const pick = (e: string) => { onToggle(e); setOpen(false); };

  return (
    <>
      <button
        ref={anchor}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Add a reaction"
        title="Add a reaction"
        aria-expanded={open}
        className={cn(
          'flex h-5 w-5 shrink-0 items-center justify-center rounded text-faint transition-opacity hover:bg-hover hover:text-ink focus-visible:opacity-100 [@media(hover:none)]:opacity-100',
          open ? 'bg-hover text-ink opacity-100' : cn('opacity-0', reveal),
        )}
      >
        <SmilePlus size={13} />
      </button>
      {open && style && createPortal(
        <div ref={pop} style={style} className="z-50 rounded-lg border border-line bg-canvas p-1.5 shadow-pop">
          <div className="flex gap-0.5 border-b border-line pb-1.5">
            {QUICK_REACTIONS.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => pick(e)}
                aria-label={`React ${e}`}
                aria-pressed={used.has(e)}
                className={cn('mn-emoji flex h-9 w-9 items-center justify-center rounded-md text-xl leading-none hover:bg-hover', used.has(e) && 'bg-accent-soft')}
              >
                {e}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-8 gap-0.5 pt-1.5">
            {MORE_REACTIONS.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => pick(e)}
                aria-label={`React ${e}`}
                aria-pressed={used.has(e)}
                className={cn('mn-emoji flex h-8 w-8 items-center justify-center rounded-md text-lg leading-none hover:bg-hover', used.has(e) && 'bg-accent-soft')}
              >
                {e}
              </button>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
