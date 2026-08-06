import { useMemo, useState } from 'react';
import { CalendarRange } from 'lucide-react';
import { cn } from '../../lib/cn';
import { barFor, dayX, rangeFor, ticksFor, todayISO } from '../../lib/gantt';
import type { TaskRow } from '../../lib/tasksApi';
import { EmptyState } from '../ui/EmptyState';
import { SegmentedControl } from '../ui/SegmentedControl';
import { isOverdue, shortDate } from './TaskChip';

const ROW_H = 32;
const NAME_W = 220;
const ZOOM: Record<string, { dayWidth: number; step: number }> = {
  days: { dayWidth: 26, step: 1 },
  weeks: { dayWidth: 9, step: 7 },
  months: { dayWidth: 3, step: 30 },
};

/**
 * Timeline. Bars are positioned divs over a CSS grid; dependency arrows and the
 * today line are one SVG overlay sharing the same pixel space. No gantt library
 * — it would bring its own DOM and styling world to fight with the theme.
 */
export function Gantt({ tasks, onOpen }: { tasks: TaskRow[]; onOpen: (t: TaskRow) => void }) {
  const [zoom, setZoom] = useState<keyof typeof ZOOM>('days');
  const { dayWidth, step } = ZOOM[zoom];
  const today = todayISO();

  // Undated tasks have nothing to draw; they live on the board instead.
  const rows = useMemo(
    () => tasks.filter((t) => t.start_at || t.due_at)
      .sort((a, b) => (a.start_at ?? a.due_at ?? '').localeCompare(b.start_at ?? b.due_at ?? '')),
    [tasks],
  );
  const range = useMemo(
    () => rangeFor(rows.map((t) => ({ start: t.start_at, due: t.due_at })), today),
    [rows, today],
  );

  if (!range) {
    return (
      <EmptyState
        icon={CalendarRange}
        title="Nothing scheduled"
        hint="Give a task a start or due date and it appears on the timeline."
      />
    );
  }

  const width = range.days * dayWidth;
  const height = rows.length * ROW_H;
  const ticks = ticksFor(range, dayWidth, step);
  const bars = new Map(
    rows.map((t, i) => [t.id, { ...barFor({ start: t.start_at, due: t.due_at }, range, dayWidth)!, row: i }]),
  );
  const todayX = dayX(today, range, dayWidth);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-line px-4 py-2">
        <span className="text-2xs text-faint">{rows.length} scheduled · {tasks.length - rows.length} undated</span>
        <SegmentedControl
          aria-label="Timeline zoom"
          value={zoom}
          onChange={(v) => setZoom(v as keyof typeof ZOOM)}
          segments={[{ value: 'days', label: 'Days' }, { value: 'weeks', label: 'Weeks' }, { value: 'months', label: 'Months' }]}
        />
      </div>

      <div className="scrollarea flex-1 overflow-auto">
        <div className="flex min-w-max">
          {/* task names — sticky so they survive a horizontal scroll */}
          <div className="sticky left-0 z-10 shrink-0 border-r border-line bg-canvas" style={{ width: NAME_W }}>
            <div className="h-8 border-b border-line" />
            {rows.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => onOpen(t)}
                style={{ height: ROW_H }}
                className="flex w-full items-center gap-1.5 px-3 text-left text-sm transition-colors hover:bg-hover"
              >
                <span className={cn('truncate', t.status === 'done' ? 'text-muted line-through' : 'text-ink')}>
                  {t.title || 'Untitled'}
                </span>
              </button>
            ))}
          </div>

          <div className="relative" style={{ width }}>
            {/* header ticks */}
            <div className="sticky top-0 z-10 h-8 border-b border-line bg-canvas">
              {ticks.map((t) => (
                <span
                  key={t.iso}
                  style={{ left: t.x }}
                  className={cn('absolute top-1.5 pl-1 text-2xs', t.major ? 'font-semibold text-muted' : 'text-faint')}
                >
                  {t.label}
                </span>
              ))}
            </div>

            <div className="relative" style={{ height }}>
              {/* column rules */}
              {ticks.map((t) => (
                <span
                  key={t.iso}
                  style={{ left: t.x, height }}
                  className={cn('absolute top-0 w-px', t.major ? 'bg-line-strong' : 'bg-line')}
                />
              ))}

              {/* bars */}
              {rows.map((t, i) => {
                const bar = bars.get(t.id)!;
                const late = isOverdue(t);
                return t.milestone ? (
                  <span
                    key={t.id}
                    onClick={() => onOpen(t)}
                    title={`${t.title} · ${shortDate(t.due_at ?? t.start_at)}`}
                    style={{ left: bar.x + dayWidth / 2 - 6, top: i * ROW_H + ROW_H / 2 - 6 }}
                    className="absolute h-3 w-3 rotate-45 cursor-pointer bg-accent"
                  />
                ) : (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => onOpen(t)}
                    title={`${t.title} · ${shortDate(t.start_at)} → ${shortDate(t.due_at)} · ${t.progress}%`}
                    style={{ left: bar.x, width: Math.max(bar.width, 4), top: i * ROW_H + 6 }}
                    // No `/opacity` modifiers here: the colour tokens are
                    // var()-based, and Tailwind silently drops the alpha on
                    // those, which renders an invisible bar.
                    className={cn(
                      'absolute h-5 overflow-hidden rounded text-left ring-1 ring-inset',
                      late ? 'bg-surface-2 ring-danger' : 'bg-accent-soft ring-accent',
                    )}
                  >
                    <span
                      className={cn('block h-full', late ? 'bg-danger' : 'bg-accent')}
                      style={{ width: `${t.progress}%` }}
                    />
                  </button>
                );
              })}

              {/* dependency arrows + today line share the bars' pixel space */}
              <svg className="pointer-events-none absolute inset-0" width={width} height={height}>
                <defs>
                  <marker id="gantt-arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                    <path d="M0,0 L6,3 L0,6 z" fill="var(--faint)" />
                  </marker>
                </defs>
                {rows.flatMap((t) =>
                  t.deps.map((depId) => {
                    const from = bars.get(depId);
                    const to = bars.get(t.id);
                    if (!from || !to) return null; // dep is undated, so off this chart
                    const x1 = from.x + from.width;
                    const y1 = from.row * ROW_H + ROW_H / 2;
                    const x2 = to.x;
                    const y2 = to.row * ROW_H + ROW_H / 2;
                    const mid = x1 + 8; // elbow just past the predecessor
                    return (
                      <polyline
                        key={`${depId}-${t.id}`}
                        points={`${x1},${y1} ${mid},${y1} ${mid},${y2} ${x2 - 2},${y2}`}
                        fill="none"
                        stroke="var(--faint)"
                        strokeWidth={1}
                        markerEnd="url(#gantt-arrow)"
                      />
                    );
                  }),
                )}
                <line x1={todayX} y1={0} x2={todayX} y2={height} stroke="var(--danger)" strokeWidth={1} strokeDasharray="3 3" />
              </svg>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
