import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarRange, CheckSquare, KanbanSquare, List, RefreshCw } from 'lucide-react';
import { cn } from '../../lib/cn';
import { docsApi, type UserRow } from '../../lib/docsApi';
import { todayISO } from '../../lib/gantt';
import { swatch } from '../../lib/tagColors';
import { applyFilters, fieldsFor, pruneUnresolvable, type Filter } from '../../lib/taskFilter';
import { STATUS_LABEL, tasksApi, type AnyTaskRow } from '../../lib/tasksApi';
import { useAuth } from '../../store/auth';
import { useWorkspace } from '../../store/workspace';
import { EmptyState } from '../ui/EmptyState';
import { IconButton } from '../ui/IconButton';
import { Skeleton } from '../ui/Skeleton';
import { Board, DOT } from '../project/Board';
import { FilterBar } from '../project/FilterBar';
import { Gantt } from '../project/Gantt';
import { TagFilter } from '../project/TagFilter';
import { SegmentedControl } from '../ui/SegmentedControl';
import { groupOf, groupsFor } from '../../lib/grouping';
import { TASK_SCOPES, dropLegacyOpenChip, inScope, scopeCounts, type TaskScope } from '../../lib/taskScope';
import { ProjectIcon } from '../ui/ProjectIcon';

/** One saved filter set for the whole workspace, per browser — the same
 *  arrangement each project's board already uses for its own. */
const FILTER_KEY = 'mn-filters-all';

/**
 * How this collection is drawn, remembered per browser.
 *
 * The filters above decide WHICH tasks; this decides how they are shown. They
 * were welded together — the workspace list could only ever be a list, so
 * "everything tagged posthog-incident, as a board" was a question the app held
 * all the data to answer and had no way to ask. Separating the two is the
 * whole change: any filter set, any presentation.
 */
const SHAPE_KEY = 'mn-shape-all';
type Shape = 'list' | 'board' | 'timeline';

function readShape(): Shape {
  try {
    const v = localStorage.getItem(SHAPE_KEY);
    return v === 'board' || v === 'timeline' ? v : 'list';
  } catch {
    return 'list';
  }
}

/** Open / overdue / done / all, remembered per browser like the shape. */
const SCOPE_KEY = 'mn-scope-all';
const SCOPE_LABEL: Record<TaskScope, string> = { open: 'Open', overdue: 'Overdue', done: 'Done', all: 'All' };

function readScope(): TaskScope {
  try {
    const v = localStorage.getItem(SCOPE_KEY) as TaskScope | null;
    return v && TASK_SCOPES.includes(v) ? v : 'open';
  } catch {
    return 'open';
  }
}

/** null when this browser has never had a set here, which is not the same as
 *  having deliberately cleared one: only the first opens with a starting view. */
function readFilters(): Filter[] | null {
  try {
    const raw = localStorage.getItem(FILTER_KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? dropLegacyOpenChip(parsed) : [];
  } catch {
    return null;
  }
}


const dueLabel = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

function TagChips({ names, colorOf }: { names: string[]; colorOf: (name: string) => string }) {
  if (!names.length) return null;
  return (
    <span className="flex flex-wrap items-center gap-1">
      {names.map((name) => (
        <span key={name} className={cn('rounded px-1.5 py-0.5 text-3xs font-medium', swatch(colorOf(name)).chip)}>
          {name}
        </span>
      ))}
    </span>
  );
}

/**
 * Every project's work in one list.
 *
 * A board answers "what is happening in this project"; nothing answered "what
 * is on me across all of them", or "what has the team got open under Marketing"
 * — the questions that cross a project boundary, which is exactly where the
 * per-project filter bar stops. This is that bar over the whole workspace, with
 * Project and Focus area added to the fields it can narrow by.
 */
export function TasksView() {
  const ws = useWorkspace();
  const auth = useAuth();
  const [data, setData] = useState<{ tasks: AnyTaskRow[]; kinds: { key: string; label: string }[] } | null>(null);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filter[]>(() => readFilters() ?? []);
  const [shape, setShape] = useState<Shape>(readShape);
  const [scope, setScope] = useState<TaskScope>(readScope);
  const seeded = useRef(readFilters() !== null);

  const load = () => {
    tasksApi.allTasks()
      .then((d) => { setData(d); setError(null); })
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load tasks.'));
  };
  useEffect(load, []);
  useEffect(() => { docsApi.users().then(setUsers).catch(() => setUsers([])); }, []);

  const save = (next: Filter[]) => {
    setFilters(next);
    try {
      localStorage.setItem(FILTER_KEY, JSON.stringify(next));
    } catch {
      /* private mode — the set still holds for this session */
    }
  };

  // Opening on the whole workspace's backlog is a wall. The first visit opens
  // on the one view everybody wants first — my open work — and every part of it
  // is a chip you can drop.
  useEffect(() => {
    if (seeded.current || !auth.user) return;
    seeded.current = true;
    save([
      { id: crypto.randomUUID(), field: 'assignee_id', op: 'is', value: auth.user.id },
    ]);
  }, [auth.user]);

  const tagColor = useMemo(() => {
    const map = new Map(ws.allTags.map((t) => [t.name, t.color]));
    return (name: string) => map.get(name) ?? 'gray';
  }, [ws.allTags]);

  const fields = useMemo(
    () => fieldsFor({
      mode: 'tasks',
      props: [],
      users,
      kinds: data?.kinds ?? [],
      sprints: [],
      tags: ws.allTags.map((t) => t.name),
      projects: ws.projects.map((p) => ({ id: p.id, name: p.name })),
    }),
    [users, data?.kinds, ws.allTags, ws.projects],
  );

  // Custom properties are per project, so they are deliberately not offered
  // here: "Client is Acme" would silently drop every task from a project that
  // never defined a Client. The fields above are the ones every task has.
  // A saved chip whose value no longer exists here (an assignee id from another
  // account, a renamed tag) used to render as "Choose…" and match nothing, so
  // the view opened on an empty list. Once the option lists are known, drop
  // those and remember the cleaned set.
  useEffect(() => {
    if (!data || !users.length) return;
    const kept = pruneUnresolvable(filters, fields);
    if (kept.length !== filters.length) save(kept);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, users, fields]);
  const now = todayISO();
  // The chips decide whose and which; the scope decides open, overdue or done.
  // Counts are taken after the chips, so each segment says what clicking it shows.
  const filtered = data ? applyFilters(data.tasks, pruneUnresolvable(filters, fields), fields) : [];
  const counts = scopeCounts(filtered, now);
  const visible = filtered.filter((t) => inScope(t, scope, now));
  // The board's columns are the status field the filter bar already describes,
  // so the two never disagree about what the statuses are or what they are
  // called. Status is built-in, which is why a board over several projects can
  // be grouped by it at all — a custom property could not.
  const statusField = useMemo(() => fields.find((f) => f.key === 'status'), [fields]);
  // Under Done the other columns can only ever say "Nothing here", and they
  // pushed the one column with anything in it off the screen. Open and Overdue
  // keep the Done column: it is empty, but dragging a card onto it is how a
  // task gets finished from here.
  const boardGroups = useMemo(
    () => (statusField ? groupsFor(statusField) : [])
      .filter((g) => scope !== 'done' || g.value === 'done'),
    [statusField, scope],
  );

  return (
    <div className="flex h-full flex-col bg-canvas">
      <header className="shrink-0 border-b border-line px-4 py-2.5">
        {/* The same column the list keeps, so the chips sit over the rows they
            narrow rather than drifting apart on a wide screen. */}
        <div className="mx-auto flex w-full max-w-[1100px] flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="order-1 flex items-center gap-2 text-sm font-semibold text-ink">
            <CheckSquare size={16} className="text-faint" />
            Tasks
            {data && (
              <span className="text-2xs font-normal text-faint">
                {visible.length === data.tasks.length
                  ? `${data.tasks.length}`
                  : `${visible.length} of ${data.tasks.length}`}
              </span>
            )}
          </h1>
          {/* On a phone the chips take the whole second line. Sharing the first
              one with the heading leaves them about 240px, and a chip is wider
              than that — the value end of every filter was cut off the screen,
              unreadable and unreachable. */}
          <div className="order-3 flex min-w-0 basis-full items-center gap-2 sm:order-2 sm:basis-0 sm:flex-1">
            <TagFilter tags={ws.allTags} filters={filters} onChange={save} />
            <FilterBar fields={fields} filters={filters} onChange={save} />
          </div>
          <div className="order-2 ml-auto flex items-center gap-2 sm:order-3 sm:ml-0">
            <SegmentedControl
              aria-label="How to show these tasks"
              value={shape}
              onChange={(v) => {
                const next = v as Shape;
                setShape(next);
                try { localStorage.setItem(SHAPE_KEY, next); } catch { /* private mode */ }
              }}
              segments={[
                { value: 'list', label: 'List', icon: <List size={14} /> },
                { value: 'board', label: 'Board', icon: <KanbanSquare size={14} /> },
                { value: 'timeline', label: 'Timeline', icon: <CalendarRange size={14} /> },
              ]}
            />
            <IconButton icon={<RefreshCw size={16} />} label="Refresh" onClick={load} />
          </div>
        </div>
        {/* Its own line: sharing the first one squeezed the filter chips until
            they overlapped it. */}
        <div className="mx-auto mt-2 w-full max-w-[1100px]">
          <SegmentedControl
            aria-label="Which tasks"
            value={scope}
            onChange={(v) => {
              const next = v as TaskScope;
              setScope(next);
              try { localStorage.setItem(SCOPE_KEY, next); } catch { /* private mode */ }
            }}
            segments={TASK_SCOPES.map((s) => ({ value: s, label: data ? `${SCOPE_LABEL[s]} ${counts[s]}` : SCOPE_LABEL[s] }))}
          />
        </div>
      </header>

      <div className={cn('min-h-0 flex-1', shape === 'list' ? 'scrollarea overflow-y-auto px-4' : 'flex flex-col overflow-hidden p-3')}>
        <div className={cn(shape === 'list' ? 'mx-auto w-full max-w-[1100px]' : 'flex min-h-0 flex-1 flex-col')}>
        {error && <p className="py-3 text-sm text-danger-strong">{error}</p>}
        {!data ? (
          <div className="space-y-2 py-4">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        ) : visible.length === 0 ? (
          <EmptyState
            icon={CheckSquare}
            title={
              !data.tasks.length ? 'No tasks yet'
                : filtered.length && scope === 'open' ? 'Nothing open'
                : filtered.length && scope === 'overdue' ? 'Nothing overdue'
                : filtered.length && scope === 'done' ? 'Nothing done yet'
                : 'Nothing matches these filters'
            }
            hint={
              !data.tasks.length ? 'Tasks from every project land here.'
                : filtered.length && scope !== 'all' ? 'Switch to All to see every task these filters match.'
                : 'Drop a chip above to widen the list.'
            }
          />
        ) : shape === 'board' ? (
          <Board
            tasks={visible}
            groups={boardGroups}
            groupOf={(t) => (statusField ? groupOf(t, statusField) : '')}
            users={users}
            onOpen={(t) => ws.openProject((t as AnyTaskRow).project_id, t.id)}
            // No `onAdd`: a column here spans every project, so there is no
            // project a new row would belong to. Board draws no "+" without it.
            onMove={(id, value) => {
              tasksApi.patchTask(id, { status: value as AnyTaskRow['status'] }).then(load).catch(() => load());
            }}
          />
        ) : shape === 'timeline' ? (
          <div className="scrollarea min-h-0 flex-1 overflow-auto">
            <Gantt tasks={visible} users={users} onOpen={(t) => ws.openProject((t as AnyTaskRow).project_id, t.id)} />
          </div>
        ) : (
          <ul className="py-1.5">
            {visible.map((t) => {
              const overdue = inScope(t, 'overdue', now);
              return (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => ws.openProject(t.project_id, t.id)}
                    className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-md px-2 py-2 text-left transition-colors duration-120 hover:bg-hover focus-visible:bg-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                  >
                    <span
                      title={STATUS_LABEL[t.status]}
                      className={cn('h-2 w-2 shrink-0 rounded-full', DOT[t.status])}
                    />
                    <span className={cn('min-w-0 flex-1 basis-[14rem] truncate text-sm', t.status === 'done' ? 'text-muted line-through' : 'text-ink')}>
                      {t.title || 'Untitled task'}
                    </span>
                    <TagChips names={t.tags ?? []} colorOf={tagColor} />
                    <span className="flex shrink-0 items-center gap-1 text-2xs text-muted">
                      <ProjectIcon project={{ id: t.project_id, name: t.project_name, icon: t.project_icon }} size={14} />
                      <span className="max-w-[10rem] truncate">{t.project_name}</span>
                    </span>
                    <span className="w-[8.5rem] shrink-0 truncate text-2xs text-muted">
                      {t.assignees?.length ? t.assignees.map((a) => a.name).join(', ') : 'Unassigned'}
                    </span>
                    <span className={cn('w-[4.5rem] shrink-0 text-right text-2xs tabular-nums', overdue ? 'font-medium text-danger-strong' : 'text-faint')}>
                      {t.due_at ? dueLabel(t.due_at) : '—'}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        </div>
      </div>
    </div>
  );
}
