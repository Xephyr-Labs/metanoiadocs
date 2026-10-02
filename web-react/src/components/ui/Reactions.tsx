import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Plus } from 'lucide-react';
import { MORE_REACTIONS, QUICK_REACTIONS, type Reaction } from '../../lib/emoji';
import { useAnchoredPopover } from '../../hooks/useAnchoredPopover';
import { useOutsideClick } from '../../hooks/useOutsideClick';
import { cn } from '../../lib/cn';

/**
 * The reactions under a comment: the ones people have left (tap yours to take
 * it back), then 👍 👎 ❤️ 😢 one tap away and "+" for the rest. Without
 * `onToggle` it only shows what is there — a guest, or a viewer.
 */
export function Reactions({ reactions = [], onToggle, className }: {
  reactions?: Reaction[];
  onToggle?: (emoji: string) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const pop = useRef<HTMLDivElement>(null);
  // Eight 32px cells plus padding: sized up front so it never runs off the edge.
  const { anchor, style } = useAnchoredPopover(open, 284);
  useOutsideClick(pop, () => setOpen(false), open);
  const used = new Set(reactions.map((r) => r.emoji));
  const quick = QUICK_REACTIONS.filter((e) => !used.has(e));
  if (!onToggle && !reactions.length) return null;

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
      {onToggle && (
        // Quiet until the card is hovered or focused; always there on touch.
        <span className="flex items-center gap-0.5 opacity-60 transition-opacity focus-within:opacity-100 group-hover/card:opacity-100 [@media(hover:none)]:opacity-100">
          {quick.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => onToggle(e)}
              aria-label={`React ${e}`}
              className="mn-emoji flex h-6 w-6 items-center justify-center rounded-full text-sm leading-none grayscale-[40%] hover:bg-hover hover:grayscale-0"
            >
              {e}
            </button>
          ))}
          <button
            ref={anchor}
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-label="More reactions"
            aria-expanded={open}
            className="flex h-6 w-6 items-center justify-center rounded-full text-faint hover:bg-hover hover:text-ink"
          >
            <Plus size={13} />
          </button>
        </span>
      )}
      {open && style && createPortal(
        <div
          ref={pop}
          style={style}
          className="z-50 grid grid-cols-8 gap-0.5 rounded-lg border border-line bg-canvas p-1.5 shadow-pop"
        >
          {[...QUICK_REACTIONS, ...MORE_REACTIONS].map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => { onToggle?.(e); setOpen(false); }}
              aria-label={`React ${e}`}
              className={cn('mn-emoji flex h-8 w-8 items-center justify-center rounded-md text-lg leading-none hover:bg-hover', used.has(e) && 'bg-accent-soft')}
            >
              {e}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}
