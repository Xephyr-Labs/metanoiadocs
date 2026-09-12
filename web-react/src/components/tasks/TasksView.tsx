import { useEffect, useMemo, useRef, useState } from 'react';
import { CheckSquare, RefreshCw } from 'lucide-react';
import { cn } from '../../lib/cn';
import { docsApi, type UserRow } from '../../lib/docsApi';
import { swatch } from '../../lib/tagColors';
import { applyFilters, fieldsFor, type Filter } from '../../lib/taskFilter';
import { STATUS_LABEL, tasksApi, type AnyTaskRow } from '../../lib/tasksApi';
import { useAuth } from '../../store/auth';
import { useWorkspace } from '../../store/workspace';
import { EmptyState } from '../ui/EmptyState';
import { IconButton } from '../ui/IconButton';
import { Skeleton } from '../ui/Skeleton';
import { DOT } from '../project/Board';
import { FilterBar } from '../project/FilterBar';

/** One saved filter set for the whole workspace, per browser — the same
 *  arrangement each project's board already uses for its own. */
const FILTER_KEY = 'mn-filters-all';

/** null when this browser has never had a set here, which is not the same as
 *  having deliberately cleared one: only the first opens with a starting view. */
function readFilters(): Filter[] | null {
  try {
    const raw = localStorage.getItem(FILTER_KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return null;
  }
}

const today = () => new Date().toISOString().slice(0, 10);

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
      { id: crypto.randomUUID(), field: 'status', op: 'is_none_of', value: 'done' },
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
  const visible = data ? applyFilters(data.tasks, filters, fields) : [];
  const now = today();

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
          <div className="order-3 min-w-0 basis-full sm:order-2 sm:basis-0 sm:flex-1">
            <FilterBar fields={fields} filters={filters} onChange={save} />
          </div>
          <div className="order-2 ml-auto sm:order-3 sm:ml-0">
            <IconButton icon={<RefreshCw size={16} />} label="Refresh" onClick={load} />
          </div>
        </div>
      </header>

      <div className="scrollarea min-h-0 flex-1 overflow-y-auto px-4">
        <div className="mx-auto w-full max-w-[1100px]">
        {error && <p className="py-3 text-sm text-danger">{error}</p>}
        {!data ? (
          <div className="space-y-2 py-4">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        ) : visible.length === 0 ? (
          <EmptyState
            icon={CheckSquare}
            title={data.tasks.length ? 'Nothing matches these filters' : 'No tasks yet'}
            hint={data.tasks.length ? 'Drop a chip above to widen the list.' : 'Tasks from every project land here.'}
          />
        ) : (
          <ul className="py-1.5">
            {visible.map((t) => {
              const overdue = !!t.due_at && t.status !== 'done' && t.due_at.slice(0, 10) < now;
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
                      <span aria-hidden>{t.project_icon}</span>
                      <span className="max-w-[10rem] truncate">{t.project_name}</span>
                    </span>
                    <span className="w-[8.5rem] shrink-0 truncate text-2xs text-muted">
                      {t.assignees?.length ? t.assignees.map((a) => a.name).join(', ') : 'Unassigned'}
                    </span>
                    <span className={cn('w-[4.5rem] shrink-0 text-right text-2xs tabular-nums', overdue ? 'font-medium text-danger' : 'text-faint')}>
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
