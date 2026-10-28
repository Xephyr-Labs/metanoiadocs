import type { MouseEvent } from 'react';
import type { CalendarEvent } from '../../lib/calendarEvents';
import { positionTimed } from '../../lib/calendarLayout';
import { addDays } from '../../lib/gantt';
import { cn } from '../../lib/cn';
import { eventTone, type Slot } from './CalendarGrid';

const utc = (day: string) => new Date(`${day}T00:00:00Z`);
const weekday = new Intl.DateTimeFormat(undefined, { weekday: 'short', timeZone: 'UTC' });
const SHOWN = 3; // chips per cell before "+n more"

interface Props {
  cells: string[]; // 42 days
  month: string; // YYYY-MM of the month in view
  events: CalendarEvent[];
  zone: string;
  today: string;
  onOpen: (e: CalendarEvent) => void;
  onCreate?: (slot: Slot) => void;
  /** Open one day in the Day view (its date, or "+n more"). */
  onDay: (day: string) => void;
}

/** Every meeting touching `day`: all-day first, then by start. */
function eventsOn(events: CalendarEvent[], day: string, zone: string): CalendarEvent[] {
  const allDay = events.filter((e) => {
    if (!e.allDay || !e.start) return false;
    const from = e.start.slice(0, 10);
    const end = e.end ? e.end.slice(0, 10) : addDays(from, 1);
    return day >= from && day < (end > from ? end : addDays(from, 1));
  });
  const timed = positionTimed(events, day, zone).sort((a, b) => a.top - b.top).map((p) => p.event);
  return [...allDay, ...timed];
}

export function MonthGrid({ cells, month, events, zone, today, onOpen, onCreate, onDay }: Props) {
  const startTime = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZone: zone });
  const empty = (day: string) => (ev: MouseEvent<HTMLDivElement>) => {
    if (onCreate && ev.target === ev.currentTarget) onCreate({ day, minutes: null });
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-x-clip">
      <div className="grid shrink-0 grid-cols-[repeat(7,minmax(0,1fr))] shadow-[inset_0_-1px_0_var(--line)]">
        {cells.slice(0, 7).map((d) => (
          <span key={d} className="py-2 text-center text-2xs font-medium uppercase tracking-wide text-faint">{weekday.format(utc(d))}</span>
        ))}
      </div>
      <div className="grid min-h-0 flex-1 auto-rows-[minmax(5.5rem,1fr)] grid-cols-[repeat(7,minmax(0,1fr))] overflow-y-auto">
        {cells.map((d, i) => {
          const list = eventsOn(events, d, zone);
          const more = list.length - SHOWN;
          const outside = d.slice(0, 7) !== month;
          return (
            <div
              key={d}
              onClick={empty(d)}
              className={cn(
                'flex min-w-0 flex-col gap-px border-b border-line p-1',
                i % 7 !== 0 && 'border-l',
                outside && 'bg-surface-2',
              )}
            >
              <button
                type="button"
                onClick={() => onDay(d)}
                aria-label={`Open ${utc(d).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' })}`}
                aria-current={d === today ? 'date' : undefined}
                className={cn(
                  'mb-0.5 flex h-6 min-w-6 items-center justify-center self-center rounded-full px-1 text-2xs font-semibold tabular-nums transition-colors duration-120',
                  d === today ? 'bg-accent-fill text-white hover:bg-accent-fill-hover active:bg-accent-fill-active' : outside ? 'text-faint hover:bg-hover' : 'text-ink hover:bg-hover',
                )}
              >
                {Number(d.slice(8))}
              </button>
              {list.slice(0, more > 0 ? SHOWN - 1 : SHOWN).map((e) => (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => onOpen(e)}
                  title={e.title}
                  className={cn(
                    'block w-full min-w-0 truncate rounded px-1 text-left text-3xs font-medium leading-[18px] transition-[filter] duration-120 hover:brightness-95 active:brightness-90',
                    e.allDay ? eventTone(e) : cn('hover:bg-hover', e.myResponse === 'declined' ? 'text-faint line-through' : 'text-ink'),
                  )}
                >
                  {!e.allDay && e.start && <span className="mr-1 tabular-nums text-faint max-md:hidden">{startTime.format(new Date(e.start))}</span>}
                  {e.title}
                </button>
              ))}
              {more > 0 && (
                <button
                  type="button"
                  onClick={() => onDay(d)}
                  className="w-full truncate rounded px-1 text-left text-3xs font-medium leading-[18px] text-muted transition-colors duration-120 hover:bg-hover hover:text-ink"
                >
                  +{more + 1} more
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
