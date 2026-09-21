/* Hallmark · component: sprint planning workbench · genre: modern-minimal
 * theme: project tokens (index.css)
 * pre-emit critique: P5 H5 E4 S5 R5 V5
 * states: empty project · no sprints · active sprint · planned sprint ·
 *         completed sprints folded · dragging · drop target · renaming ·
 *         editing dates · composing a sprint · empty backlog · narrow (one column)
 * note: two panes, because planning is two lists — what is committed and what
 *       is available. The backlog was underneath every sprint before, so a
 *       drag from it was a scroll down, a pick up, and a scroll back.
 */
import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronRight, MoreHorizontal, Play, Plus, Trash2 } from 'lucide-react';
import { cn } from '../../lib/cn';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import {
  STATUS_LABEL,
  type SprintRow,
  type SprintState,
  type TaskRow,
  type TaskStatus,
} from '../../lib/tasksApi';
import { field } from '../ui/styles';
import { Menu } from '../ui/Menu';
import { useKind } from './kinds';
import { AssigneeStack, KindBadge } from './TaskChip';

const shortDate = (iso: string | null) =>
  iso ? new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : null;

const STATE_BADGE: Record<SprintState, string> = {
  planned: 'bg-surface text-muted',
  active: 'bg-accent-soft text-accent-strong',
  done: 'bg-surface text-faint',
};

/**
 * One task, as a row of columns rather than a row of things pushed apart.
 *
 * It was a flex row with a `flex-1` title, so every piece of metadata hung off
 * the right edge and none of it lined up from one row to the next — and the
 * type badge being `auto` left the titles themselves ragged, starting at a
 * different x depending on whether the task had a badge at all.
 *
 * Fixed tracks fix both: the columns read down the list, and the width the
 * wider pane gives back goes to the title, which is the only cell that can use
 * it. `compact` drops the status column for the narrow backlog pane, where the
 * title is worth more than a word that repeats down the whole column.
 */
function TaskLine({ task, tasks, onOpen, compact }: {
  task: TaskRow;
  tasks: TaskRow[];
  onOpen: () => void;
  compact?: boolean;
}) {
  // Any grouping type rolls its children up here, not just the seeded Epic.
  const children = useKind(task.kind)?.is_group ? tasks.filter((t) => t.parent_id === task.id) : [];
  const childDone = children.filter((t) => t.status === 'done').length;
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/task-id', task.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      onClick={onOpen}
      className={cn(
        'group grid h-9 cursor-pointer items-center gap-2 rounded-md px-2.5 transition-colors duration-120 hover:bg-hover sm:gap-2.5',
        compact
          ? 'grid-cols-[2.75rem_minmax(0,1fr)_2.25rem_1.5rem]'
          // On a phone the status column costs 88px and says the same word most
          // of the way down the list; the title is what the row is for. It goes,
          // and the track list goes with it — a hidden grid child still holds
          // its column otherwise.
          : 'grid-cols-[2.75rem_minmax(0,1fr)_2.25rem_3rem] sm:grid-cols-[3.25rem_minmax(0,1fr)_2.25rem_5.5rem_3rem]',
      )}
    >
      {/* Wrapped, because KindBadge renders nothing for a type that has no
          badge — and an empty grid cell has to be an element, or the title
          slides up into the badge's 44px track and truncates to "WR-1…". */}
      <span className="min-w-0">
        <KindBadge kind={task.kind} />
      </span>
      <span className="flex min-w-0 items-center gap-2">
        <span className={cn('min-w-0 truncate text-sm', task.status === 'done' ? 'text-muted line-through' : 'text-ink')}>
          {task.title || 'Untitled'}
        </span>
        {children.length > 0 && (
          <span className="shrink-0 text-2xs text-faint" title="Children done">
            {childDone}/{children.length}
          </span>
        )}
      </span>
      <span className="text-right">
        {task.points != null && (
          <span className="rounded-full bg-surface px-1.5 py-0.5 text-2xs font-medium text-muted" title="Story points">
            {task.points}
          </span>
        )}
      </span>
      {!compact && (
        <span className="hidden truncate text-right text-2xs text-faint sm:block">
          {STATUS_LABEL[task.status as TaskStatus]}
        </span>
      )}
      {/* The empty span keeps the column of faces aligned down the list when a
          task has nobody on it. */}
      <span className="flex justify-end">
        {task.assignees?.length ? <AssigneeStack people={task.assignees} max={2} /> : <span className="h-5 w-5" />}
      </span>
    </div>
  );
}

/** Everything a section needs to accept a dragged task, in one place. */
function useDropTarget(onDropTask: (taskId: string) => void) {
  const [over, setOver] = useState(false);
  return {
    over,
    props: {
      onDragOver: (e: React.DragEvent) => {
        if (e.dataTransfer.types.includes('text/task-id')) { e.preventDefault(); setOver(true); }
      },
      onDragLeave: () => setOver(false),
      onDrop: (e: React.DragEvent) => {
        e.preventDefault();
        setOver(false);
        const id = e.dataTransfer.getData('text/task-id');
        if (id) onDropTask(id);
      },
    },
  };
}

function Section({
  title, meta, badge, actions, banner, children, onDropTask, onAdd, defaultOpen = true,
}: {
  title: React.ReactNode;
  meta?: React.ReactNode;
  badge?: React.ReactNode;
  actions?: React.ReactNode;
  /** Drawn under the header, inside the card — the active sprint's progress. */
  banner?: React.ReactNode;
  children: React.ReactNode;
  onDropTask: (taskId: string) => void;
  onAdd: () => void;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const drop = useDropTarget(onDropTask);
  return (
    <section
      {...drop.props}
      className={cn('rounded-lg border border-line transition-colors duration-120', drop.over && 'border-accent bg-accent-soft')}
    >
      <header className="flex h-11 items-center gap-2 px-3">
        <button type="button" onClick={() => setOpen((o) => !o)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          <ChevronDown size={14} className={cn('shrink-0 text-faint transition-transform duration-180', !open && '-rotate-90')} />
          <span className="truncate text-sm font-semibold text-ink">{title}</span>
          {badge}
          {meta && <span className="hidden truncate text-2xs text-faint md:inline">{meta}</span>}
        </button>
        {actions}
        <button type="button" onClick={onAdd} className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-faint hover:bg-hover hover:text-muted" aria-label="Add task">
          <Plus size={14} />
        </button>
      </header>
      {open && banner}
      {open && <div className={cn('border-t border-line p-1.5', banner && 'border-t-0')}>{children}</div>}
    </section>
  );
}

/**
 * How far the sprint you are actually in has got.
 *
 * Only the active sprint draws it. The numbers were there before — "2/4 done ·
 * 7/20 pts" in eleven-pixel faint type, and hidden below `md`, which is to say
 * the most important measurement on the screen was the one hardest to read.
 * One bar, on one section, is the whole of the accent's job here.
 */
function SprintProgress({ sprint }: { sprint: SprintRow }) {
  const total = Number(sprint.total) || 0;
  const done = Number(sprint.done) || 0;
  const points = Number(sprint.points) || 0;
  const pointsDone = Number(sprint.points_done) || 0;
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div className="flex items-center gap-2.5 px-3 pb-2.5">
      <span
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Sprint progress"
        className="h-1.5 w-32 shrink-0 overflow-hidden rounded-full bg-line-strong"
      >
        <span className="block h-full rounded-full bg-accent transition-[width] duration-300 ease-out" style={{ width: `${pct}%` }} />
      </span>
      <span className="text-2xs tabular-nums text-muted">
        {done}/{total} done{points > 0 ? ` · ${pointsDone}/${points} pts` : ''}
      </span>
    </div>
  );
}

interface Props {
  tasks: TaskRow[];
  sprints: SprintRow[];
  onOpen: (t: TaskRow) => void;
  onMoveToSprint: (taskId: string, sprintId: string | null) => void;
  onAdd: (sprintId: string | null) => void;
  onCreateSprint: (name: string) => void;
  onPatchSprint: (id: string, body: Partial<{ name: string; startAt: string | null; endAt: string | null; state: SprintState }>) => void;
  onDeleteSprint: (id: string) => void;
}

/**
 * Sprint planning: the sprints on the left, the backlog kept beside them.
 *
 * Below 1280 the backlog drops under the sprints and the view is the single
 * column it has always been on a phone — two panes at 350px each is not a
 * layout, it is two gutters.
 */
export function Backlog({ tasks, sprints, onOpen, onMoveToSprint, onAdd, onCreateSprint, onPatchSprint, onDeleteSprint }: Props) {
  // 1280, not 1024: the query measures the window, and the docked sidebar takes
  // 316px of it before this view sees any. At 1024 that left the sprint pane at
  // 356px — narrower than the backlog docked beside it, which is the panel
  // reversed. 1280 is the first width where both panes are worth having.
  const twoPane = useMediaQuery('(min-width: 1280px)');
  const backlog = tasks.filter((t) => !t.sprint_id).sort((a, b) => b.priority - a.priority || a.position - b.position);
  const bySprint = (id: string) => tasks.filter((t) => t.sprint_id === id).sort((a, b) => a.position - b.position);

  // The server hands these back active-first then by start date, which puts a
  // sprint that finished last week between the one being worked and the one
  // being planned. Finished work goes to the bottom instead, behind one
  // disclosure: it is history, and history is not in the way.
  const live = sprints.filter((s) => s.state !== 'done');
  const finished = sprints.filter((s) => s.state === 'done');

  // Inline editors instead of window.prompt: which sprint is being renamed /
  // rescheduled, and whether the new-sprint composer is open.
  const [renaming, setRenaming] = useState<string | null>(null);
  const [datesFor, setDatesFor] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [showFinished, setShowFinished] = useState(false);

  // Completing a sprint moves it into the fold, and a section that disappears
  // on the click that finished it looks like a section that was deleted. When
  // the count goes up while someone is watching, the fold opens itself: the
  // sprint is still there, collapsed and marked Done, which is the receipt.
  // Sprints that were already finished when the view opened stay folded.
  const finishedCount = useRef(finished.length);
  useEffect(() => {
    if (finished.length > finishedCount.current) setShowFinished(true);
    finishedCount.current = finished.length;
  }, [finished.length]);

  const commitRename = (s: SprintRow, value: string) => {
    const name = value.trim();
    if (name && name !== s.name) onPatchSprint(s.id, { name });
    setRenaming(null);
  };

  const sprintSection = (s: SprintRow) => {
    const rows = bySprint(s.id);
    const range = [shortDate(s.start_at), shortDate(s.end_at)].filter(Boolean).join(' → ');
    return (
      <Section
        key={s.id}
        title={
          renaming === s.id ? (
            <input
              autoFocus
              defaultValue={s.name}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename(s, e.currentTarget.value);
                if (e.key === 'Escape') setRenaming(null);
              }}
              onBlur={(e) => commitRename(s, e.target.value)}
              className={cn(field, 'h-6 w-40 px-1.5 font-semibold')}
            />
          ) : (
            s.name
          )
        }
        defaultOpen={s.state !== 'done'}
        badge={<span className={cn('shrink-0 rounded-full px-1.5 py-0.5 text-2xs font-medium capitalize', STATE_BADGE[s.state])}>{s.state}</span>}
        // The counts move into the progress bar for the active sprint, so
        // repeating them up here would be the same number twice in one header.
        meta={[range, s.state === 'active' ? null : `${s.done}/${s.total} done`].filter(Boolean).join(' · ')}
        banner={s.state === 'active' ? <SprintProgress sprint={s} /> : undefined}
        onDropTask={(id) => onMoveToSprint(id, s.id)}
        onAdd={() => onAdd(s.id)}
        actions={
          <span className="flex shrink-0 items-center gap-1">
            {s.state === 'planned' && (
              <button type="button" onClick={() => onPatchSprint(s.id, { state: 'active' })} className="flex h-6 items-center gap-1 rounded-md px-2 text-2xs font-medium text-accent-strong hover:bg-accent-soft">
                <Play size={12} /> Start
              </button>
            )}
            {s.state === 'active' && (
              <button type="button" onClick={() => onPatchSprint(s.id, { state: 'done' })} className="flex h-6 items-center gap-1 rounded-md px-2 text-2xs font-medium text-accent-strong hover:bg-accent-soft">
                <CheckCircle2 size={12} /> Complete
              </button>
            )}
            <Menu
              align="end"
              trigger={
                <button type="button" className="flex h-6 w-6 items-center justify-center rounded text-faint hover:bg-hover hover:text-muted" aria-label="Sprint actions">
                  <MoreHorizontal size={14} />
                </button>
              }
              items={[
                { label: 'Rename', onSelect: () => setRenaming(s.id) },
                { label: 'Edit dates', onSelect: () => setDatesFor(datesFor === s.id ? null : s.id) },
                ...(s.state === 'done' ? [{ label: 'Reopen', onSelect: () => onPatchSprint(s.id, { state: 'planned' }) }] : []),
                { icon: Trash2, label: 'Delete sprint', danger: true, separatorBefore: true, onSelect: () => onDeleteSprint(s.id) },
              ]}
            />
          </span>
        }
      >
        {datesFor === s.id && (
          <div className="mb-1 flex flex-wrap items-center gap-2 border-b border-line px-2.5 pb-2 pt-1">
            <input
              type="date"
              defaultValue={s.start_at?.slice(0, 10) ?? ''}
              onChange={(e) => onPatchSprint(s.id, { startAt: e.target.value || null })}
              aria-label="Sprint start"
              className={cn(field, 'h-7 w-auto px-2 text-xs')}
            />
            <span className="text-2xs text-faint">to</span>
            <input
              type="date"
              defaultValue={s.end_at?.slice(0, 10) ?? ''}
              onChange={(e) => onPatchSprint(s.id, { endAt: e.target.value || null })}
              aria-label="Sprint end"
              className={cn(field, 'h-7 w-auto px-2 text-xs')}
            />
            <button type="button" onClick={() => setDatesFor(null)} className="ml-auto rounded-md px-2 py-1 text-2xs font-medium text-accent-strong hover:bg-accent-soft">
              Done
            </button>
          </div>
        )}
        {rows.length ? rows.map((t) => <TaskLine key={t.id} task={t} tasks={tasks} onOpen={() => onOpen(t)} />) : (
          <p className="px-3 py-4 text-center text-2xs text-faint">Drag tasks here to plan this sprint.</p>
        )}
      </Section>
    );
  };

  const backlogRows = backlog.length
    ? backlog.map((t) => <TaskLine key={t.id} task={t} tasks={tasks} onOpen={() => onOpen(t)} compact={twoPane} />)
    : <p className="px-3 py-6 text-center text-2xs text-faint">Nothing waiting. Every task is in a sprint.</p>;

  return (
    <div className="flex h-full min-h-0">
      <div className="scrollarea min-w-0 flex-1 overflow-y-auto p-3 sm:p-4">
        <div className="mb-3 flex items-center gap-2">
          <h2 className="text-2xs font-semibold uppercase tracking-wide text-muted">Sprints</h2>
          {composing ? null : (
            <button
              type="button"
              onClick={() => setComposing(true)}
              className="ml-auto flex h-6 items-center gap-1 rounded-md px-2 text-2xs font-medium text-accent-strong transition-colors duration-120 hover:bg-accent-soft"
            >
              <Plus size={12} /> New sprint
            </button>
          )}
        </div>

        <div className="space-y-3">
          {composing && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const input = e.currentTarget.elements.namedItem('sprint-name') as HTMLInputElement;
                const name = input.value.trim();
                if (name) onCreateSprint(name);
                setComposing(false);
              }}
              className="flex items-center gap-2 rounded-lg border border-line p-2"
            >
              <input
                autoFocus
                name="sprint-name"
                placeholder="Sprint name…"
                defaultValue={`Sprint ${sprints.length + 1}`}
                onKeyDown={(e) => e.key === 'Escape' && setComposing(false)}
                className={cn(field, 'min-w-0 flex-1')}
              />
              <button type="submit" className="h-8 shrink-0 rounded-md bg-accent px-3 text-sm font-medium text-white hover:opacity-90">
                Create
              </button>
              <button type="button" onClick={() => setComposing(false)} className="h-8 shrink-0 rounded-md px-2.5 text-sm text-muted hover:bg-hover">
                Cancel
              </button>
            </form>
          )}

          {live.map(sprintSection)}

          {live.length === 0 && !composing && (
            <p className="rounded-lg border border-dashed border-line px-3 py-6 text-center text-2xs text-faint">
              No sprints yet. Everything sits in the backlog until one is planned.
            </p>
          )}

          {finished.length > 0 && (
            <div className="space-y-3">
              <button
                type="button"
                onClick={() => setShowFinished((v) => !v)}
                className="flex h-8 w-full items-center gap-1.5 rounded-md px-1 text-2xs font-medium text-faint transition-colors duration-120 hover:text-muted"
              >
                <ChevronRight size={13} className={cn('transition-transform duration-180', showFinished && 'rotate-90')} />
                {finished.length} completed sprint{finished.length === 1 ? '' : 's'}
              </button>
              {showFinished && finished.map(sprintSection)}
            </div>
          )}

          {/* One column: the backlog goes back under the sprints, where it was. */}
          {!twoPane && (
            <Section
              title="Backlog"
              badge={<span className="shrink-0 rounded-full bg-surface px-1.5 py-0.5 text-2xs font-medium text-muted">{backlog.length}</span>}
              onDropTask={(id) => onMoveToSprint(id, null)}
              onAdd={() => onAdd(null)}
            >
              {backlogRows}
            </Section>
          )}
        </div>
      </div>

      {twoPane && (
        <BacklogPane
          count={backlog.length}
          onDropTask={(id) => onMoveToSprint(id, null)}
          onAdd={() => onAdd(null)}
        >
          {backlogRows}
        </BacklogPane>
      )}
    </div>
  );
}

/**
 * The backlog, docked. Its own scroller, so grooming a hundred rows does not
 * move the sprint you are dragging them into — which is the whole reason the
 * two panes are worth their width.
 */
function BacklogPane({ count, onDropTask, onAdd, children }: {
  count: number;
  onDropTask: (taskId: string) => void;
  onAdd: () => void;
  children: React.ReactNode;
}) {
  const drop = useDropTarget(onDropTask);
  return (
    <aside
      {...drop.props}
      aria-label="Backlog"
      className={cn(
        'flex w-[22rem] shrink-0 flex-col border-l border-line transition-colors duration-120 2xl:w-[26rem]',
        drop.over && 'bg-accent-soft',
      )}
    >
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-3">
        <h2 className="text-2xs font-semibold uppercase tracking-wide text-muted">Backlog</h2>
        <span className="rounded-full bg-surface px-1.5 py-0.5 text-2xs font-medium text-muted">{count}</span>
        <button type="button" onClick={onAdd} className="ml-auto flex h-6 w-6 items-center justify-center rounded text-faint hover:bg-hover hover:text-muted" aria-label="Add task to backlog">
          <Plus size={14} />
        </button>
      </header>
      <div className="scrollarea min-h-0 flex-1 overflow-y-auto p-1.5">{children}</div>
    </aside>
  );
}
