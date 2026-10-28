/* Hallmark · redesign inside Workbench (app chrome) · project tokens preserved · pre-emit critique: P4 H4 E4 S4 R5 V3
 * states: toolbar buttons default · hover · focus-visible · active · disabled (New meeting without write access, tooltip) ·
 * loading (aria-live "Loading…") · error ("Couldn't load" + Try again) · reconnect / connect lines */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { calendarApi, wantSettingsSection, type CalendarStatus } from '../../lib/calendar';
import { calendarPageView, fetchEventsRange, type CalendarEvent, type CalendarEvents } from '../../lib/calendarEvents';
import { dayIn, daysIn, monthCells, rangeFor, type CalendarView } from '../../lib/calendarLayout';
import { docsApi } from '../../lib/docsApi';
import { addDays } from '../../lib/gantt';
import { useAuth } from '../../store/auth';
import { useWorkspace } from '../../store/workspace';
import { Button } from '../ui/Button';
import { IconButton } from '../ui/IconButton';
import { SegmentedControl } from '../ui/SegmentedControl';
import { Tooltip } from '../ui/Tooltip';
import { CalendarGrid, type Slot } from './CalendarGrid';
import { EventCard } from './EventCard';
import { MonthGrid } from './MonthGrid';

const VIEWS = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
];

const utc = (day: string) => new Date(`${day}T00:00:00Z`);
const fmt = (day: string, o: Intl.DateTimeFormatOptions) => utc(day).toLocaleDateString(undefined, { ...o, timeZone: 'UTC' });

/** "October 2026", "Oct 26 – Nov 1, 2026", "Tuesday, October 27, 2026". */
function rangeLabel(view: CalendarView, anchor: string, from: string, to: string, short: boolean): string {
  if (view === 'month') return fmt(anchor, { month: 'long', year: 'numeric' });
  if (view === 'day') return fmt(anchor, short ? { weekday: 'short', month: 'short', day: 'numeric' } : { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const last = addDays(to, -1);
  const sameMonth = from.slice(0, 7) === last.slice(0, 7);
  return `${fmt(from, { month: 'short', day: 'numeric' })} – ${fmt(last, sameMonth ? { day: 'numeric' } : { month: 'short', day: 'numeric' })}${short ? '' : `, ${last.slice(0, 4)}`}`;
}

/** Day ±1, week ±7, month to the 1st of the next or previous one. */
function step(view: CalendarView, anchor: string, dir: 1 | -1): string {
  if (view === 'day') return addDays(anchor, dir);
  if (view === 'week') return addDays(anchor, 7 * dir);
  const d = utc(anchor);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + dir, 1)).toISOString().slice(0, 10);
}

/** What the editor opens on: a meeting to change, or a slot (or nothing) for a new one. */
export type EditorTarget = { event: CalendarEvent } | { slot: Slot | null };

/** Your own primary Google Calendar: day, week and month, with the meeting card. */
export function CalendarPage() {
  const ws = useWorkspace();
  const auth = useAuth();
  const zone = auth.user?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const phone = useMediaQuery('(max-width: 767px)');
  const [view, setView] = useState<CalendarView>('week');
  // Day when the column is too narrow for seven readable days — a phone, or a laptop with the
  // sidebar and side panel open. Decided once, on arrival; the switch is yours after that.
  const page = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { if ((page.current?.clientWidth ?? 1000) < 640) setView('day'); }, []);
  const [now, setNow] = useState(() => Date.now());
  const today = dayIn(now, zone);
  const [anchor, setAnchor] = useState(today);
  // null while the first ask is on its way; 'failed' when it could not be asked.
  const [status, setStatus] = useState<CalendarStatus | null | 'failed'>(null);
  const [data, setData] = useState<CalendarEvents | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const seq = useRef(0);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    docsApi.users().then((u) => setNames(new Map(u.map((r) => [r.id, r.name || r.username])))).catch(() => {});
  }, []);

  const { from, to } = rangeFor(view, anchor);
  const load = useCallback(async () => {
    const n = ++seq.current;
    const s = await calendarApi.status().catch(() => 'failed' as const);
    if (n !== seq.current) return;
    setStatus(s);
    if (s === 'failed' || !s.available) { setData(null); return; }
    // Asked even when status says not connected: events knows if a dead token was dropped.
    const d = await fetchEventsRange(from, to, { declined: true });
    if (n === seq.current) setData(d);
  }, [from, to]);
  useEffect(() => { setData(null); void load(); }, [load]);

  // Where Edit, New meeting and a click on an empty slot lead: the meeting editor plugs in here.
  const openEditor = useCallback((target: EditorTarget) => { void target; }, []);

  const events = data?.events ?? [];
  const open = useMemo(() => events.find((e) => e.id === openId) ?? null, [events, openId]);
  const shown = calendarPageView(status, data);
  const known = status && status !== 'failed' ? status : null;
  // A load that failed or is under way does not stop a write; a dead token does.
  const canWrite = !!known?.canWrite && shown !== 'reconnect';
  const settings = () => { wantSettingsSection('mycalendar'); ws.setSettingsOpen(true); };
  const label = rangeLabel(view, anchor, from, to, phone);

  // Not drawn until the status says whether you may write: no flash of a disabled button.
  const newButton = !known ? null : canWrite ? (
    phone
      ? <IconButton icon={<Plus size={18} />} label="New meeting" className="h-8 w-8" onClick={() => openEditor({ slot: null })} />
      : <Button size="sm" variant="primary" leftIcon={<Plus size={14} />} onClick={() => openEditor({ slot: null })}>New meeting</Button>
  ) : (
    <Tooltip label="Reconnect your calendar to send invites">
      {/* A disabled button takes no pointer events, so the wrapper carries the tooltip. */}
      <span tabIndex={0} className="inline-flex rounded-md">
        {phone
          ? <Button size="sm" variant="primary" disabled aria-label="New meeting" className="w-8 px-0"><Plus size={16} /></Button>
          : <Button size="sm" variant="primary" disabled leftIcon={<Plus size={14} />}>New meeting</Button>}
      </span>
    </Tooltip>
  );
  const nav = (
    <div className="flex items-center gap-1">
      <Button size="sm" onClick={() => setAnchor(today)}>Today</Button>
      <IconButton icon={<ChevronLeft size={16} />} label={`Previous ${view}`} onClick={() => setAnchor((a) => step(view, a, -1))} />
      <IconButton icon={<ChevronRight size={16} />} label={`Next ${view}`} onClick={() => setAnchor((a) => step(view, a, 1))} />
    </div>
  );
  const views = <SegmentedControl aria-label="Calendar view" segments={VIEWS} value={view} onChange={(v) => setView(v as CalendarView)} />;
  const loading = <span aria-live="polite" className="text-xs text-faint">{shown === 'loading' ? 'Loading…' : ''}</span>;

  if (shown === 'hidden') {
    return <p className="p-6 text-sm text-muted">Google Calendar isn't set up on this workspace.</p>;
  }
  if (shown === 'connect') {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-muted">
        <CalendarDays size={16} aria-hidden />
        <button type="button" className="text-accent-strong hover:underline" onClick={settings}>Connect your calendar</button>
        <span>to see your meetings here.</span>
      </div>
    );
  }

  return (
    <div ref={page} className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-line px-4 py-2.5">
        {phone ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <h1 className="min-w-0 flex-1 truncate text-lg font-semibold text-ink">{label}</h1>
              {loading}
              {newButton}
            </div>
            <div className="flex items-center justify-between gap-2">{nav}{views}</div>
          </div>
        ) : (
          // Wraps rather than clips: with the sidebar or the side panel open the column can be
          // phone-narrow on a desktop, and the view switch and New meeting drop to a second row.
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            {nav}
            <h1 className="min-w-0 grow truncate text-lg font-semibold text-ink">{label}</h1>
            {loading}
            <div className="ml-auto flex min-w-0 flex-wrap items-center gap-2">{views}{newButton}</div>
          </div>
        )}
      </div>

      {(shown === 'reconnect' || shown === 'error') && (
        <div role="status" className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line bg-surface-2 px-4 py-2 text-sm text-muted">
          <span className="min-w-0 flex-1 basis-56">
            {shown === 'reconnect' ? 'Reconnect your calendar to see your meetings.' : "Couldn't load your calendar."}
          </span>
          {shown === 'reconnect'
            ? <Button size="sm" onClick={settings}>Reconnect your calendar</Button>
            : <Button size="sm" onClick={() => void load()}>Try again</Button>}
        </div>
      )}
      {shown === 'list' && !known?.canWrite && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-4 py-2 text-xs text-muted">
          <span className="min-w-0 flex-1 basis-56">Reconnect your calendar to send and answer invites</span>
          <Button size="sm" onClick={settings}>Reconnect</Button>
        </div>
      )}

      {view === 'month' ? (
        <MonthGrid
          cells={monthCells(anchor)}
          month={anchor.slice(0, 7)}
          events={events}
          zone={zone}
          today={today}
          onOpen={(e) => setOpenId(e.id)}
          onCreate={canWrite ? (slot) => openEditor({ slot }) : undefined}
          onDay={(d) => { setAnchor(d); setView('day'); }}
        />
      ) : (
        <CalendarGrid
          days={daysIn(from, to)}
          events={events}
          zone={zone}
          today={today}
          now={now}
          onOpen={(e) => setOpenId(e.id)}
          onCreate={canWrite ? (slot) => openEditor({ slot }) : undefined}
        />
      )}

      <EventCard
        event={open}
        zone={zone}
        canWrite={!!known?.canWrite}
        names={names}
        onClose={() => setOpenId(null)}
        onChanged={load}
        onEdit={(event) => openEditor({ event })}
      />
    </div>
  );
}
