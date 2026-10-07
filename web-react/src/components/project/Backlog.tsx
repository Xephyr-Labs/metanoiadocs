/* Hallmark · component: sprint planning workbench · genre: modern-minimal
 * theme: project tokens (index.css)
 * pre-emit critique: P5 H5 E4 S5 R5 V5
 * states: empty project · no sprints · active sprint · planned sprint ·
 *         completed sprints folded · dragging · drop target · renaming ·
 *         editing dates · composing a sprint · empty backlog · narrow (one column)
 *         · branch open · branch collapsed · blocked row · parent elsewhere ·
 *         leaf row (no disclosure)
 * note: two panes, because planning is two lists — what is committed and what
 *       is available. The backlog was underneath every sprint before, so a
 *       drag from it was a scroll down, a pick up, and a scroll back.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, CornerDownRight, Link2, MoreHorizontal, Play, Plus, Trash2 } from 'lucide-react';
import { cn } from '../../lib/cn';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { branchIds, buildLinkIndex, buildTaskTree, canDropOnParent, sectionRoots, subtreeIndex, NO_LINKS, type TaskLinks, type TaskNode } from '../../lib/taskTree';
import {
  STATUS_LABEL,
  type SprintRow,
  type SprintState,
  type TaskRow,
  type TaskStatus,
} from '../../lib/tasksApi';
import { field } from '../ui/styles';
import { Menu } from '../ui/Menu';
import { AssigneeStack, KindIcon } from './TaskChip';
import { useKinds } from './kinds';
import { splitKey } from '../../lib/taskKey';

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
 * Fixed tracks keep the columns reading down the list, and the width the
 * wider pane gives back goes to the title, which is the only cell that can use
 * it. `compact` drops the status column for the narrow backlog pane, where the
 * title is worth more than a word that repeats down the whole column.
 *
 * The first track is `--disc`, set once on the view: 16px with a mouse, 44px
 * under a finger, so the disclosure is a real target on a phone and the rail
 * below it can find its middle from the same number.
 */
function TaskLine({ node, links, progress, parent, isGroup, expanded, depsOpen, dropping, onToggle, onToggleDeps, onOpen, compact, drag }: {
  node: TaskNode;
  links: TaskLinks;
  /** Done and total under this row across the whole project — see subtreeIndex. */
  progress: { done: number; total: number };
  /** The row this one hangs off when that row is not in this list. */
  parent?: TaskRow;
  /** A container type (Epic): the row leads, and takes dropped rows. */
  isGroup: boolean;
  expanded: boolean;
  depsOpen: boolean;
  /** A row is being dragged over this one and may be dropped here. */
  dropping: boolean;
  onToggle: () => void;
  onToggleDeps: () => void;
  onOpen: () => void;
  compact?: boolean;
  drag: React.HTMLAttributes<HTMLDivElement>;
}) {
  const task = node.task;
  const branch = node.children.length > 0;
  const parentKey = parent ? splitKey(parent.title).key : null;
  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
  return (
    <div
      {...drag}
      onClick={onOpen}
      className={cn(
        'group grid h-9 cursor-pointer items-center gap-2 rounded-md pr-2.5 transition-colors duration-120 coarse:h-11 sm:gap-2.5',
        // The disclosure owns the row's left edge rather than sitting inside
        // its padding, so its target runs to the edge of the row.
        'pl-0',
        // An epic leads its stories: a quiet ground and a heavier title, so
        // the list reads as a few headed groups instead of one long column.
        isGroup ? 'bg-surface hover:bg-hover' : 'hover:bg-hover',
        dropping && 'bg-accent-soft ring-2 ring-inset ring-accent hover:bg-accent-soft',
        compact
          ? 'grid-cols-[var(--disc)_1rem_minmax(0,1fr)_2.25rem_1.5rem]'
          // On a phone the status and points columns go: they cost 130px and
          // repeat down the list, and the title is what the row is for. The
          // track list goes with them, since a hidden grid child still holds
          // its column otherwise. Both are one tap away in the peek.
          : 'grid-cols-[var(--disc)_1rem_minmax(0,1fr)_3rem] sm:grid-cols-[var(--disc)_1rem_minmax(0,1fr)_2.25rem_5.5rem_3rem]',
      )}
    >
      {/* Only a row with children has a disclosure, and it opens only the
          children. The track stays on every row so titles line up. */}
      {branch ? (
        <button
          type="button"
          aria-expanded={expanded}
          aria-label={expanded ? `Collapse ${task.title || 'this row'}` : `Expand ${task.title || 'this row'}`}
          onClick={(e) => { e.stopPropagation(); onToggle(); }}
          className="flex h-full w-full items-center justify-center rounded-l-md text-faint transition-colors duration-120 hover:text-ink active:text-ink"
        >
          <ChevronRight size={13} className={cn('transition-transform duration-180', expanded && 'rotate-90')} />
        </button>
      ) : (
        <span />
      )}
      <KindIcon kind={task.kind} />
      <span className="flex min-w-0 items-center gap-2">
        {/* The title carries its own tooltip: in the docked pane a nested row
            has half the width of a root one, and a truncated title with
            nothing behind it is a row you cannot read at all. */}
        <span
          title={parent ? `${task.title || 'Untitled'} — part of ${parent.title || 'Untitled'}` : task.title || 'Untitled'}
          className={cn(
            'min-w-0 truncate text-sm',
            isGroup && 'font-semibold',
            task.status === 'done' ? 'text-muted line-through' : 'text-ink',
          )}
        >
          {task.title || 'Untitled'}
        </span>
        {/* Counted over the project, so an epic reads the same here as it does
            on the board — and a row that groups nothing says nothing. An epic
            gets the bar as well as the count: how far along it is, is what
            the row is scanned for. */}
        {progress.total > 0 && (
          <span className="flex shrink-0 items-center gap-1.5" title={`${progress.done} of ${progress.total} underneath are done`}>
            {isGroup && (
              <span
                role="progressbar"
                aria-valuenow={pct}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`${task.title || 'Epic'} progress`}
                className="hidden h-1 w-10 overflow-hidden rounded-full bg-line-strong min-[420px]:block"
              >
                <span className="block h-full rounded-full bg-accent-strong" style={{ width: `${pct}%` }} />
              </span>
            )}
            <span className="text-2xs tabular-nums text-faint">{progress.done}/{progress.total}</span>
          </span>
        )}
        {/* What this row waits on is behind its own count, not behind the
            disclosure: the chevron is for what is inside a row, and opening an
            epic should not also unfold a list of blockers. */}
        {links.blockedBy.length > 0 && (
          <button
            type="button"
            aria-expanded={depsOpen}
            aria-label={`Waiting on ${links.blockedBy.length}: ${depsOpen ? 'hide' : 'show'} what`}
            title={`Waiting on ${links.blockedBy.map((t) => t.title || 'Untitled').join(', ')}`}
            onClick={(e) => { e.stopPropagation(); onToggleDeps(); }}
            className={cn(
              'mn-hit flex h-6 shrink-0 items-center justify-center gap-0.5 rounded px-1 text-2xs font-medium text-danger-strong coarse:min-w-11 transition-colors duration-120 hover:bg-danger-soft',
              depsOpen && 'bg-danger-soft',
            )}
          >
            <Link2 size={11} />{links.blockedBy.length}
          </button>
        )}
        {/* Where a row's parent is, when the parent is somewhere else — a
            nested row already shows it by sitting under it. The key alone in
            the docked pane and on a phone, where a title would truncate to
            nothing; the tooltip has the name. */}
        {parent && (
          <span className="flex min-w-0 shrink items-center gap-0.5 text-2xs text-faint" title={`Part of ${parent.title || 'Untitled'}`}>
            <CornerDownRight size={11} className="shrink-0" />
            {parentKey && <span className={cn('shrink-0 font-mono', !compact && 'sm:hidden')}>{parentKey}</span>}
            <span className={cn('max-w-[8rem] truncate', compact ? 'hidden' : parentKey ? 'hidden sm:inline' : 'inline')}>
              {parent.title || 'Untitled'}
            </span>
          </span>
        )}
      </span>
      <span className={cn('text-right', !compact && 'hidden sm:block')}>
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

/** What every row in a tree needs, gathered once by the view that draws it. */
interface TreeContext {
  links: Map<string, TaskLinks>;
  progress: Map<string, { done: number; total: number }>;
  byId: Map<string, TaskRow>;
  collapsed: ReadonlySet<string>;
  depsOpen: ReadonlySet<string>;
  isGroup: (task: TaskRow) => boolean;
  onToggle: (id: string) => void;
  onToggleDeps: (id: string) => void;
  onOpen: (task: TaskRow) => void;
  /** The row being dragged, so a container can say whether it would take it
   *  before the drop — a drag event only carries the data on drop. */
  dragging: string | null;
  setDragging: (id: string | null) => void;
  onSetParent?: (taskId: string, parentId: string) => void;
}

/**
 * A section's rows: the epics with what is inside them, then — under a "No
 * epic" divider — the rows that belong to none.
 *
 * Containment nests — a story sits inside its epic, a task inside its story —
 * and the rail down the left is the edge itself. Loose rows used to sit
 * between the epics, where a stray bug read as part of the epic above it.
 * The divider only appears when there is something on both sides of it.
 */
function TreeRows({ rows, ctx, compact }: { rows: TaskRow[]; ctx: TreeContext; compact?: boolean }) {
  const { grouped, orphans } = sectionRoots(buildTaskTree(rows), ctx.isGroup);
  return (
    <>
      <Branches nodes={grouped} ctx={ctx} compact={compact} />
      {grouped.length > 0 && orphans.length > 0 && (
        <div className="flex items-baseline gap-2 px-2.5 pb-1 pt-3">
          <span className="text-2xs font-semibold uppercase tracking-wide text-faint">No epic</span>
          {/* Said once, where the loose rows are: the two ways to give one a
              home, the second of which works without a mouse. */}
          {ctx.onSetParent && (
            <span className="hidden min-w-0 truncate text-2xs text-faint sm:inline">
              Drag onto an epic, or set Parent in the task panel
            </span>
          )}
        </div>
      )}
      <Branches nodes={orphans} ctx={ctx} compact={compact} />
    </>
  );
}

function Branches({ nodes, ctx, compact }: { nodes: TaskNode[]; ctx: TreeContext; compact?: boolean }) {
  return (
    <>
      {nodes.map((node) => (
        <Branch key={node.task.id} node={node} ctx={ctx} compact={compact} />
      ))}
    </>
  );
}

function Branch({ node, ctx, compact }: { node: TaskNode; ctx: TreeContext; compact?: boolean }) {
  const [over, setOver] = useState(false);
  const task = node.task;
  const links = ctx.links.get(task.id) ?? NO_LINKS;
  const expanded = !ctx.collapsed.has(task.id);
  const depsOpen = ctx.depsOpen.has(task.id);
  // Only a root says where it came from: a nested row is already under its
  // parent, and repeating the name there would be the same word twice.
  const parent = node.depth === 0 && task.parent_id ? ctx.byId.get(task.parent_id) : undefined;
  const settled = links.met + links.unknown;
  const isGroup = ctx.isGroup(task);
  const accepts = !!ctx.onSetParent && !!ctx.dragging
    && canDropOnParent(ctx.byId.get(ctx.dragging), task, ctx.isGroup);

  const drag: React.HTMLAttributes<HTMLDivElement> = {
    draggable: true,
    onDragStart: (e) => {
      e.dataTransfer.setData('text/task-id', task.id);
      e.dataTransfer.effectAllowed = 'move';
      ctx.setDragging(task.id);
    },
    onDragEnd: () => ctx.setDragging(null),
    // An epic row takes a story dropped on it as its child. The event stops
    // here, so the sprint section around the row does not also take it and
    // move the story into that sprint.
    ...(isGroup && {
      onDragOver: (e: React.DragEvent) => {
        if (!accepts) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
        setOver(true);
      },
      onDragLeave: () => setOver(false),
      onDrop: (e: React.DragEvent) => {
        setOver(false);
        if (!accepts) return;
        e.preventDefault();
        e.stopPropagation();
        const id = e.dataTransfer.getData('text/task-id');
        ctx.setDragging(null);
        if (id) ctx.onSetParent?.(id, task.id);
      },
    }),
  };

  return (
    <>
      <TaskLine
        node={node}
        links={links}
        progress={ctx.progress.get(task.id) ?? { done: 0, total: 0 }}
        parent={parent}
        isGroup={isGroup}
        expanded={expanded}
        depsOpen={depsOpen}
        dropping={over && accepts}
        onToggle={() => ctx.onToggle(task.id)}
        onToggleDeps={() => ctx.onToggleDeps(task.id)}
        onOpen={() => ctx.onOpen(task)}
        compact={compact}
        drag={drag}
      />
      {/* Opened from the row's own "waiting on" count. Listed rather than
          nested: the row it waits on usually lives elsewhere in the same list,
          and drawing it as a child would be a second copy of it. Only the
          unfinished ones are named; a met condition is history, counted. */}
      {depsOpen && links.blockedBy.length > 0 && (
        <div className="ml-[calc(var(--disc)/2)] border-l border-dashed border-line-strong pb-1 pl-1 pt-0.5">
          <p className="px-2.5 pb-0.5 text-2xs font-semibold uppercase tracking-wide text-faint">Waits on</p>
          {links.blockedBy.map((dep) => (
            <DepLine key={dep.id} task={dep} onOpen={() => ctx.onOpen(dep)} />
          ))}
          {settled > 0 && (
            <p className="px-2.5 pb-1 pt-0.5 text-2xs text-faint">
              {links.met > 0 && `${links.met} already done`}
              {links.met > 0 && links.unknown > 0 && ' · '}
              {links.unknown > 0 && `${links.unknown} not in this view`}
            </p>
          )}
        </div>
      )}
      {expanded && node.children.length > 0 && (
        // The rail sits under the middle of the disclosure above it, so the
        // line reads as coming out of the control that opened it.
        <div className="ml-[calc(var(--disc)/2)] border-l border-line pl-1">
          <Branches nodes={node.children} ctx={ctx} compact={compact} />
        </div>
      )}
    </>
  );
}

/** One thing that has to happen first. Clicking it opens that row, because the
 *  next question after "what is blocking this" is always "what is that". */
function DepLine({ task, onOpen }: { task: TaskRow; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex h-7 w-full items-center gap-1.5 rounded-md px-2.5 text-left transition-colors duration-120 hover:bg-hover active:bg-selected"
    >
      <Link2 size={11} className="shrink-0 text-danger-strong" />
      <span className="min-w-0 flex-1 truncate text-xs text-muted">{task.title || 'Untitled'}</span>
      <span className="shrink-0 text-2xs text-faint">{STATUS_LABEL[task.status as TaskStatus]}</span>
    </button>
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
  /** Hang a row under a container row — a story dropped on an epic. Absent
   *  turns the drop off; the peek's Parent field still does it. */
  onSetParent?: (taskId: string, parentId: string) => void;
}

/**
 * Sprint planning: the sprints on the left, the backlog kept beside them.
 *
 * Below 1280 the backlog drops under the sprints and the view is the single
 * column it has always been on a phone — two panes at 350px each is not a
 * layout, it is two gutters.
 */
export function Backlog({ tasks, sprints, onOpen, onMoveToSprint, onAdd, onCreateSprint, onPatchSprint, onDeleteSprint, onSetParent }: Props) {
  // 1280, not 1024: the query measures the window, and the docked sidebar takes
  // 316px of it before this view sees any. At 1024 that left the sprint pane at
  // 356px — narrower than the backlog docked beside it, which is the panel
  // reversed. 1280 is the first width where both panes are worth having.
  const twoPane = useMediaQuery('(min-width: 1280px)');
  const backlog = tasks.filter((t) => !t.sprint_id).sort((a, b) => b.priority - a.priority || a.position - b.position);
  const bySprint = (id: string) => tasks.filter((t) => t.sprint_id === id).sort((a, b) => a.position - b.position);

  // Collapsed rather than expanded: the shape is the point of the view, so it
  // opens showing it. What somebody folds away is theirs for this visit only —
  // a planning session is one sitting, and a remembered fold is a row missing
  // from the list the next time with no sign that anything is hidden.
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set<string>());
  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  // Over every row this view holds, not over the section being drawn: an epic
  // split across two sprints and the backlog is still one epic, and a
  // dependency does not stop mattering because it was committed elsewhere.
  // A filter narrows what the view holds, and the counts narrow with it —
  // which is why a dependency outside it is counted apart rather than read as
  // met (see TaskLinks.unknown).
  const links = useMemo(() => buildLinkIndex(tasks), [tasks]);
  const progress = useMemo(() => subtreeIndex(tasks), [tasks]);
  const byId = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const kinds = useKinds();
  const groupKeys = useMemo(() => new Set(kinds.filter((k) => k.is_group).map((k) => k.key)), [kinds]);
  const isGroup = (t: TaskRow) => groupKeys.has(t.kind);

  // "Waits on" lists are opened one at a time from their own count, and start
  // closed: they are an answer to a question, not part of the outline.
  const [depsOpen, setDepsOpen] = useState<ReadonlySet<string>>(() => new Set<string>());
  const toggleDeps = (id: string) =>
    setDepsOpen((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const [dragging, setDragging] = useState<string | null>(null);

  // Every row that can fold, across every section. A row's subtree is built
  // per section, so a story whose epic is in another sprint is a root there.
  const foldable = useMemo(() => {
    const sections = [tasks.filter((t) => !t.sprint_id), ...sprints.map((sp) => tasks.filter((t) => t.sprint_id === sp.id))];
    return sections.flatMap((rows) => branchIds(buildTaskTree(rows)));
  }, [tasks, sprints]);
  const allFolded = foldable.length > 0 && foldable.every((id) => collapsed.has(id));

  const ctx: TreeContext = {
    links, progress, byId, collapsed, depsOpen, isGroup,
    onToggle: toggle, onToggleDeps: toggleDeps, onOpen,
    dragging, setDragging, onSetParent,
  };

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
        {rows.length ? <TreeRows rows={rows} ctx={ctx} /> : (
          <p className="px-3 py-4 text-center text-2xs text-faint">Drag tasks here to plan this sprint.</p>
        )}
      </Section>
    );
  };

  // Dock the backlog beside the sprints only when there are sprints to drag
  // into. With none, the empty sprint column took two thirds of the width and
  // squeezed a whole epic tree into the narrow pane, cutting every title.
  const docked = twoPane && (live.length > 0 || finished.length > 0 || composing);

  const backlogRows = backlog.length
    ? <TreeRows rows={backlog} ctx={ctx} compact={docked} />
    : <p className="px-3 py-6 text-center text-2xs text-faint">Nothing waiting. Every task is in a sprint.</p>;

  return (
    // --disc is the disclosure track every row and rail measures from: a
    // pointer gets 16px, a fingertip the full 44.
    <div className="flex h-full min-h-0 [--disc:1rem] coarse:[--disc:2.75rem]">
      <div className="scrollarea min-w-0 flex-1 overflow-y-auto p-3 sm:p-4">
        <div className="mb-3 flex items-center gap-2">
          <h2 className="mr-auto text-2xs font-semibold uppercase tracking-wide text-muted">Sprints</h2>
          {/* One control for the whole view: folding the epics in one sprint
              and not the backlog beside it is a state nobody asks for. */}
          {foldable.length > 0 && (
            <button
              type="button"
              onClick={() => setCollapsed(allFolded ? new Set<string>() : new Set(foldable))}
              className="mn-hit flex h-6 items-center gap-1 rounded-md px-2 text-2xs font-medium text-muted transition-colors duration-120 hover:bg-hover hover:text-ink"
            >
              {allFolded ? <ChevronsUpDown size={12} /> : <ChevronsDownUp size={12} />}
              {allFolded ? 'Expand all' : 'Collapse all'}
            </button>
          )}
          {composing ? null : (
            <button
              type="button"
              onClick={() => setComposing(true)}
              className="mn-hit flex h-6 items-center gap-1 rounded-md px-2 text-2xs font-medium text-accent-strong transition-colors duration-120 hover:bg-accent-soft"
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
              <button type="submit" className="h-8 shrink-0 rounded-md bg-accent-fill px-3 text-sm font-medium text-white hover:opacity-90">
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
          {!docked && (
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

      {docked && (
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
        // Wider than it was: a flat list fitted in 22rem, but a tree spends
        // width on the shape itself, and every level of nesting comes out of
        // the title. The sprint pane beside it loses 64px and notices nothing.
        //
        // Capped at 45%, because the two panes are picked by the *window* and
        // this view also runs inside a database embedded in a page, where the
        // column is a third of it — there, a fixed 26rem would leave the
        // sprints less room than the backlog docked beside them.
        'flex w-[26rem] max-w-[45%] shrink-0 flex-col border-l border-line transition-colors duration-120 2xl:w-[30rem]',
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
