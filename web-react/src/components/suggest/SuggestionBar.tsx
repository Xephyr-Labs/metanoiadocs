import { ChevronLeft, ChevronRight } from 'lucide-react';
import { SHORTCUT_NEXT_CHANGE, SHORTCUT_PREV_CHANGE } from '../../lib/hotkeys';
import type { Suggestions } from '../../editor/suggest/rail';

/** "Andy suggested 5 changes" — or the count alone when several people did. */
export function summary(cards: { author: string }[]): string {
  const n = cards.length;
  const changes = `${n} change${n === 1 ? '' : 's'}`;
  const who = new Set(cards.map((c) => c.author));
  return who.size === 1 ? `${[...who][0]} suggested ${changes}` : `${n} suggested change${n === 1 ? '' : 's'}`;
}

/** Above the page while it has pending suggestions: the count, ‹ 3 of 12 ›,
 *  and, for people who can edit, Accept all / Reject all. */
export function SuggestionBar({ s, canDecide }: { s: Suggestions; canDecide: boolean }) {
  const n = s.cards.length;
  if (!n) return null;
  const at = s.active ? s.cards.findIndex((c) => c.id === s.active) + 1 : 0;
  const nav = 'flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-ink';
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-line bg-surface px-3 py-1.5 text-xs">
      <p className="min-w-0 flex-1 truncate text-ink">{summary(s.cards)}</p>
      <div className="flex items-center">
        <button type="button" className={nav} onClick={s.prev} aria-label="Previous change" title={`Previous change (${SHORTCUT_PREV_CHANGE})`}>
          <ChevronLeft size={16} />
        </button>
        <span className="min-w-14 text-center tabular-nums text-muted" aria-live="polite">{at ? `${at} of ${n}` : `– of ${n}`}</span>
        <button type="button" className={nav} onClick={s.next} aria-label="Next change" title={`Next change (${SHORTCUT_NEXT_CHANGE})`}>
          <ChevronRight size={16} />
        </button>
      </div>
      {canDecide && (
        <>
          <button type="button" onClick={() => s.decideAll('accept')} className="rounded-md px-2 py-1 font-medium text-ok hover:bg-hover">
            Accept all
          </button>
          <button type="button" onClick={() => s.decideAll('reject')} className="rounded-md px-2 py-1 font-medium text-danger-strong hover:bg-hover">
            Reject all
          </button>
        </>
      )}
    </div>
  );
}
