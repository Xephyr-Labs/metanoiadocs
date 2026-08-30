import { useEffect, useState } from 'react';
import { tasksApi, type ProjectRow } from '../../lib/tasksApi';
import { Skeleton } from '../ui/Skeleton';
import { Board } from './Board';
import { KindsProvider } from './kinds';
import { TaskTable } from './TaskTable';
import { useProject } from './useProject';

interface Props {
  projectId: string;
  view: 'board' | 'table';
  onPick: (projectId: string) => void;
  onView: (view: 'board' | 'table') => void;
  /** True in a public share or a version snapshot: the project/task endpoints
   *  this block reads need a member session and 401 there. Skip fetching them
   *  and say so, rather than fetching anyway and reporting the database gone. */
  unavailable?: boolean;
}

/**
 * Renders the SAME Board/TaskTable components the full project screen uses, so
 * an embedded view can't drift from what a click-through to the project shows.
 * Opens nothing — `onOpen` is a no-op — because a peek belongs to the project
 * screen, not to a block inside a document.
 *
 * This mounts inside its own React root (see database-block.ts), a separate
 * tree from the app's main root — `useWorkspace()`'s context can't cross that
 * boundary, so the project list is fetched directly here, the same
 * context-free REST pattern `useProject` below already uses.
 *
 * Refetches on window focus so a rename/delete/create made elsewhere while
 * this document stays open is picked up. An embed in a tab that never loses
 * focus won't see the update until it does — same residual gap `useProject`
 * itself has (no live push channel exists for project metadata).
 */
export function EmbeddedDatabase({ projectId, view, onPick, onView, unavailable }: Props) {
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(!unavailable);
  useEffect(() => {
    if (unavailable) return;
    const fetchProjects = () => tasksApi.projects().then(setProjects).catch(() => {}).finally(() => setProjectsLoading(false));
    fetchProjects();
    window.addEventListener('focus', fetchProjects);
    return () => window.removeEventListener('focus', fetchProjects);
  }, [unavailable]);
  const p = useProject(unavailable ? null : (projectId || null));
  const project = projects.find((x) => x.id === projectId) ?? null;

  if (unavailable) {
    return <p className="rounded-md border border-line p-4 text-sm text-faint">This embedded database isn't available here.</p>;
  }
  if (projectsLoading) {
    return <Skeleton className="h-24 w-full" />;
  }
  if (!projectId) {
    return (
      <div className="rounded-md border border-line p-4">
        <select className="w-full" defaultValue="" onChange={(e) => e.target.value && onPick(e.target.value)}>
          <option value="">Pick a database…</option>
          {projects.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
      </div>
    );
  }
  if (!project) {
    return <p className="rounded-md border border-line p-4 text-sm text-faint">That database no longer exists.</p>;
  }

  return (
    <KindsProvider kinds={p.kinds}>
      <div className="rounded-md border border-line">
        <header className="flex items-center gap-2 border-b border-line px-3 py-2">
          <span>{project.icon}</span>
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{project.name}</span>
          <select className="text-2xs" value={view} onChange={(e) => onView(e.target.value as 'board' | 'table')}>
            <option value="table">Table</option>
            <option value="board">Board</option>
          </select>
        </header>
        {view === 'board'
          ? <Board tasks={p.tasks} onOpen={() => {}} onAdd={() => {}} onMove={(id, status, position) => p.patch(id, { status, position })} />
          : <TaskTable tasks={p.tasks} users={p.users} props={p.props} onPatch={p.patch} onSetProp={p.setProp} onOpen={() => {}} onDelete={p.remove} />}
      </div>
    </KindsProvider>
  );
}
