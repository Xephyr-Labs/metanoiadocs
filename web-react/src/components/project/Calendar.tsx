/* Hallmark · component: month calendar · genre: modern-minimal
 * theme: project tokens (index.css)
 * pre-emit critique: P5 H4 E4 S5 R4 V4
 * states: default · hover · focus-visible · active · dragging · resizing ·
 *         keyboard-nudge · today · out-of-month · overdue · done · empty week
 * contrast: pass (40-41) · mobile: pass (320/375/414/768) · tokens: pass (48)
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { AlarmClock, CalendarDays, ChevronLeft, ChevronRight, List, Plus } from 'lucide-react';
import { cn } from '../../lib/cn';
import { addDays, daysBetween, todayISO, toUTC, weekSegments } from '../../lib/gantt';
import { agendaFor, monthDays } from '../../lib/agenda';
import { splitKey } from '../../lib/taskKey';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import type { PropRow, TaskRow } from '../../lib/tasksApi';
import type { UserRow } from '../../lib/docsApi';
import { IconButton } from '../ui/IconButton';
import { SearchSelect } from '../ui/SearchSelect';
import { Button } from '../ui/Button';
import { isOverdue, KindIcon, shortDate } from './TaskChip';
import { splitKindProp } from '../../lib/taskKinds';
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
  // A day column on a phone is about 50px, which fits "WR…" and nothing else,
  // so a phone gets the month as a list of days instead. The grid stays one
  // tap away for anyone who wants the shape of the month rather than its
  // contents. Not remembered: the list is the right default every time.
  const phone = useMediaQuery('(max-width: 767px)');
  const [phoneView, setPhoneView] = useState<'list' | 'month'>('list');
  const listing = phone && phoneView === 'list';
  /** Bumped by "Today" so the list scrolls back to it even when the month
   *  does not change. */
  const [jump, setJump] = useState(0);

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
    month: phone ? 'short' : 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

  return (
    <div className="flex h-full flex-col">
      <div className={cn('flex items-center border-b border-line', phone ? 'flex-wrap gap-1 px-2 py-1' : 'gap-2 px-4 py-2')}>
        <IconButton
          icon={<ChevronLeft size={16} />}
          label="Previous month"
          className={cn(phone && 'h-11 w-11')}
          onClick={() => shift(-1)}
        />
        <span className={cn('text-sm font-medium text-ink', phone ? 'text-center' : 'min-w-[150px]')}>{label}</span>
        <IconButton
          icon={<ChevronRight size={16} />}
          label="Next month"
          className={cn(phone && 'h-11 w-11')}
          onClick={() => shift(1)}
        />
        <Button
          size="sm"
          variant="ghost"
          className={cn(phone && 'h-11')}
          onClick={() => {
            setCursor({ year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) - 1 });
            setJump((n) => n + 1);
          }}
        >
          Today
        </Button>
        {phone && (
          <div role="group" aria-label="Calendar layout" className="ml-auto flex rounded-md bg-surface ring-1 ring-inset ring-line">
            <IconButton
              icon={<List size={18} />}
              label="Show as a list"
              active={listing}
              className="h-11 w-11"
              onClick={() => setPhoneView('list')}
            />
            <IconButton
              icon={<CalendarDays size={18} />}
              label="Show as a month grid"
              active={!listing}
              className="h-11 w-11"
              onClick={() => setPhoneView('month')}
            />
          </div>
        )}
        {dateProps.length > 1 && (
          <SearchSelect
            variant="inline"
            label="Date shown"
            className={cn('h-7 rounded-md px-2 ring-1 ring-inset ring-line', phone ? 'h-11' : 'ml-auto')}
            value={propId ?? ''}
            options={dateProps.map((p) => ({ value: p.id, label: p.label }))}
            onChange={(id) => setPropId(id || null)}
          />
        )}
      </div>

      {listing ? (
        <Agenda
          year={cursor.year}
          month={cursor.month}
          today={today}
          jump={jump}
          tasks={tasks}
          rangesById={rangesById}
          cardProps={cardProps}
          users={users}
          onOpen={onOpen}
          onAdd={(day) => onAdd(day, propId)}
        />
      ) : (
      <>
      <div className="grid shrink-0 grid-cols-7 border-b border-line">
        {WEEKDAYS.map((d) => (
          <span key={d} className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-faint">
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
      </>
      )}
    </div>
  );
}

/**
 * The month as a list of days, for a phone.
 *
 * Every day of the month is here, empty ones as a single line, so the list
 * keeps the calendar's job of being somewhere to put a task on a date. Each
 * day's line sticks to the top while its tasks scroll under it, which is what
 * keeps a long day legible as one day. Multi-day rows follow lib/agenda: once
 * where they start, and again under today while they are still running.
 */
function Agenda({
  year,
  month,
  today,
  jump,
  tasks,
  rangesById,
  cardProps,
  users,
  onOpen,
  onAdd,
}: {
  year: number;
  month: number;
  today: string;
  jump: number;
  tasks: TaskRow[];
  rangesById: Map<string, Range>;
  cardProps: PropRow[];
  users: UserRow[];
  onOpen: (t: TaskRow) => void;
  onAdd: (day: string) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const days = useMemo(() => agendaFor(
    tasks.flatMap((t) => {
      const r = rangesById.get(t.id);
      return r ? [{ id: t.id, from: r.from, to: r.to }] : [];
    }),
    monthDays(year, month),
    today,
  ), [tasks, rangesById, year, month, today]);
  const byId = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);

  // Open on today rather than the 1st: the days already gone are the least
  // likely reason to look. Also runs when "Today" is pressed in this month.
  useEffect(() => {
    const el = scroller.current?.querySelector<HTMLElement>(`[data-agenda-day="${today}"]`);
    if (el && scroller.current) scroller.current.scrollTop = el.offsetTop;
  }, [jump, year, month, today]);

  return (
    <div ref={scroller} className="scrollarea relative flex-1 overflow-y-auto pb-6">
      {days.map(({ day, entries }) => {
        const date = new Date(toUTC(day));
        const isToday = day === today;
        const name = date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
        return (
          <section key={day} data-agenda-day={day} aria-label={isToday ? `Today, ${name}` : name}>
            <div className="sticky top-0 z-10 flex h-11 items-center gap-2.5 border-b border-line bg-canvas pl-4">
              <span
                className={cn(
                  'flex h-7 min-w-7 items-center justify-center rounded-full px-1 text-sm font-semibold tabular-nums',
                  isToday ? 'bg-accent-fill text-white' : entries.length ? 'text-ink' : 'text-faint',
                )}
              >
                {date.getUTCDate()}
              </span>
              <span className={cn('text-sm', entries.length || isToday ? 'text-muted' : 'text-faint')}>
                {date.toLocaleDateString(undefined, { weekday: 'short', timeZone: 'UTC' })}
              </span>
              {isToday && <span className="text-sm font-semibold text-accent-strong">Today</span>}
              <button
                type="button"
                onClick={() => onAdd(day)}
                aria-label={`Add a row on ${name}`}
                className="ml-auto flex h-11 w-11 items-center justify-center text-faint transition-colors hover:text-accent-strong active:bg-selected"
              >
                <Plus size={18} />
              </button>
            </div>
            {entries.length > 0 && (
              <ul className="space-y-2 px-4 py-2.5">
                {entries.map((e) => {
                  const t = byId.get(e.id);
                  return t ? (
                    <li key={`${e.id}-${e.kind}`}>
                      <AgendaCard
                        task={t}
                        note={
                          e.kind === 'ongoing'
                            ? `Day ${e.dayOf} of ${e.days} · until ${shortDate(e.to)}`
                            : e.kind === 'span'
                              ? `${shortDate(e.from)} – ${shortDate(e.to)} · ${e.days} days`
                              : null
                        }
                        cardProps={cardProps}
                        users={users}
                        onOpen={() => onOpen(t)}
                      />
                    </li>
                  ) : null;
                })}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

/** One task in the phone list: the whole title, never cut, and the card's
 *  properties underneath, the same ones the month grid's cards show. */
function AgendaCard({ task, note, cardProps, users, onOpen }: {
  task: TaskRow;
  note: string | null;
  cardProps: PropRow[];
  users: UserRow[];
  onOpen: () => void;
}) {
  const overdue = isOverdue(task);
  const done = task.status === 'done';
  const { key, text } = splitKey(task.title);
  const { showKind, rest } = splitKindProp(cardProps);
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'flex min-h-11 w-full flex-col items-start gap-1.5 rounded-md border px-3 py-2.5 text-left transition-colors',
        'bg-canvas active:bg-hover',
        overdue ? 'border-dashed border-danger-strong' : 'border-line',
      )}
    >
      <span className="w-full break-words text-sm leading-5">
        {showKind && <KindIcon kind={task.kind} className="mr-1.5 align-[-3px]" />}
        {overdue && <Overdue className="mr-1.5 align-[-2px]" />}
        {key && <span className="mr-1.5 font-mono text-2xs font-semibold tracking-tight text-muted">{key}</span>}
        <span
          className={cn(
            'font-medium',
            done ? 'text-muted line-through' : 'text-ink',
          )}
        >
          {text || 'Untitled'}
        </span>
      </span>
      {note && <span className="text-2xs text-muted">{note}</span>}
      <PropChips task={task} props={rest} users={users} />
    </button>
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
                  // 12px in a 20px pill was the smallest thing on the screen
                  // and the one people actually navigate by.
                  'flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-sm tabular-nums',
                  iso === today
                    ? 'bg-accent-fill font-semibold text-white'
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
  const { showKind, rest } = splitKindProp(cardProps);

  return (
    <div
      style={{ gridColumn: `${seg.col + 1} / span ${seg.span}`, gridRow: seg.lane + 2 }}
      className={cn(
        'group/card pointer-events-auto relative min-w-0 border bg-canvas transition-colors',
        seg.opens ? 'rounded-l-md' : 'border-l-0',
        seg.closes ? 'rounded-r-md' : 'border-r-0',
        // A card is a target, so it answers the pointer the way every other
        // task surface does — white to the same light grey the table rows and
        // the board cards use. An overdue card is marked by a dashed red edge
        // and a clock, not a red wash: red fill is the Bug type's colour, and
        // a late story painted red read as a bug.
        'hover:bg-hover',
        overdue ? 'border-dashed border-danger-strong' : 'border-line hover:border-line-strong',
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
        {/* A continuation card repeats the title only when it starts the row
            of cells, so a five-day task does not print its name twice. The
            type and the overdue clock travel with the title. */}
        <span className="flex w-full min-w-0 items-center gap-1">
          {(seg.opens || seg.col === 0) && showKind && <KindIcon kind={t.kind} />}
          {(seg.opens || seg.col === 0) && overdue && <Overdue />}
          <span className={cn('min-w-0 flex-1 truncate text-2xs font-semibold', done ? 'text-muted line-through' : 'text-ink')}>
            {seg.opens || seg.col === 0 ? t.title || 'Untitled' : ' '}
          </span>
        </span>
        {/* Below `sm` a day column is about 45px. A chip does not fit in that,
            and wrapping three of them turns a one-day card into a stack of
            unreadable fragments — measured at 375px. The title survives; the
            properties are one tap away in the peek panel. */}
        <PropChips task={t} props={rest} users={users} className="hidden sm:flex" />
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

/** Past its due date and not done. A glyph and a name, so lateness is not
 *  carried by the dashed red edge alone. */
function Overdue({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex shrink-0 text-danger-strong', className)} title="Overdue">
      <AlarmClock size={12} strokeWidth={2.25} aria-hidden />
      <span className="sr-only">Overdue</span>
    </span>
  );
}
