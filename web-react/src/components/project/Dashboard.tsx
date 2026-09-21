/* Hallmark · component: the numbers a database already knows · genre: modern-minimal
 * pre-emit critique: P5 H4 E5 S5 R4 V4
 * contrast: pass (40-41) — every mark and label measured on both surfaces
 * theme: project tokens (index.css)
 * states: loading (parent) · no sprint · nothing finished yet · unsized work ·
 *         sprint in flight · sprint over
 * note: four cards, no chart library. Three of them are divs — a bar is a box
 *       with a width, and reaching for SVG to draw one buys nothing and loses
 *       wrapping, text selection and the type scale. Only the burndown, which
 *       is two lines over a shared scale, is drawn.
 */
import { useMemo } from 'react';
import { CalendarRange } from 'lucide-react';
import {
  burndown, linePoints, statusMix, throughput, velocity, workload,
} from '../../lib/charts';
import { STATUS_LABEL, type SprintRow, type TaskRow, type TaskStatus } from '../../lib/tasksApi';
import { STATUS_COLOR } from '../../lib/builtinProps';
import { swatch } from '../../lib/tagColors';
import { cn } from '../../lib/cn';
import { EmptyState } from '../ui/EmptyState';

/**
 * What colour a status is painted here.
 *
 * Read from the project, not from a local map: a project can repaint any of its
 * four states (`projects.status_colors`), the board honours that, and a
 * dashboard that kept its own copy would show yellow for a Review its own board
 * had turned purple — two answers about the same rows on the same screen.
 *
 * `bar`, not `dot`: these fills are read as areas, and the dot steps measure
 * under 3:1 on a light card. See lib/tagColors.
 */
const fillFor = (status: TaskStatus, colors: Record<string, string>) =>
  swatch(colors[status] || STATUS_COLOR[status] || 'gray').bar;

function Card({ title, hint, span, children }: { title: string; hint?: string; span?: string; children: React.ReactNode }) {
  return (
    <div className={cn('flex min-w-0 flex-col rounded-lg border border-line bg-surface p-4', span)}>
      <header className="mb-3 flex min-w-0 items-baseline justify-between gap-3">
        <h3 className="truncate text-sm font-semibold text-ink">{title}</h3>
        {/* muted, not the faint the rest of the chrome uses for hints: this one
            names what the chart covers ("Sprint 15", "completed sprints"), so
            it is part of reading the card rather than a note beside it — and
            faint measures 3.4:1 on this surface, under the floor for 12px. */}
        {hint && <span className="shrink-0 text-2xs text-muted">{hint}</span>}
      </header>
      {children}
    </div>
  );
}

/** What a card says when it has nothing yet. Deliberately not an empty chart:
 *  axes with no marks on them look like a rendering failure. */
function Nothing({ children }: { children: React.ReactNode }) {
  return <p className="py-6 text-center text-xs text-faint">{children}</p>;
}

/**
 * Remaining work against the line it would follow if it were spread evenly.
 *
 * `preserveAspectRatio="none"` lets the drawing stretch to whatever width the
 * card has; `vector-effect` keeps the strokes 2px through that stretch, which
 * is the one thing that goes wrong when an SVG is scaled on one axis.
 */
function Burndown({ tasks, sprint }: { tasks: TaskRow[]; sprint: SprintRow | null }) {
  const b = useMemo(() => burndown(tasks, sprint), [tasks, sprint]);
  if (!sprint) {
    return <Nothing>Pick a sprint above to see it burn down.</Nothing>;
  }
  if (!b) {
    return <Nothing>{sprint.name} has no start and end date yet.</Nothing>;
  }
  if (!b.total) {
    return <Nothing>Nothing is in {sprint.name} yet.</Nothing>;
  }

  const W = 320;
  const H = 120;
  const steps = b.days.length;
  const left = b.actual.length ? b.actual[b.actual.length - 1] : b.total;
  const ahead = b.actual.length ? left <= b.ideal[b.actual.length - 1] : true;

  return (
    <>
      <div className="mb-2 flex items-baseline gap-2">
        <span className="text-xl font-semibold tabular-nums text-ink">{left}</span>
        <span className="text-2xs text-muted">{b.pointed ? 'points' : 'tasks'} left of {b.total}</span>
        <span className={cn('ml-auto text-2xs font-medium', ahead ? 'text-ok' : 'text-danger-strong')}>
          {ahead ? 'On track' : 'Behind the line'}
        </span>
      </div>
      {/* Zero is the wrapper's bottom border, not a line inside the drawing:
          the viewBox is scaled on one axis, so a rule sitting exactly on the
          bottom edge loses half its width to the clip and renders as nothing. */}
      <div className="border-b border-line">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="block h-28 w-full"
        role="img"
        aria-label={`Burndown for ${sprint.name}: ${left} of ${b.total} ${b.pointed ? 'points' : 'tasks'} remaining.`}
      >
        <polyline
          points={linePoints(b.ideal, b.total, W, H, steps)}
          fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="4 4"
          // faint, not line-strong: line-strong measures 1.3:1 on the card, and
          // this is the line the actual is being compared against — the whole
          // reason the card exists. 3.5:1 light, 4.5:1 dark.
          vectorEffect="non-scaling-stroke" className="text-faint"
        />
        <polyline
          points={linePoints(b.actual, b.total, W, H, steps)}
          fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round"
          vectorEffect="non-scaling-stroke" className="text-accent"
        />
      </svg>
      </div>
      {/* muted, not faint: an axis names what the drawing above it spans, which
          makes it text to read rather than a hint to notice. */}
      <div className="mt-1 flex justify-between text-3xs tabular-nums text-muted">
        <span>{b.days[0]}</span>
        <span>{b.days[b.days.length - 1]}</span>
      </div>
    </>
  );
}

/** Finished work, sprint by sprint — output only, no "of N" behind it. Closing
 *  a sprint returns its unfinished tasks to the backlog, so a finished sprint's
 *  scope and its output are the same number; see `velocity` in lib/charts. */
function Velocity({ sprints }: { sprints: SprintRow[] }) {
  const bars = useMemo(() => velocity(sprints), [sprints]);
  if (!bars.length) return <Nothing>No sprint has been completed yet.</Nothing>;
  const top = Math.max(...bars.map((b) => b.done), 1);
  const avg = Math.round(bars.reduce((s, b) => s + b.done, 0) / bars.length);

  return (
    <>
      <div className="mb-3 flex items-baseline gap-2">
        <span className="text-xl font-semibold tabular-nums text-ink">{avg}</span>
        <span className="text-2xs text-muted">average per sprint</span>
      </div>
      <ul className="space-y-2">
        {bars.slice(-6).map((b) => (
          <li key={b.id} className="flex items-center gap-2">
            <span className="w-20 shrink-0 truncate text-2xs text-muted">{b.name}</span>
            <span className="h-2.5 min-w-0 flex-1 rounded-full bg-hover">
              <span className="block h-full rounded-full bg-accent" style={{ width: `${(b.done / top) * 100}%` }} />
            </span>
            <span className="w-8 shrink-0 text-right text-2xs tabular-nums text-faint">{b.done}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

/** The tallest a throughput bar gets, in pixels. */
const TRACK = 88;

/** Tasks finished per week. Empty weeks are drawn as empty, not skipped: a
 *  chart that drops them turns a stop-start month into a smooth climb. */
function Throughput({ tasks }: { tasks: TaskRow[] }) {
  const weeks = useMemo(() => throughput(tasks), [tasks]);
  const top = Math.max(...weeks.map((w) => w.count), 1);
  const total = weeks.reduce((s, w) => s + w.count, 0);
  if (!total) return <Nothing>Nothing has been finished in the last eight weeks.</Nothing>;

  return (
    <>
      <div className="mb-3 flex items-baseline gap-2">
        <span className="text-xl font-semibold tabular-nums text-ink">{total}</span>
        <span className="text-2xs text-muted">finished in eight weeks</span>
      </div>
      {/* Labelled the same way the burndown and the status bar are. The bars
          themselves are hidden from the reading order: their heights say
          nothing a screen reader can use, and the count under each one is
          already the number they encode. */}
      <div
        className="flex items-end gap-1.5"
        role="img"
        aria-label={`Tasks finished per week, ${weeks[0].week} to ${weeks[weeks.length - 1].week}: ${weeks.map((w) => w.count).join(', ')}.`}
      >
        {weeks.map((w) => (
          <div key={w.week} className="flex min-w-0 flex-1 flex-col items-center gap-1">
            <span
              aria-hidden="true"
              className="w-full rounded-t-sm bg-accent"
              // Pixels, not a percentage: the column sizes itself to what is in
              // it, and a percentage of an auto height is zero — which drew
              // eight labels under eight invisible bars.
              // A week with nothing finished still keeps a 2px sliver, so it
              // reads as "none" rather than as a hole in the chart.
              style={{ height: Math.max(2, Math.round((w.count / top) * TRACK)) }}
            />
            <span className="text-3xs tabular-nums text-muted">{w.count}</span>
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-3xs tabular-nums text-muted">
        <span>{weeks[0].week}</span>
        <span>{weeks[weeks.length - 1].week}</span>
      </div>
    </>
  );
}

/** Where the work stands right now. One bar rather than four, because the
 *  question is what share is done, and four bars make that a subtraction. */
function StatusMix({ tasks, statusColors }: { tasks: TaskRow[]; statusColors: Record<string, string> }) {
  const mix = useMemo(() => statusMix(tasks), [tasks]);
  const total = tasks.length;
  if (!total) return <Nothing>No tasks match this view.</Nothing>;
  const done = mix.find((m) => m.status === 'done')?.count ?? 0;

  return (
    <>
      <div className="mb-3 flex items-baseline gap-2">
        <span className="text-xl font-semibold tabular-nums text-ink">{Math.round((done / total) * 100)}%</span>
        <span className="text-2xs text-muted">of {total} done</span>
      </div>
      <div className="flex h-2.5 overflow-hidden rounded-full bg-hover" role="img" aria-label={mix.map((m) => `${STATUS_LABEL[m.status]} ${m.count}`).join(', ')}>
        {mix.map((m) => m.count > 0 && (
          <span key={m.status} className={fillFor(m.status, statusColors)} style={{ width: `${(m.count / total) * 100}%` }} />
        ))}
      </div>
      <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5">
        {mix.map((m) => (
          <li key={m.status} className="flex items-center gap-2 text-2xs">
            <span className={cn('h-2 w-2 shrink-0 rounded-full', fillFor(m.status, statusColors))} />
            <span className="min-w-0 flex-1 truncate text-muted">{STATUS_LABEL[m.status]}</span>
            <span className="tabular-nums text-faint">{m.count}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

/**
 * Who is carrying what, in hours.
 *
 * Bars rather than a ranked list of numbers, because the question is
 * comparative — not "how many hours does Ada have" but "does Ada have more
 * than everyone else". The scale is the heaviest person, so the top bar is
 * always full: this says who is loaded relative to the team, which is the only
 * thing a database that does not know anyone's working hours can honestly say.
 *
 * The unsized count is printed beside the hours rather than folded into them.
 * A person with a 2-hour bar and four unestimated tasks is exactly the case
 * this chart would otherwise get backwards, and inventing a number for those
 * tasks would be worse than admitting they have none.
 */
function Workload({ tasks }: { tasks: TaskRow[] }) {
  const rows = useMemo(() => workload(tasks), [tasks]);
  const top = Math.max(...rows.map((r) => r.hours), 0);
  if (!rows.length) return <Nothing>No open work in this view.</Nothing>;
  if (top === 0) {
    return <Nothing>No estimates yet — put hours on a task and this fills in.</Nothing>;
  }

  return (
    <ul className="flex flex-col gap-2">
      {rows.slice(0, 8).map((r) => (
        <li key={r.id || 'unassigned'} className="flex flex-col gap-1">
          <div className="flex items-baseline gap-2">
            <span className={cn('min-w-0 flex-1 truncate text-2xs', r.id ? 'text-ink' : 'text-faint')}>{r.name}</span>
            <span className="shrink-0 text-2xs tabular-nums text-muted">{round(r.hours)}h</span>
            {r.unsized > 0 && (
              <span className="shrink-0 text-3xs tabular-nums text-faint" title={`${r.unsized} of ${r.count} tasks carry no estimate`}>
                +{r.unsized} unsized
              </span>
            )}
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-hover">
            <span
              className={cn('block h-full rounded-full', r.id ? 'bg-accent' : 'bg-line-strong')}
              style={{ width: `${Math.max(2, (r.hours / top) * 100)}%` }}
              role="img"
              aria-label={`${r.name}: ${round(r.hours)} hours over ${r.count} open task${r.count === 1 ? '' : 's'}`}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Hours, without a trailing .0 on the whole ones. */
const round = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/**
 * The dashboard view.
 *
 * It reads the same filtered task list every other view does, so narrowing the
 * view narrows the charts — a dashboard that ignored the filter bar above it
 * would answer a different question from the one on screen.
 *
 * The burndown follows the sprint scope picker rather than owning a second one:
 * two sprint pickers on one screen is two answers to "which sprint".
 */
export function Dashboard({ tasks, sprints, scope, statusColors = {} }: {
  tasks: TaskRow[];
  sprints: SprintRow[];
  scope: string;
  /** The project's own status palette; absent means the four defaults. */
  statusColors?: Record<string, string>;
}) {
  // 'all' and 'backlog' are not sprints, so fall back to the one in flight —
  // which is what someone opening a dashboard mid-sprint is asking about.
  const sprint = sprints.find((s) => s.id === scope)
    ?? (scope === 'all' ? sprints.find((s) => s.state === 'active') ?? null : null);

  if (!sprints.length && !tasks.length) {
    return (
      <EmptyState
        icon={CalendarRange}
        title="Nothing to chart yet"
        hint="Add tasks, and a sprint to put them in, and this fills itself in."
      />
    );
  }

  return (
    <div className="h-full overflow-y-auto p-4">
      {/* Two blocks, not four equal tiles. Equal tiles say every card matters
          equally, and mid-sprint they do not: the burndown is the one people
          open this screen for, and it is the only one whose shape needs width.
          The other three are a strip underneath.

          Status carries the span at two columns so the strip never leaves a
          hole — three cards in a two-column grid otherwise end with one card
          and an empty slot beside it, which reads as something failed to load. */}
      <div className="space-y-3">
        <Card title="Burndown" hint={sprint?.name}>
          <Burndown tasks={sprint ? tasks.filter((t) => t.sprint_id === sprint.id) : tasks} sprint={sprint} />
        </Card>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Card title="Velocity" hint="completed sprints">
            <Velocity sprints={sprints} />
          </Card>
          <Card title="Throughput" hint="tasks per week">
            <Throughput tasks={tasks} />
          </Card>
          <Card title="Status" hint="right now" span="sm:col-span-2 lg:col-span-1">
            <StatusMix tasks={tasks} statusColors={statusColors} />
          </Card>
        </div>
        {/* Its own row, not a fourth tile in the strip: a fourth card leaves a
            hole beside it at every width the strip has, and this one is a list
            of names that wants the width anyway. */}
        <Card title="Workload" hint="open hours per person">
          <Workload tasks={tasks} />
        </Card>
      </div>
    </div>
  );
}
