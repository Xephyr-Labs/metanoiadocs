import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '../../lib/cn';
import { addDays, todayISO, toUTC } from '../../lib/gantt';
import type { PropRow, TaskRow } from '../../lib/tasksApi';
import { IconButton } from '../ui/IconButton';
import { Button } from '../ui/Button';
import { field } from '../ui/styles';
import { TaskChip } from './TaskChip';

/** Monday-first grid of whole weeks covering the given month. */
function monthGrid(year: number, month: number): string[] {
  const first = new Date(Date.UTC(year, month, 1));
  const lead = (first.getUTCDay() + 6) % 7; // Sunday=0 -> Monday-first
  const start = addDays(first.toISOString().slice(0, 10), -lead);
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cells = Math.ceil((lead + daysInMonth) / 7) * 7;
  return Array.from({ length: cells }, (_, i) => addDays(start, i));
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

interface Props {
  tasks: TaskRow[];
  /** Date properties this database has. Empty in a task database, where the
   *  due date is the only thing a month grid can lay rows out by. */
  dateProps: PropRow[];
  onOpen: (t: TaskRow) => void;
  /** Create a row on this date, through whichever field the calendar reads. */
  onAdd: (date: string, propId: string | null) => void;
  /** Drag a row to another day. Same field as onAdd writes. */
  onMove: (id: string, date: string, propId: string | null) => void;
}

/**
 * Rows laid out by date across a month. A task database reads the due date; a
 * data database reads one of its own date properties, picked in the header.
 *
 * Due date, not span — a month grid can't show one.
 */
export function Calendar({ tasks, dateProps, onOpen, onAdd, onMove }: Props) {
  const today = todayISO();
  const [cursor, setCursor] = useState(() => ({
    year: Number(today.slice(0, 4)),
    month: Number(today.slice(5, 7)) - 1,
  }));
  // null = the built-in due date. A data database has no due date, so it opens
  // on its first date property instead.
  const [propId, setPropId] = useState<string | null>(dateProps[0]?.id ?? null);
  const [dragId, setDragId] = useState<string | null>(null);

  // A property deleted while the calendar is open would otherwise leave it
  // reading a field that no longer exists.
  useEffect(() => {
    if (propId && !dateProps.some((p) => p.id === propId)) setPropId(dateProps[0]?.id ?? null);
  }, [dateProps, propId]);

  const dateOf = (t: TaskRow): string | null => {
    const raw = propId ? t.props?.[propId] : t.due_at;
    return typeof raw === 'string' && raw ? raw.slice(0, 10) : null;
  };

  const days = useMemo(() => monthGrid(cursor.year, cursor.month), [cursor]);
  const byDay = useMemo(() => {
    const m = new Map<string, TaskRow[]>();
    for (const t of tasks) {
      const day = dateOf(t);
      if (!day) continue;
      m.set(day, [...(m.get(day) ?? []), t]);
    }
    return m;
  }, [tasks, propId]);

  const shift = (n: number) => setCursor((c) => {
    const d = new Date(Date.UTC(c.year, c.month + n, 1));
    return { year: d.getUTCFullYear(), month: d.getUTCMonth() };
  });

  const label = new Date(Date.UTC(cursor.year, cursor.month, 1))
    .toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-line px-4 py-2">
        <IconButton icon={<ChevronLeft size={16} />} label="Previous month" onClick={() => shift(-1)} />
        <span className="min-w-[150px] text-sm font-medium text-ink">{label}</span>
        <IconButton icon={<ChevronRight size={16} />} label="Next month" onClick={() => shift(1)} />
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setCursor({ year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) - 1 })}
        >
          Today
        </Button>
        {/* Only worth a picker when there is a choice to make. */}
        {dateProps.length > 1 && (
          <select
            aria-label="Date shown"
            className={cn(field, 'ml-auto h-7 w-auto px-2 text-xs')}
            value={propId ?? ''}
            onChange={(e) => setPropId(e.target.value || null)}
          >
            {dateProps.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        )}
      </div>

      <div className="grid shrink-0 grid-cols-7 border-b border-line">
        {WEEKDAYS.map((d) => (
          <span key={d} className="px-2 py-1 text-2xs font-semibold uppercase tracking-wide text-faint">{d}</span>
        ))}
      </div>

      <div className="scrollarea grid flex-1 auto-rows-fr grid-cols-7 overflow-y-auto">
        {days.map((iso) => {
          const inMonth = new Date(toUTC(iso)).getUTCMonth() === cursor.month;
          const items = byDay.get(iso) ?? [];
          return (
            <div
              key={iso}
              // The whole cell creates, the way a calendar app does — the ＋ is
              // the visible affordance, not the only target. A click that
              // landed on a row inside the cell is that row's, so it stops
              // there and never reaches this handler.
              onClick={() => onAdd(iso, propId)}
              // The dragged row travels in the drag payload rather than in
              // state: a drop must not depend on a re-render having landed
              // between picking the row up and letting go of it.
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const id = e.dataTransfer.getData('text/plain');
                if (id) onMove(id, iso, propId);
                setDragId(null);
              }}
              className={cn(
                'group min-h-[92px] cursor-pointer border-b border-r border-line p-1',
                !inMonth && 'bg-surface',
                dragId && 'hover:bg-hover',
              )}
            >
              <div className="mb-1 flex items-center justify-between">
                <span
                  className={cn(
                    'flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-2xs',
                    iso === today ? 'bg-accent font-semibold text-white' : inMonth ? 'text-muted' : 'text-faint',
                  )}
                >
                  {Number(iso.slice(8, 10))}
                </span>
                {/* Shown on focus as well as hover: a keyboard or touch user
                    has no hover to give. */}
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onAdd(iso, propId); }}
                  className="rounded text-2xs text-faint opacity-0 transition-opacity hover:text-accent focus-visible:opacity-100 group-hover:opacity-100"
                  aria-label={`Add a row on ${iso}`}
                >
                  ＋
                </button>
              </div>
              <div className="space-y-0.5">
                {items.slice(0, 4).map((t) => (
                  <div
                    key={t.id}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData('text/plain', t.id);
                      e.dataTransfer.effectAllowed = 'move';
                      setDragId(t.id);
                    }}
                    onDragEnd={() => setDragId(null)}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <TaskChip task={t} compact onOpen={() => onOpen(t)} />
                  </div>
                ))}
                {items.length > 4 && (
                  <span className="block px-1 text-2xs text-faint">+{items.length - 4} more</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
