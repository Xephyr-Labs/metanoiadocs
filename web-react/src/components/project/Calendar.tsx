import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '../../lib/cn';
import { addDays, todayISO, toUTC } from '../../lib/gantt';
import type { TaskRow } from '../../lib/tasksApi';
import { IconButton } from '../ui/IconButton';
import { Button } from '../ui/Button';
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

/** Tasks laid out by due date. Due date, not span — a month grid can't show one. */
export function Calendar({ tasks, onOpen, onAdd }: {
  tasks: TaskRow[];
  onOpen: (t: TaskRow) => void;
  onAdd: (dueAt: string) => void;
}) {
  const today = todayISO();
  const [cursor, setCursor] = useState(() => ({
    year: Number(today.slice(0, 4)),
    month: Number(today.slice(5, 7)) - 1,
  }));

  const days = useMemo(() => monthGrid(cursor.year, cursor.month), [cursor]);
  const byDay = useMemo(() => {
    const m = new Map<string, TaskRow[]>();
    for (const t of tasks) {
      if (!t.due_at) continue;
      const k = t.due_at.slice(0, 10);
      m.set(k, [...(m.get(k) ?? []), t]);
    }
    return m;
  }, [tasks]);

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
              className={cn(
                'group min-h-[92px] border-b border-r border-line p-1',
                !inMonth && 'bg-surface',
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
                <button
                  type="button"
                  onClick={() => onAdd(iso)}
                  className="text-2xs text-faint opacity-0 transition-opacity hover:text-accent group-hover:opacity-100"
                  aria-label={`Add task due ${iso}`}
                >
                  ＋
                </button>
              </div>
              <div className="space-y-0.5">
                {items.slice(0, 4).map((t) => (
                  <TaskChip key={t.id} task={t} compact onOpen={() => onOpen(t)} />
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
