/* Hallmark · component: suggestion margin cards · genre: modern-minimal
 * theme: project tokens (index.css) · states: default · hover (highlights the
 * text) · active (ring) · loading (renders nothing until the store is up)
 */
import { useLayoutEffect, useRef, useState } from 'react';
import { Check, X } from 'lucide-react';
import { avatarFor } from '../../lib/avatar';
import { cn } from '../../lib/cn';
import { relativeTime } from '../../lib/time';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { CARD_GAP, CARD_W, cardsInline, elementsFor, stackCards, type Card, type Suggestions } from '../../editor/suggest/rail';
import type { Verdict } from '../../editor/suggest/model';

const GAP = 8;

interface RailProps {
  cards: Card[];
  active: string | null;
  /** Editors only: viewers and commenters see the cards without buttons. */
  canDecide: boolean;
  onDecide: (id: string, v: Verdict) => void;
  onHover: (id: string | null) => void;
  onActivate: (id: string) => void;
  /** Cards sit under their paragraph, full column width (phone, narrow panes). */
  inline?: boolean;
}

/** The cards themselves, hook-free: where each sits is SuggestionLayer's job. */
export function SuggestionRail({ cards, active, canDecide, onDecide, onHover, onActivate, inline }: RailProps) {
  return (
    <>
      {cards.map((c) => {
        const a = avatarFor(c.via === 'ai' ? (c.agent ? 'Agent' : 'Ask AI') : c.author);
        return (
          <div
            key={c.id}
            data-sugg-card={c.id}
            onMouseEnter={() => onHover(c.id)}
            onMouseLeave={() => onHover(null)}
            // Not the editor's: a press here must not move the caret or select.
            onMouseDown={(e) => e.stopPropagation()}
            className={cn(
              'pointer-events-auto absolute rounded-lg border border-line bg-canvas p-2.5 shadow-sm',
              'transition-[box-shadow,border-color] duration-120',
              inline ? 'left-0 right-0' : 'left-full',
              c.id === active ? 'border-line-strong ring-2 ring-accent' : 'hover:border-line-strong',
            )}
            style={inline ? undefined : { width: CARD_W, marginLeft: CARD_GAP }}
          >
            <div className="flex items-center gap-2">
              <span
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-3xs font-semibold text-white"
                style={{ background: a.color }}
                aria-hidden
              >
                {a.initials}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium text-ink">{c.author}</p>
                <p className="text-3xs text-faint">{relativeTime(new Date(c.at).toISOString())}</p>
              </div>
              {canDecide && (
                <>
                  <button
                    type="button"
                    aria-label={`Accept: ${c.text}`}
                    title="Accept"
                    onClick={(e) => { e.stopPropagation(); onDecide(c.id, 'accept'); }}
                    className="flex h-7 w-7 items-center justify-center rounded-md text-ok hover:bg-hover"
                  >
                    <Check size={16} />
                  </button>
                  <button
                    type="button"
                    aria-label={`Reject: ${c.text}`}
                    title="Reject"
                    onClick={(e) => { e.stopPropagation(); onDecide(c.id, 'reject'); }}
                    className="flex h-7 w-7 items-center justify-center rounded-md text-danger-strong hover:bg-hover"
                  >
                    <X size={16} />
                  </button>
                </>
              )}
            </div>
            <button
              type="button"
              onClick={() => onActivate(c.id)}
              className="mt-1.5 block w-full text-left text-sm text-ink hover:underline"
            >
              {c.text}
            </button>
          </div>
        );
      })}
    </>
  );
}

/**
 * The cards placed on the page, the way comment pips are (CommentMarkers): each
 * beside the first line of its change, stacked in page order so none covers
 * another. With no margin to sit in — a phone, the task peek — each card goes
 * under its paragraph instead, and the paragraph makes room for it.
 */
export function SuggestionLayer({ s, container, canDecide, fullWidth }: {
  s: Suggestions;
  container: Element | null;
  canDecide: boolean;
  fullWidth?: boolean;
}) {
  const phone = useMediaQuery('(max-width: 767px)');
  const layer = useRef<HTMLDivElement>(null);
  const text = useRef<HTMLDivElement>(null);
  const reserved = useRef<HTMLElement[]>([]);
  const [inline, setInline] = useState(phone);
  const [, setTick] = useState(0);

  // Reflow moves every card: the page grows as it loads and re-centres on resize.
  useLayoutEffect(() => {
    if (!container) return;
    const bump = () => setTick((n) => n + 1);
    const ro = new ResizeObserver(bump);
    ro.observe(container);
    window.addEventListener('resize', bump);
    return () => { ro.disconnect(); window.removeEventListener('resize', bump); };
  }, [container]);

  // Room handed to a paragraph is handed back when the layer goes.
  useLayoutEffect(() => () => { for (const el of reserved.current) el.style.marginBottom = ''; }, []);

  useLayoutEffect(() => {
    // Last pass's room first: the cards it was for may be gone (decided).
    for (const el of reserved.current) el.style.marginBottom = '';
    reserved.current = [];
    const L = layer.current;
    const T = text.current;
    if (!L || !T || !container) return;
    // Room is measured from the text's right edge to the editor's.
    const want = cardsInline({ phone, textRight: T.getBoundingClientRect().right, areaRight: container.getBoundingClientRect().right });
    if (want !== inline) { setInline(want); return; }

    const cardEls = new Map([...L.querySelectorAll<HTMLElement>('[data-sugg-card]')].map((el) => [el.dataset.suggCard!, el]));
    const placed: { el: HTMLElement; top: number; height: number }[] = [];

    if (inline) {
      // Group under the last block each change touches, then make the room.
      const under = new Map<HTMLElement, HTMLElement[]>();
      for (const c of s.cards) {
        const el = cardEls.get(c.id);
        const block = container.querySelector<HTMLElement>(`[data-block-id="${CSS.escape(c.blockIds[c.blockIds.length - 1])}"]`);
        if (!el) continue;
        if (!block) { el.style.display = 'none'; continue; }
        el.style.display = '';
        under.set(block, [...(under.get(block) ?? []), el]);
      }
      for (const [block, els] of under) {
        block.style.marginBottom = `${els.reduce((h, el) => h + el.offsetHeight + GAP, GAP)}px`;
        reserved.current.push(block);
      }
      const base = L.getBoundingClientRect().top;
      for (const [block, els] of under) {
        let top = block.getBoundingClientRect().bottom - base + GAP;
        for (const el of els) { placed.push({ el, top, height: el.offsetHeight }); top += el.offsetHeight + GAP; }
      }
    } else {
      const base = L.getBoundingClientRect().top;
      for (const c of s.cards) {
        const el = cardEls.get(c.id);
        if (!el) continue;
        const first = elementsFor(container, c)[0];
        const r = first?.getClientRects()[0] ?? first?.getBoundingClientRect();
        // Not laid out (collapsed, another mode): hide rather than pile at the top.
        if (!r || !r.height) { el.style.display = 'none'; continue; }
        el.style.display = '';
        placed.push({ el, top: Math.round(r.top - base), height: el.offsetHeight });
      }
    }
    // Page order is already the order of s.cards; inline groups keep it per block.
    placed.sort((a, b) => a.top - b.top);
    stackCards(placed, GAP).forEach((top, i) => { placed[i].el.style.top = `${top}px`; });
  });

  // The active card comes into view: a click on its text, or next/previous.
  useLayoutEffect(() => {
    if (!s.active) return;
    layer.current?.querySelector(`[data-sugg-card="${CSS.escape(s.active)}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [s.active]);

  if (!s.cards.length) return null;

  return (
    <div ref={layer} className="pointer-events-none absolute inset-0 z-10">
      <div
        className={cn(
          'relative mx-auto h-full',
          fullWidth ? 'max-w-none px-[clamp(40px,7vw,120px)]' : 'max-w-[var(--reading-w)] px-6',
        )}
      >
        {/* The text column itself: margin cards start at its right edge,
            inline ones span it. */}
        <div ref={text} className="relative h-full">
        <SuggestionRail
          cards={s.cards}
          active={s.active}
          canDecide={canDecide}
          onDecide={s.decide}
          onHover={s.hover}
          onActivate={s.reveal}
          inline={inline}
        />
        </div>
      </div>
    </div>
  );
}
