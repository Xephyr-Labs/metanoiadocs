import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, FileText, Plus, RefreshCw } from 'lucide-react';
import { useAuth } from '../../store/auth';
import { useWorkspace } from '../../store/workspace';
import { tasksApi, type HomePayload, type MyTask } from '../../lib/tasksApi';
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
            <h1 className="font-display text-[28px] leading-9 text-ink">
              {greeting(new Date().getHours())}, {(auth.user?.name || auth.user?.username || 'there').split(' ')[0]}
            </h1>
            <p className="mt-0.5 text-[13px] text-muted">
              {new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
            </p>
          </div>
          <div className="flex items-center gap-1">
            <IconButton icon={<RefreshCw size={16} />} label="Refresh" onClick={load} />
            <Button variant="primary" leftIcon={<Plus size={15} />} onClick={() => ws.createPage(null)}>
              New page
            </Button>
          </div>
        </header>

        {error && (
          <div className="mb-6 rounded-lg bg-surface px-4 py-3 text-[13px] text-danger shadow-subtle">{error}</div>
        )}

        {!data ? (
          <div className="space-y-4">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : (
          <>
            <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
              <StatTile label="My open tasks" value={Number(data.stats.my_open)} />
              <StatTile label="Overdue" value={Number(data.stats.my_overdue)} tone="danger" />
              <StatTile label="Due this week" value={Number(data.stats.my_week)} tone="accent" />
              <StatTile label="Docs touched this week" value={Number(data.stats.docs_week)} />
            </div>

            {recents.length > 0 && (
              <section className="mb-6">
                <h2 className="mb-3 text-[13px] font-semibold uppercase tracking-wide text-faint">Jump back in</h2>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  {recents.map((d) => <DocCard key={d.id} doc={d} onOpen={() => ws.select(d.id)} />)}
                </div>
              </section>
            )}

            {/* items-start so a short My-tasks card doesn't stretch to match a
                long activity feed and leave a wall of empty panel. */}
            <div className="mb-6 grid items-start gap-4 lg:grid-cols-2">
              <Card title="My tasks">
                {BUCKETS.some((b) => data.myTasks[b].length) ? (
                  BUCKETS.map((b) => (
                    <TaskBucket key={b} bucket={b} tasks={data.myTasks[b]} onOpen={openTask} />
                  ))
                ) : (
                  <EmptyState compact icon={FileText} title="Nothing assigned to you" hint="Tasks you own show up here." />
                )}
              </Card>

              <Card title="Activity">
                {data.activity.length ? (
                  <div className="scrollarea max-h-[420px] space-y-px overflow-y-auto">
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
              <h2 className="mb-3 flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wide text-faint">
                Projects
                {data.projects.length > 0 && (
                  <ArrowRight size={13} className="text-faint" />
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
