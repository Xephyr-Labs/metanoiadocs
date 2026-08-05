import { useState } from 'react';
import { CalendarDays, GanttChartSquare, KanbanSquare, Plus, Table2, FolderOpen } from 'lucide-react';
import { useWorkspace } from '../../store/workspace';
import type { TaskRow, TaskStatus } from '../../lib/tasksApi';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/EmptyState';
import { SegmentedControl } from '../ui/SegmentedControl';
import { Skeleton } from '../ui/Skeleton';
import { Board } from './Board';
import { Calendar } from './Calendar';
import { Gantt } from './Gantt';
import { TaskDialog } from './TaskDialog';
import { TaskTable } from './TaskTable';
import { useProject } from './useProject';

const TABS = [
  { value: 'board', label: 'Board', icon: <KanbanSquare size={13} /> },
  { value: 'table', label: 'Table', icon: <Table2 size={13} /> },
  { value: 'gantt', label: 'Gantt', icon: <GanttChartSquare size={13} /> },
  { value: 'calendar', label: 'Calendar', icon: <CalendarDays size={13} /> },
];

/** One project, four views over the same task list. */
export function ProjectView() {
  const ws = useWorkspace();
  const project = ws.projects.find((p) => p.id === ws.activeProjectId) ?? null;
  const [tab, setTab] = useState('board');
  const [open, setOpen] = useState<TaskRow | null>(null);
  const p = useProject(ws.activeProjectId);

  if (!project) {
    return (
      <EmptyState
        icon={FolderOpen}
        title="No project selected"
        hint="Pick one from the sidebar, or create a new one."
      />
    );
  }

  const add = async (extra: { status?: TaskStatus; dueAt?: string } = {}) => {
    const title = window.prompt('Task')?.trim();
    if (!title) return;
    const row = await p.create({ title, ...extra });
    // Counts in the sidebar and on Home come from the project list.
    ws.refreshProjects();
    if (row) setOpen({ ...row, deps: [] });
  };

  // Keep the live task in the dialog: patches land in p.tasks, not in `open`.
  const openTask = open ? p.tasks.find((t) => t.id === open.id) ?? null : null;

  return (
    <div className="flex h-full flex-col bg-canvas">
      <header className="flex shrink-0 items-center gap-3 border-b border-line px-4 py-2.5">
        <span className="text-[18px] leading-none">{project.icon}</span>
        <h1 className="min-w-0 flex-1 truncate text-[15px] font-medium text-ink">{project.name}</h1>
        <SegmentedControl aria-label="Project view" segments={TABS} value={tab} onChange={setTab} />
        <Button variant="primary" size="sm" leftIcon={<Plus size={14} />} onClick={() => add()}>
          Task
        </Button>
      </header>

      {p.error && (
        <div className="border-b border-line bg-surface px-4 py-2 text-[13px] text-danger">{p.error}</div>
      )}

      <div className="min-h-0 flex-1">
        {p.loading ? (
          <div className="space-y-3 p-4">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : tab === 'board' ? (
          <Board
            tasks={p.tasks}
            onOpen={setOpen}
            onAdd={(status) => add({ status })}
            onMove={(id, status, position) => {
              p.patch(id, { status, position });
              ws.refreshProjects();
            }}
          />
        ) : tab === 'table' ? (
          <TaskTable
            tasks={p.tasks}
            users={p.users}
            onPatch={p.patch}
            onOpen={setOpen}
            onDelete={(id) => { p.remove(id); ws.refreshProjects(); }}
          />
        ) : tab === 'gantt' ? (
          <Gantt tasks={p.tasks} onOpen={setOpen} />
        ) : (
          <Calendar tasks={p.tasks} onOpen={setOpen} onAdd={(dueAt) => add({ dueAt })} />
        )}
      </div>

      <TaskDialog
        task={openTask}
        tasks={p.tasks}
        users={p.users}
        onClose={() => setOpen(null)}
        onPatch={(id, body) => { p.patch(id, body); ws.refreshProjects(); }}
        onDelete={(id) => { p.remove(id); ws.refreshProjects(); }}
        onAddDep={p.addDep}
        onRemoveDep={p.removeDep}
      />
    </div>
  );
}
