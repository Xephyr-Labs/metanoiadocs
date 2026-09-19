/* Hallmark · component: month calendar · genre: modern-minimal
 * theme: project tokens (index.css)
 * pre-emit critique: P5 H4 E4 S5 R4 V4
 * states: default · hover · focus-visible · active · dragging · resizing ·
 *         keyboard-nudge · today · out-of-month · overdue · done · empty week
 * contrast: pass (40-41) · mobile: pass (320/375/414/768) · tokens: pass (48)
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '../../lib/cn';
import { addDays, daysBetween, todayISO, toUTC, weekSegments } from '../../lib/gantt';
import type { PropRow, TaskRow } from '../../lib/tasksApi';
import type { UserRow } from '../../lib/docsApi';
import { IconButton } from '../ui/IconButton';
import { SearchSelect } from '../ui/SearchSelect';
import { Button } from '../ui/Button';
import { isOverdue } from './TaskChip';
import { PropChips } from './props/PropChips';

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

/** A week with nothing in it. Tall enough to be a week, short enough that six
 *  empty ones don't push the month off the screen. */
const MIN_WEEK = 92;

interface Range {
  from: string;
  to: string;
  /** The row has a real start date, so it is a span rather than a single day. */
  spans: boolean;
}

interface Props {
  tasks: TaskRow[];
  /** Date properties this database has. Empty in a task database, where start
   *  and due dates are what a month grid lays rows out by. */
  dateProps: PropRow[];
  /** Properties to show on each card, already ordered by the view's settings. */
  cardProps: PropRow[];
  users: UserRow[];
  onOpen: (t: TaskRow) => void;
  /** Create a row on this date, through whichever field the calendar reads. */
  onAdd: (date: string, propId: string | null) => void;
  /**
   * Drag a row to another day. `date` is where the bar now starts; `days` is
   * its length in days when the task has a start date to keep, and null when
   * the due date is the only date it has.
   */
  onMove: (id: string, date: string, propId: string | null, days: number | null) => void;
  /** Drag an edge: the row now runs `from`..`to` inclusive. */
  onResize: (id: string, from: string, to: string) => void;
}

/**
 * Rows laid out by date across a month. A task database reads start and due
 * dates and draws the whole range as a card; a data database reads one of its
 * own date properties, picked in the header, which is a single day.
 *
 * A task running Monday to Friday is on the calendar all five days — showing
 * it only on its due date hides every day it is actually being worked on.
 *
 * Each week is two stacked grids: day cells underneath for the borders, the
 * date numbers and the click target, and the cards on top placed by column and
 * lane. The cards grid is what has height — so a week with four stacked cards
 * grows to fit them and an empty week stays short, instead of every week being
 * the same fixed box with "+2 more" hiding the rest.
 */
export function Calendar({
  tasks,
  dateProps,
  cardProps,
  users,
  onOpen,
  onAdd,
  onMove,
  onResize,
}: Props) {
  const today = todayISO();
  const [cursor, setCursor] = useState(() => ({
    year: Number(today.slice(0, 4)),
    month: Number(today.slice(5, 7)) - 1,
  }));
  const [propId, setPropId] = useState<string | null>(dateProps[0]?.id ?? null);
  const [dragId, setDragId] = useState<string | null>(null);
  /** Live range while an edge is being dragged, so the card resizes under the
   *  pointer instead of jumping when it is let go. */
  const [draft, setDraft] = useState<{ id: string; from: string; to: string } | null>(null);

  useEffect(() => {
    if (propId && !dateProps.some((p) => p.id === propId)) setPropId(dateProps[0]?.id ?? null);
  }, [dateProps, propId]);

  const days = useMemo(() => monthGrid(cursor.year, cursor.month), [cursor]);
  const weeks = useMemo(
    () => Array.from({ length: days.length / 7 }, (_, i) => days.slice(i * 7, i * 7 + 7)),
    [days],
  );

  /** The days a row occupies: a start..due range, or the single day a property holds. */
  const rangeOf = (t: TaskRow): Range | null => {
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

  // Only a start/due range can be dragged longer or shorter. A date property
  // holds one day; there is no second edge to pull.
  const resizable = propId === null;

  const { rangesById, segsByWeek } = useMemo(() => {
    const rows: { id: string; from: string; to: string }[] = [];
    const byId = new Map<string, TaskRow>();
    const ranges = new Map<string, Range>();
    for (const t of tasks) {
      const base = rangeOf(t);
      if (!base) continue;
      // While an edge is being dragged the draft range wins, so the card and
      // the lane packing move together rather than the card sliding over a
      // layout computed from the old dates.
      const r = draft && draft.id === t.id ? { ...base, from: draft.from, to: draft.to } : base;
      rows.push({ id: t.id, from: r.from, to: r.to });
      byId.set(t.id, t);
      ranges.set(t.id, r);
    }
    return {
      rangesById: ranges,
      segsByWeek: weeks.map((week) =>
        weekSegments(rows, week[0]).map((s) => ({ ...s, task: byId.get(s.id)! })),
      ),
    };
  }, [tasks, propId, weeks, draft]);

  const shift = (n: number) =>
    setCursor((c) => {
      const d = new Date(Date.UTC(c.year, c.month + n, 1));
      return { year: d.getUTCFullYear(), month: d.getUTCMonth() };
    });

  const label = new Date(Date.UTC(cursor.year, cursor.month, 1)).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

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
          <SearchSelect
            variant="inline"
            label="Date shown"
            className="ml-auto h-7 rounded-md px-2 ring-1 ring-inset ring-line"
            value={propId ?? ''}
            options={dateProps.map((p) => ({ value: p.id, label: p.label }))}
            onChange={(id) => setPropId(id || null)}
          />
        )}
      </div>

      <div className="grid shrink-0 grid-cols-7 border-b border-line">
        {WEEKDAYS.map((d) => (
          <span key={d} className="px-2 py-1 text-2xs font-semibold uppercase tracking-wide text-faint">
            {d}
          </span>
        ))}
      </div>

      <div className="scrollarea flex flex-1 flex-col overflow-y-auto">
        {weeks.map((week, wi) => (
          <Week
            key={week[0]}
            week={week}
            month={cursor.month}
            today={today}
            segs={segsByWeek[wi]}
            rangesById={rangesById}
            cardProps={cardProps}
            users={users}
            propId={propId}
            resizable={resizable}
            dragId={dragId}
            draft={draft}
            setDragId={setDragId}
            setDraft={setDraft}
            onOpen={onOpen}
            onAdd={onAdd}
            onMove={onMove}
            onResize={onResize}
          />
        ))}
      </div>
    </div>
  );
}

type Seg = ReturnType<typeof weekSegments>[number] & { task: TaskRow };

function Week({
  week,
  month,
  today,
  segs,
  rangesById,
  cardProps,
  users,
  propId,
  resizable,
  dragId,
  draft,
  setDragId,
  setDraft,
  onOpen,
  onAdd,
  onMove,
  onResize,
}: {
  week: string[];
  month: number;
  today: string;
  segs: Seg[];
  rangesById: Map<string, Range>;
  cardProps: PropRow[];
  users: UserRow[];
  propId: string | null;
  resizable: boolean;
  dragId: string | null;
  draft: { id: string; from: string; to: string } | null;
  setDragId: (id: string | null) => void;
  setDraft: (d: { id: string; from: string; to: string } | null) => void;
  onOpen: Props['onOpen'];
  onAdd: Props['onAdd'];
  onMove: Props['onMove'];
  onResize: Props['onResize'];
}) {
  const grid = useRef<HTMLDivElement>(null);

  /**
   * The day under a pointer, anywhere in the month.
   *
   * Hit-tested rather than measured off this week's rectangle: a range being
   * dragged longer does not stop at Sunday, and column arithmetic on one week
   * can only ever answer with one of that week's seven days — so pulling an
   * edge down into the next row used to pin the date to the Sunday above it
   * and look stuck. Every day cell carries its own date, and the whole stack
   * under the pointer is searched because the cards grid is painted over them.
   *
   * Off the grid entirely (the header, the gap past the last week) there is
   * nothing to name, so this falls back to the old clamp and the edge simply
   * stays inside the week it started in.
   */
  const dayAt = (clientX: number, clientY: number): string => {
    for (const el of document.elementsFromPoint(clientX, clientY)) {
      const iso = el.getAttribute('data-day');
      if (iso) return iso;
    }
    const rect = grid.current?.getBoundingClientRect();
    if (!rect) return week[0];
    const i = Math.floor(((clientX - rect.left) / rect.width) * 7);
    return week[Math.min(6, Math.max(0, i))];
  };

  const startResize = (e: React.PointerEvent, task: TaskRow, edge: 'from' | 'to') => {
    // Stop the card's own drag-to-move from starting: a pointer on the grip is
    // a resize, and letting both run moves the row AND changes its length.
    e.preventDefault();
    e.stopPropagation();
    const base = rangesById.get(task.id);
    if (!base) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setDraft({ id: task.id, from: base.from, to: base.to });

    const move = (ev: PointerEvent) => {
      const day = dayAt(ev.clientX, ev.clientY);
      setDraft(
        edge === 'from'
          ? { id: task.id, from: day <= base.to ? day : base.to, to: base.to }
          : { id: task.id, from: base.from, to: day >= base.from ? day : base.from },
      );
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      const day = dayAt(ev.clientX, ev.clientY);
      const next =
        edge === 'from'
          ? { from: day <= base.to ? day : base.to, to: base.to }
          : { from: base.from, to: day >= base.from ? day : base.from };
      setDraft(null);
      if (next.from !== base.from || next.to !== base.to) onResize(task.id, next.from, next.to);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  /** Keyboard equivalent of dragging an edge: one day per press. */
  const nudge = (task: TaskRow, edge: 'from' | 'to', by: -1 | 1) => {
    const base = rangesById.get(task.id);
    if (!base) return;
    const next =
      edge === 'from'
        ? { from: addDays(base.from, by), to: base.to }
        : { from: base.from, to: addDays(base.to, by) };
    // An edge never crosses the other one — a row cannot end before it starts.
    if (next.from > next.to) return;
    onResize(task.id, next.from, next.to);
  };

  const lanes = segs.reduce((n, s) => Math.max(n, s.lane + 1), 0);

  return (
    <div className="relative">
      {/* Day cells underneath: borders, the date number's background, the click
          target for adding, and the drop target for a moved row. */}
      <div className="absolute inset-0 grid grid-cols-7">
        {week.map((iso) => {
          const inMonth = new Date(toUTC(iso)).getUTCMonth() === month;
          return (
            <div
              key={iso}
              data-day={iso}
              onClick={() => onAdd(iso, propId)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const id = e.dataTransfer.getData('text/plain');
                const r = id ? rangesById.get(id) : null;
                if (id) onMove(id, iso, propId, r?.spans ? daysBetween(r.from, r.to) + 1 : null);
                setDragId(null);
              }}
              className={cn(
                'cursor-pointer border-b border-r border-line transition-colors',
                !inMonth && 'bg-surface',
                dragId && 'hover:bg-accent-soft',
              )}
            />
          );
        })}
      </div>

      {/* Cards on top. This grid is what has height, so the week grows with the
          number of lanes. It ignores the pointer so the cells underneath stay
          clickable; each card and each add button takes its own back. */}
      <div
        ref={grid}
        style={{ minHeight: MIN_WEEK, gridTemplateRows: `auto repeat(${lanes}, min-content)` }}
        className="pointer-events-none relative grid grid-cols-7 gap-x-1 gap-y-1.5 px-1 pb-2"
      >
        {week.map((iso, i) => {
          const inMonth = new Date(toUTC(iso)).getUTCMonth() === month;
          return (
            <div
              key={iso}
              style={{ gridColumn: i + 1, gridRow: 1 }}
              className="group/day flex items-center justify-between py-1"
            >
              <span
                className={cn(
                  'flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-2xs',
                  iso === today
                    ? 'bg-accent font-semibold text-white'
                    : inMonth
                      ? 'text-muted'
                      : 'text-faint',
                )}
              >
                {Number(iso.slice(8, 10))}
              </span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onAdd(iso, propId);
                }}
                className="pointer-events-auto rounded text-2xs text-faint opacity-0 transition-opacity hover:text-accent-strong focus-visible:opacity-100 group-hover/day:opacity-100"
                aria-label={`Add a row on ${iso}`}
              >
                ＋
              </button>
            </div>
          );
        })}

        {segs.map((s) => (
          <Card
            key={`${s.task.id}-${s.col}`}
            seg={s}
            cardProps={cardProps}
            users={users}
            resizing={draft?.id === s.task.id}
            canResize={resizable}
            onOpen={onOpen}
            onDragStart={() => setDragId(s.task.id)}
            onDragEnd={() => setDragId(null)}
            onGrip={startResize}
            onNudge={nudge}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * One row's card for one week.
 *
 * The title is always drawn; the properties under it are whatever the view is
 * set to show, so the card's height is a consequence of that choice. A row
 * crossing a week boundary is two cards, each flat on the side it continues
 * past, and only the real edges get a resize grip — you cannot drag the start
 * date from the segment that does not contain it.
 */
function Card({
  seg,
  cardProps,
  users,
  resizing,
  canResize,
  onOpen,
  onDragStart,
  onDragEnd,
  onGrip,
  onNudge,
}: {
  seg: Seg;
  cardProps: PropRow[];
  users: UserRow[];
  resizing: boolean;
  canResize: boolean;
  onOpen: (t: TaskRow) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onGrip: (e: React.PointerEvent, task: TaskRow, edge: 'from' | 'to') => void;
  onNudge: (task: TaskRow, edge: 'from' | 'to', by: -1 | 1) => void;
}) {
  const t = seg.task;
  const overdue = isOverdue(t);
  const done = t.status === 'done';

  return (
    <div
      style={{ gridColumn: `${seg.col + 1} / span ${seg.span}`, gridRow: seg.lane + 2 }}
      className={cn(
        'group/card pointer-events-auto relative min-w-0 border bg-canvas transition-colors',
        seg.opens ? 'rounded-l-md' : 'border-l-0',
        seg.closes ? 'rounded-r-md' : 'border-r-0',
        // A card is a target, so it answers the pointer the way every other
        // task surface does — white to the same light grey the table rows and
        // the board cards use. An overdue card keeps its tint: the warning is
        // the point of it, and a hover state that paints over it reads as the
        // row having been fixed.
        overdue ? 'border-danger-soft bg-danger-soft' : 'border-line hover:border-line-strong hover:bg-hover',
        resizing && 'ring-1 ring-accent',
      )}
    >
      <button
        type="button"
        draggable={!resizing}
        onDragStart={(e) => {
          e.dataTransfer.setData('text/plain', t.id);
          e.dataTransfer.effectAllowed = 'move';
          onDragStart();
        }}
        onDragEnd={onDragEnd}
        onClick={(e) => {
          e.stopPropagation();
          onOpen(t);
        }}
        title={t.title || 'Untitled'}
        className="flex w-full min-w-0 cursor-pointer flex-col items-start gap-1 px-2 py-1.5 text-left"
      >
        <span
          className={cn(
            'w-full truncate text-2xs font-semibold',
            done ? 'text-muted line-through' : overdue ? 'text-danger-strong' : 'text-ink',
          )}
        >
          {/* A continuation card repeats the title only when it starts the row
              of cells, so a five-day task doesn't print its name twice. */}
          {seg.opens || seg.col === 0 ? t.title || 'Untitled' : ' '}
        </span>
        {/* Below `sm` a day column is about 45px. A chip does not fit in that,
            and wrapping three of them turns a one-day card into a stack of
            unreadable fragments — measured at 375px. The title survives; the
            properties are one tap away in the peek panel. */}
        <PropChips task={t} props={cardProps} users={users} className="hidden sm:flex" />
      </button>

      {canResize && seg.opens && (
        <Grip
          side="left"
          label={`Start date of ${t.title || 'this row'}`}
          onPointerDown={(e) => onGrip(e, t, 'from')}
          onNudge={(by) => onNudge(t, 'from', by)}
        />
      )}
      {canResize && seg.closes && (
        <Grip
          side="right"
          label={`Due date of ${t.title || 'this row'}`}
          onPointerDown={(e) => onGrip(e, t, 'to')}
          onNudge={(by) => onNudge(t, 'to', by)}
        />
      )}
    </div>
  );
}

/**
 * The edge you pull.
 *
 * A real button, not a decorated span: dragging is the fast path, but a date
 * is not a mouse-only property. Arrow keys move the edge a day at a time, so
 * the same edit is reachable from the keyboard — and the control can be
 * focused, which a span with a pointer handler never could.
 *
 * At rest it is a hairline the width of the card's own border, so a month of
 * cards is not a month of handles; hover and focus promote it to a grip.
 */
function Grip({
  side,
  label,
  onPointerDown,
  onNudge,
}: {
  side: 'left' | 'right';
  label: string;
  onPointerDown: (e: React.PointerEvent) => void;
  onNudge: (by: -1 | 1) => void;
}) {
  return (
    <button
      type="button"
      aria-label={`${label} — drag, or use the arrow keys`}
      onPointerDown={onPointerDown}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault();
        e.stopPropagation();
        onNudge(e.key === 'ArrowLeft' ? -1 : 1);
      }}
      className={cn(
        'group/grip absolute inset-y-0 flex w-2.5 cursor-ew-resize items-center justify-center',
        'focus-visible:outline-none',
        side === 'left' ? '-left-px' : '-right-px',
      )}
    >
      <span
        className={cn(
          // Invisible at rest → hairline when the card is hovered → accent when
          // the grip itself has the pointer or focus. Colour and scale only:
          // animating the width would animate layout, which reflows the row.
          'h-[calc(100%-6px)] w-[3px] origin-center scale-x-50 rounded-full bg-transparent',
          'transition-[background-color,transform] duration-150 ease-out',
          'group-hover/card:bg-line-strong',
          'group-hover/grip:scale-x-100 group-hover/grip:bg-accent',
          'group-focus-visible/grip:scale-x-100 group-focus-visible/grip:bg-accent',
          'group-active/grip:bg-accent-strong',
          'motion-reduce:transition-none',
        )}
      />
      {/* The focus ring goes on a ring element rather than the 10px-wide button,
          so a keyboard user sees the edge they are about to move, not a sliver. */}
      <span className="pointer-events-none absolute inset-y-0 -inset-x-0.5 rounded-sm ring-accent group-focus-visible/grip:ring-2" />
    </button>
  );
}
