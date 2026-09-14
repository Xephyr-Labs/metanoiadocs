import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '../../lib/cn';
import { addDays, daysBetween, todayISO, toUTC, weekSegments } from '../../lib/gantt';
import type { PropRow, TaskRow } from '../../lib/tasksApi';
import { IconButton } from '../ui/IconButton';
import { Button } from '../ui/Button';
import { selectField } from '../ui/styles';
import { isOverdue } from './TaskChip';

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

/** Room for the date number, then three bars, then the "+N more" line. */
const HEADER_H = 24;
const BAR_H = 18;
const GAP = 2;
const LANES = 3;

interface Props {
  tasks: TaskRow[];
  /** Date properties this database has. Empty in a task database, where start
   *  and due dates are what a month grid lays rows out by. */
  dateProps: PropRow[];
  onOpen: (t: TaskRow) => void;
  /** Create a row on this date, through whichever field the calendar reads. */
  onAdd: (date: string, propId: string | null) => void;
  /**
   * Drag a row to another day. `date` is where the bar now starts; `days` is
   * its length in days when the task has a start date to keep, and null when
   * the due date is the only date it has.
   */
  onMove: (id: string, date: string, propId: string | null, days: number | null) => void;
}

/**
 * Rows laid out by date across a month. A task database reads start and due
 * dates and draws the whole range as a bar; a data database reads one of its
 * own date properties, picked in the header, which is a single day.
 *
 * A task running Monday to Friday is on the calendar all five days — showing
 * it only on its due date hides every day it is actually being worked on.
 */
export function Calendar({ tasks, dateProps, onOpen, onAdd, onMove }: Props) {
  const today = todayISO();
  const [cursor, setCursor] = useState(() => ({
    year: Number(today.slice(0, 4)),
    month: Number(today.slice(5, 7)) - 1,
  }));
  const [propId, setPropId] = useState<string | null>(dateProps[0]?.id ?? null);
  const [dragId, setDragId] = useState<string | null>(null);

  useEffect(() => {
    if (propId && !dateProps.some((p) => p.id === propId)) setPropId(dateProps[0]?.id ?? null);
  }, [dateProps, propId]);

  const days = useMemo(() => monthGrid(cursor.year, cursor.month), [cursor]);
  const weeks = useMemo(
    () => Array.from({ length: days.length / 7 }, (_, i) => days.slice(i * 7, i * 7 + 7)),
    [days],
  );

  /** The days a row occupies: a start..due range, or the single day a property holds. */
  const rangeOf = (t: TaskRow): { from: string; to: string; spans: boolean } | null => {
    if (propId) {
      const raw = t.props?.[propId];
      if (typeof raw !== 'string' || !raw) return null;
      const day = raw.slice(0, 10);
      return { from: day, to: day, spans: false };
    }
    const start = t.start_at?.slice(0, 10) ?? null;
    const due = t.due_at?.slice(0, 10) ?? null;
    if (!start && !due) return null;
    const a = start ?? due!;
    const b = due ?? start!;
    return a <= b ? { from: a, to: b, spans: !!start } : { from: b, to: a, spans: !!start };
  };

  const segsByWeek = useMemo(() => {
    const rows: { id: string; from: string; to: string }[] = [];
    const byId = new Map<string, TaskRow>();
    /** Length in days when the row has a start to keep; null when due is all it has. */
    const keep = new Map<string, number | null>();
    for (const t of tasks) {
      const r = rangeOf(t);
      if (!r) continue;
      rows.push({ id: t.id, from: r.from, to: r.to });
      byId.set(t.id, t);
      keep.set(t.id, r.spans ? daysBetween(r.from, r.to) + 1 : null);
    }
    return weeks.map((week) => {
      const all = weekSegments(rows, week[0]);
      const hidden = week.map((_, i) =>
        all.filter((s) => s.lane >= LANES && s.col <= i && i < s.col + s.span).length,
      );
      return { segs: all.filter((s) => s.lane < LANES).map((s) => ({ ...s, task: byId.get(s.id)! })), hidden, keep };
    });
  }, [tasks, propId, weeks]);

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
        {dateProps.length > 1 && (
          <select
            aria-label="Date shown"
            className={cn(selectField, 'ml-auto h-7 w-auto px-2 text-xs')}
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

      <div className="scrollarea flex flex-1 flex-col overflow-y-auto">
        {weeks.map((week, wi) => (
          <div key={week[0]} className="relative grid shrink-0 grid-cols-7">
            {week.map((iso, di) => {
              const inMonth = new Date(toUTC(iso)).getUTCMonth() === cursor.month;
              const hidden = segsByWeek[wi].hidden[di];
              return (
                <div
                  key={iso}
                  onClick={() => onAdd(iso, propId)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const id = e.dataTransfer.getData('text/plain');
                    if (id) onMove(id, iso, propId, segsByWeek[wi].keep.get(id) ?? null);
                    setDragId(null);
                  }}
                  className={cn(
                    'group relative min-h-[104px] cursor-pointer border-b border-r border-line p-1',
                    !inMonth && 'bg-surface',
                    dragId && 'hover:bg-hover',
                  )}
                >
                  <div className="flex items-center justify-between">
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
                      onClick={(e) => { e.stopPropagation(); onAdd(iso, propId); }}
                      className="rounded text-2xs text-faint opacity-0 transition-opacity hover:text-accent-strong focus-visible:opacity-100 group-hover:opacity-100"
                      aria-label={`Add a row on ${iso}`}
                    >
                      ＋
                    </button>
                  </div>
                  {hidden > 0 && (
                    <span className="absolute bottom-0.5 left-1.5 text-2xs text-faint">+{hidden} more</span>
                  )}
                </div>
              );
            })}

            {/* Bars float over the day cells so one row can cross them. The
                layer ignores pointer events; each bar takes its own back. */}
            <div className="pointer-events-none absolute inset-0">
              {segsByWeek[wi].segs.map((s) => {
                const overdue = isOverdue(s.task);
                return (
                  <button
                    key={`${s.task.id}-${s.col}`}
                    type="button"
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData('text/plain', s.task.id);
                      e.dataTransfer.effectAllowed = 'move';
                      setDragId(s.task.id);
                    }}
                    onDragEnd={() => setDragId(null)}
                    onClick={(e) => { e.stopPropagation(); onOpen(s.task); }}
                    title={s.task.title || 'Untitled'}
                    style={{
                      left: `calc(${(s.col / 7) * 100}% + ${s.opens ? 3 : 0}px)`,
                      width: `calc(${(s.span / 7) * 100}% - ${(s.opens ? 3 : 0) + (s.closes ? 3 : 0)}px)`,
                      top: HEADER_H + s.lane * (BAR_H + GAP),
                      height: BAR_H,
                    }}
                    className={cn(
                      'pointer-events-auto absolute flex items-center gap-1 overflow-hidden border px-1.5 text-left text-2xs transition-colors',
                      s.opens ? 'rounded-l' : 'border-l-0',
                      s.closes ? 'rounded-r' : 'border-r-0',
                      overdue
                        ? 'border-danger-soft bg-danger-soft text-danger hover:bg-danger-soft'
                        : s.task.status === 'done'
                          ? 'border-line bg-surface text-muted hover:bg-hover'
                          : 'border-line bg-canvas text-ink hover:bg-hover',
                    )}
                  >
                    <span
                      className={cn(
                        'h-1.5 w-1.5 shrink-0 rounded-full',
                        overdue ? 'bg-danger' : s.task.status === 'done' ? 'bg-line-strong' : 'bg-accent',
                      )}
                    />
                    <span className={cn('truncate', s.task.status === 'done' && 'line-through')}>
                      {s.opens || s.col === 0 ? s.task.title || 'Untitled' : ''}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
