import { useEffect, useState } from 'react';
import { tasksApi, type ProjectRow } from '../../lib/tasksApi';
import { Board } from './Board';
import { KindsProvider } from './kinds';
import { TaskTable } from './TaskTable';
import { useProject } from './useProject';

interface Props {
  projectId: string;
  view: 'board' | 'table';
  onPick: (projectId: string) => void;
  onView: (view: 'board' | 'table') => void;
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
 */
export function EmbeddedDatabase({ projectId, view, onPick, onView }: Props) {
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  useEffect(() => { tasksApi.projects().then(setProjects).catch(() => setProjects([])); }, []);
  const p = useProject(projectId || null);
  const project = projects.find((x) => x.id === projectId) ?? null;

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
