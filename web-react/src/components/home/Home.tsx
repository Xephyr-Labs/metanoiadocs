import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, ChevronLeft, ChevronRight, FileText, Plus, RefreshCw } from 'lucide-react';
import { useAuth } from '../../store/auth';
import { useWorkspace } from '../../store/workspace';
import { docsApi, type MyDocRow } from '../../lib/docsApi';
import { relativeTime } from '../../lib/time';
import { tasksApi, type HomePayload, type MyTask } from '../../lib/tasksApi';
import { PageIcon } from '../ui/PageIcon';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/EmptyState';
import { IconButton } from '../ui/IconButton';
import { Skeleton } from '../ui/Skeleton';
import { ActivityLine, Card, DocCard, ProjectCard, StatTile, TaskBucket } from './cards';

const BUCKETS: MyTask['bucket'][] = ['overdue', 'today', 'week', 'later'];

function greeting(hour: number) {
  if (hour < 5) return 'Still up';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

const MY_DOCS_PAGE = 12;

/** Paginated list of everything the signed-in user created. */
function MyDocsCard({ onOpen }: { onOpen: (id: string) => void }) {
  const [page, setPage] = useState(0);
  const [data, setData] = useState<{ total: number; rows: MyDocRow[] } | null>(null);

  useEffect(() => {
    let stale = false;
    docsApi.myDocs(page * MY_DOCS_PAGE, MY_DOCS_PAGE)
      .then((d) => { if (!stale) setData(d); })
      .catch(() => { if (!stale) setData({ total: 0, rows: [] }); });
    return () => { stale = true; };
  }, [page]);

  const pages = data ? Math.max(1, Math.ceil(data.total / MY_DOCS_PAGE)) : 1;

  return (
    <Card
      title="My documents"
      action={
        pages > 1 ? (
          <span className="flex items-center gap-1 text-2xs text-faint">
            {page + 1}/{pages}
            <IconButton icon={<ChevronLeft size={14} />} label="Previous page" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} />
            <IconButton icon={<ChevronRight size={14} />} label="Next page" onClick={() => setPage((p) => Math.min(pages - 1, p + 1))} disabled={page >= pages - 1} />
          </span>
        ) : undefined
      }
    >
      {!data ? (
        <Skeleton className="h-40 w-full" />
      ) : data.rows.length === 0 ? (
        <EmptyState compact icon={FileText} title="No documents yet" hint="Pages you create show up here." />
      ) : (
        <div className="space-y-px">
          {data.rows.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => onOpen(d.id)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors duration-120 hover:bg-hover"
            >
              <PageIcon icon={d.icon} size={16} />
              <span className="min-w-0 flex-1 truncate text-sm text-ink">{d.title || 'Untitled'}</span>
              <span className="shrink-0 text-2xs text-faint">{relativeTime(d.updated_at)}</span>
            </button>
          ))}
        </div>
      )}
    </Card>
  );
}

/**
 * The landing surface. Sign-in used to drop straight into a document; this
 * answers "what happened, what's mine, what was I doing" first.
 */
export function Home() {
  const ws = useWorkspace();
  const auth = useAuth();
  const [data, setData] = useState<HomePayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await tasksApi.home());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load your dashboard.');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Recents are per-browser (localStorage), so prefer the docs this person
  // actually opened and fall back to workspace-wide recency to fill the row.
  const recents = (() => {
    if (!data) return [];
    const byId = new Map(data.recentDocs.map((d) => [d.id, d]));
    const mine = ws.recentIds
      .map((id) => byId.get(id) ?? (ws.pages[id] && {
        id, title: ws.pages[id].title, icon: ws.pages[id].icon,
        updated_at: ws.pages[id].updatedAt, updated_by_name: null,
      }))
      .filter(Boolean) as HomePayload['recentDocs'];
    const seen = new Set(mine.map((d) => d.id));
    return [...mine, ...data.recentDocs.filter((d) => !seen.has(d.id))].slice(0, 4);
  })();

  const openTask = (t: MyTask) => ws.openProject(t.project_id);

  return (
    <div className="scrollarea h-full overflow-y-auto bg-canvas">
      <div className="mx-auto max-w-[1100px] px-6 py-8 md:px-10">
        <header className="mb-6 flex items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl leading-7 text-ink md:text-4xl md:leading-9">
              {greeting(new Date().getHours())}, {(auth.user?.name || auth.user?.username || 'there').split(' ')[0]}
            </h1>
            <p className="mt-0.5 text-sm text-muted">
              {new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
            </p>
          </div>
          <div className="flex items-center gap-1">
            <IconButton icon={<RefreshCw size={16} />} label="Refresh" onClick={load} />
            <Button variant="primary" leftIcon={<Plus size={16} />} onClick={() => ws.createPage(null)}>
              New page
            </Button>
          </div>
        </header>

        {error && (
          <div className="mb-6 rounded-lg bg-surface px-4 py-3 text-sm text-danger shadow-subtle">{error}</div>
        )}

        {!data ? (
          <div className="space-y-4">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : (
          <>
            {recents.length > 0 && (
              <section className="mb-8">
                <div className="mb-3 flex items-baseline justify-between gap-4">
                  <h2 className="text-sm font-semibold text-ink">Jump back in</h2>
                  <span className="text-2xs text-faint">Recently opened</span>
                </div>
                <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
                  {recents.map((d) => <DocCard key={d.id} doc={d} onOpen={() => ws.select(d.id)} />)}
                </div>
              </section>
            )}

            <div className="mb-8 grid grid-cols-2 gap-x-6 gap-y-3 border-y border-line py-4 md:grid-cols-4">
              <StatTile label="My open tasks" value={Number(data.stats.my_open)} />
              <StatTile label="Overdue" value={Number(data.stats.my_overdue)} tone="danger" />
              <StatTile label="Due this week" value={Number(data.stats.my_week)} tone="accent" />
              <StatTile label="Docs touched this week" value={Number(data.stats.docs_week)} />
            </div>

            {/* Two independent stacks, not grid rows: cards pack downward in
                each column, so a short card never strands empty space beside
                a tall neighbor. */}
            <div className="mb-6 grid items-start gap-4 lg:grid-cols-2">
              <div className="grid gap-4">
                <Card title="My tasks">
                  {BUCKETS.some((b) => data.myTasks[b].length) ? (
                    BUCKETS.map((b) => (
                      <TaskBucket key={b} bucket={b} tasks={data.myTasks[b]} onOpen={openTask} />
                    ))
                  ) : (
                    <EmptyState compact icon={FileText} title="Nothing assigned to you" hint="Tasks you own show up here." />
                  )}
                </Card>

                <MyDocsCard onOpen={(id) => ws.select(id)} />
              </div>

              <Card title="Activity">
                {data.activity.length ? (
                  <div className="scrollarea max-h-[640px] space-y-px overflow-y-auto">
                    {data.activity.map((row, i) => (
                      <ActivityLine
                        key={`${row.kind}-${row.task_id ?? row.doc_id}-${i}`}
                        row={row}
                        onOpen={() => {
                          if (row.project_id) ws.openProject(row.project_id);
                          else if (row.doc_id) ws.select(row.doc_id);
                        }}
                      />
                    ))}
                  </div>
                ) : (
                  <EmptyState compact icon={FileText} title="No activity yet" hint="Edits and comments land here." />
                )}
              </Card>
            </div>

            <section>
              {/* Page-level section heads read sentence-case like "Jump back in";
                  the uppercase eyebrow is reserved for labels inside cards. */}
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink">
                Projects
                {data.projects.length > 0 && (
                  <ArrowRight size={14} className="text-faint" />
                )}
              </h2>
              {data.projects.length ? (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {data.projects.map((p) => (
                    <ProjectCard key={p.id} project={p} onOpen={() => ws.openProject(p.id)} />
                  ))}
                </div>
              ) : (
                <Card>
                  <EmptyState
                    compact
                    icon={FileText}
                    title="No projects yet"
                    hint="A project holds tasks with a board, table, gantt and calendar."
                  />
                </Card>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
