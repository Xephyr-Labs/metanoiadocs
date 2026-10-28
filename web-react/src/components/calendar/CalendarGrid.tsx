/* Hallmark · redesign inside Workbench (app chrome) · project tokens preserved
 * states: event button default · hover · focus-visible · active · declined (disabled-look, still opens) · loading (page) · error (page) */
import { useLayoutEffect, useRef, type MouseEvent } from 'react';
import { meetingTime, type CalendarEvent } from '../../lib/calendarEvents';
import { allDayLanes, nowLineTop, positionTimed } from '../../lib/calendarLayout';
import { cn } from '../../lib/cn';

/** Where a new meeting was asked for: a day, and the minute it starts (null = all day). */
export interface Slot { day: string; minutes: number | null }

const HOUR = 48; // px per hour
const SNAP = 30; // minutes a click rounds down to
const MIN_H = 20; // shortest drawn block, px — a 10-minute meeting still needs a line of text

const utc = (day: string) => new Date(`${day}T00:00:00Z`);
const weekday = new Intl.DateTimeFormat(undefined, { weekday: 'short', timeZone: 'UTC' });
const hourLabel = new Intl.DateTimeFormat(undefined, { hour: 'numeric', timeZone: 'UTC' });

/** How an answer reads on a block: confirmed is filled, unanswered is outlined, declined is struck. */
export function eventTone(e: CalendarEvent): string {
  if (e.myResponse === 'declined') return 'bg-surface text-faint line-through ring-1 ring-inset ring-line';
  if (e.myResponse === 'needsAction' || e.myResponse === 'tentative') return 'bg-canvas text-accent-strong ring-1 ring-inset ring-accent';
  return 'bg-accent-soft text-accent-strong';
}

interface Props {
  days: string[];
  events: CalendarEvent[];
  zone: string;
  today: string;
  now: number;
  onOpen: (e: CalendarEvent) => void;
  /** Absent without write access: empty slots are then not clickable. */
  onCreate?: (slot: Slot) => void;
}

/** Day and week: an hour rail, one column per day, all-day bars pinned above. */
export function CalendarGrid({ days, events, zone, today, now, onOpen, onCreate }: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const cols = `3.25rem repeat(${days.length}, minmax(0, 1fr))`;
  const lanes = allDayLanes(events, days);
  const laneCount = Math.max(0, ...lanes.map((l) => l.lane + 1));
  const nowTop = nowLineTop(now, zone);

  // Open on the working day: an hour before now when today is in view, else 8:00.
  const key = days.join();
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const at = days.includes(today) ? Math.max(0, nowTop - 60) : 8 * 60;
    el.scrollTop = (at / 60) * HOUR;
  }, [key]); // only when the visible days change, not every minute the now-line moves

  const slotAt = (day: string) => (ev: MouseEvent<HTMLDivElement>) => {
    if (!onCreate || ev.target !== ev.currentTarget) return; // a click on a meeting opens it instead
    const y = ev.clientY - ev.currentTarget.getBoundingClientRect().top;
    const minutes = Math.min(24 * 60 - SNAP, Math.max(0, Math.floor((y / HOUR) * 60 / SNAP) * SNAP));
    onCreate({ day, minutes });
  };

  return (
    <div ref={scroller} className="scrollarea min-h-0 flex-1 overflow-y-auto overflow-x-clip">
      {/* Pinned: weekday row and all-day bars, in the scroller so the columns line up with the body's. */}
      <div className="sticky top-0 z-20 bg-canvas shadow-[inset_0_-1px_0_var(--line)]">
        <div className="grid" style={{ gridTemplateColumns: cols }}>
          <div />
          {days.map((d) => {
            const isToday = d === today;
            return (
              <div key={d} className="flex min-w-0 flex-col items-center gap-0.5 py-2">
                <span className={cn('text-2xs font-medium uppercase tracking-wide', isToday ? 'text-accent-strong' : 'text-faint')}>
                  {weekday.format(utc(d))}
                </span>
                <span
                  className={cn(
                    'flex h-7 min-w-7 items-center justify-center rounded-full px-1 text-md font-semibold tabular-nums',
                    isToday ? 'bg-accent-fill text-white' : 'text-ink',
                  )}
                  aria-current={isToday ? 'date' : undefined}
                >
                  {Number(d.slice(8))}
                </span>
              </div>
            );
          })}
        </div>
        <div className="grid pb-1" style={{ gridTemplateColumns: cols, gridTemplateRows: `repeat(${Math.max(1, laneCount)}, 22px)` }}>
          <div className="row-span-full flex items-start justify-end pr-2 pt-0.5 text-3xs text-faint" style={{ gridRow: `1 / span ${Math.max(1, laneCount)}` }}>
            all-day
          </div>
          {/* Empty all-day cells: a click there asks for an all-day meeting. */}
          {days.map((d, i) => (
            <div
              key={d}
              onClick={onCreate && (() => onCreate({ day: d, minutes: null }))}
              className={cn('border-l border-line', d === today && 'bg-surface-2', onCreate && 'cursor-cell')}
              style={{ gridColumn: i + 2, gridRow: `1 / span ${Math.max(1, laneCount)}` }}
            />
          ))}
          {lanes.map((l) => (
            <button
              key={`${l.event.id}-${l.lane}`}
              type="button"
              onClick={() => onOpen(l.event)}
              title={l.event.title}
              className={cn(
                'z-10 mx-0.5 my-px min-w-0 truncate rounded px-1.5 text-left text-2xs font-medium leading-5 transition-[filter] duration-120 hover:brightness-95 active:brightness-90',
                eventTone(l.event),
              )}
              style={{ gridColumn: `${l.col + 2} / span ${l.span}`, gridRow: l.lane + 1 }}
            >
              {l.event.title}
            </button>
          ))}
        </div>
      </div>

      <div className="relative grid" style={{ gridTemplateColumns: cols, height: 24 * HOUR }}>
        {/* Hour rail. The midnight label is left off: it would sit on the header's rule. */}
        <div className="relative">
          {Array.from({ length: 23 }, (_, i) => i + 1).map((h) => (
            <span
              key={h}
              className="absolute right-2 -translate-y-1/2 whitespace-nowrap text-3xs tabular-nums text-faint"
              style={{ top: h * HOUR }}
            >
              {hourLabel.format(Date.UTC(2000, 0, 1, h))}
            </span>
          ))}
        </div>
        {days.map((d) => {
          const isToday = d === today;
          return (
            <div
              key={d}
              onClick={slotAt(d)}
              className={cn('relative min-w-0 border-l border-line', isToday && 'bg-surface-2', onCreate && 'cursor-cell')}
              style={{ backgroundImage: `repeating-linear-gradient(to bottom, transparent 0 ${HOUR - 1}px, var(--line) ${HOUR - 1}px ${HOUR}px)` }}
            >
              {positionTimed(events, d, zone).map((p) => {
                const short = p.height < 45;
                return (
                  <button
                    key={p.event.id}
                    type="button"
                    onClick={() => onOpen(p.event)}
                    className={cn(
                      'absolute z-10 overflow-hidden rounded px-1.5 text-left shadow-[0_0_0_1px_var(--canvas)] transition-[filter] duration-120 hover:brightness-95 active:brightness-90',
                      short ? 'flex items-center gap-1 py-0' : 'py-1',
                      eventTone(p.event),
                    )}
                    style={{
                      top: (p.top / 60) * HOUR,
                      height: Math.max(MIN_H, (p.height / 60) * HOUR - 1),
                      left: `calc(${(p.col / p.cols) * 100}% + 1px)`,
                      width: `calc(${100 / p.cols}% - 3px)`,
                    }}
                  >
                    <span className={cn('block truncate text-2xs font-semibold', short && 'shrink-0 max-w-full')}>{p.event.title}</span>
                    <span className={cn('block truncate text-3xs opacity-90', short && 'min-w-0')}>{meetingTime(p.event, undefined, zone)}</span>
                  </button>
                );
              })}
              {isToday && (
                <div className="pointer-events-none absolute inset-x-0 z-20" style={{ top: (nowTop / 60) * HOUR }} aria-hidden>
                  <div className="absolute -left-1 -top-[5px] h-2.5 w-2.5 rounded-full bg-danger" />
                  <div className="h-0.5 -translate-y-1/2 bg-danger" />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
