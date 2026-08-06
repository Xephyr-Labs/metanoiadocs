import { useEffect, useState } from 'react';
import { CalendarDays, GanttChartSquare, KanbanSquare, ListTodo, Plus, Table2, FolderOpen } from 'lucide-react';
import { useWorkspace } from '../../store/workspace';
import type { TaskRow, TaskStatus } from '../../lib/tasksApi';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/EmptyState';
import { SegmentedControl } from '../ui/SegmentedControl';
import { Skeleton } from '../ui/Skeleton';
import { Backlog } from './Backlog';
import { Board } from './Board';
import { Calendar } from './Calendar';
import { Gantt } from './Gantt';
import { TaskDialog } from './TaskDialog';
import { TaskTable } from './TaskTable';
import { useProject } from './useProject';

const TABS = [
  { value: 'backlog', label: 'Backlog', icon: <ListTodo size={13} /> },
  { value: 'board', label: 'Board', icon: <KanbanSquare size={13} /> },
  { value: 'table', label: 'Table', icon: <Table2 size={13} /> },
  { value: 'gantt', label: 'Gantt', icon: <GanttChartSquare size={13} /> },
  { value: 'calendar', label: 'Calendar', icon: <CalendarDays size={13} /> },
];

/** One project, five views over the same task list. */
export function ProjectView() {
  const ws = useWorkspace();
  const project = ws.projects.find((p) => p.id === ws.activeProjectId) ?? null;
  const [tab, setTab] = useState('board');
  const [open, setOpen] = useState<TaskRow | null>(null);
  // Scope for board/table/gantt/calendar: 'all', 'backlog', or a sprint id.
  const [scope, setScope] = useState('all');
  const p = useProject(ws.activeProjectId);

  // Sprint ids are per-project; a stale scope from the last project would
  // filter every view down to nothing.
  useEffect(() => setScope('all'), [ws.activeProjectId]);

  if (!project) {
    return (
      <EmptyState
        icon={FolderOpen}
        title="No project selected"
        hint="Pick one from the sidebar, or create a new one."
      />
    );
  }

  // No window.prompt: create untitled and let the dialog's title field take it.
  const add = async (extra: { status?: TaskStatus; dueAt?: string; sprintId?: string | null } = {}) => {
    // A task added while a sprint is scoped lands in that sprint.
    const sprintId = extra.sprintId !== undefined ? extra.sprintId
      : scope !== 'all' && scope !== 'backlog' ? scope : undefined;
    const row = await p.create({ title: '', ...extra, ...(sprintId !== undefined ? { sprintId } : {}) });
    // Counts in the sidebar and on Home come from the project list.
    ws.refreshProjects();
    if (row) setOpen({ ...row, deps: [] });
  };

  // Keep the live task in the dialog: patches land in p.tasks, not in `open`.
  const openTask = open ? p.tasks.find((t) => t.id === open.id) ?? null : null;

  const scoped = scope === 'all' ? p.tasks
    : scope === 'backlog' ? p.tasks.filter((t) => !t.sprint_id)
    : p.tasks.filter((t) => t.sprint_id === scope);

  return (
    <div className="flex h-full flex-col bg-canvas">
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-line px-4 py-2.5">
        <span className="text-[18px] leading-none">{project.icon}</span>
        <h1 className="min-w-0 flex-1 truncate text-[15px] font-medium text-ink">{project.name}</h1>
        {tab !== 'backlog' && p.sprints.length > 0 && (
          <select
            aria-label="Sprint scope"
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            className="h-7 rounded-md border border-line bg-canvas px-2 text-[12px] text-ink outline-none focus:border-accent"
          >
            <option value="all">All tasks</option>
            <option value="backlog">Backlog</option>
            {p.sprints.map((s) => (
              <option key={s.id} value={s.id}>{s.name}{s.state === 'active' ? ' (active)' : ''}</option>
            ))}
          </select>
        )}
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
        ) : tab === 'backlog' ? (
          <Backlog
            tasks={p.tasks}
            sprints={p.sprints}
            onOpen={setOpen}
            onMoveToSprint={(id, sprintId) => p.patch(id, { sprintId })}
            onAdd={(sprintId) => add({ sprintId })}
            onCreateSprint={p.createSprint}
            onPatchSprint={p.patchSprint}
            onDeleteSprint={p.deleteSprint}
          />
        ) : tab === 'board' ? (
          <Board
            tasks={scoped}
            onOpen={setOpen}
            onAdd={(status) => add({ status })}
            onMove={(id, status, position) => {
              p.patch(id, { status, position });
              ws.refreshProjects();
            }}
          />
        ) : tab === 'table' ? (
          <TaskTable
            tasks={scoped}
            users={p.users}
            onPatch={p.patch}
            onOpen={setOpen}
            onDelete={(id) => { p.remove(id); ws.refreshProjects(); }}
          />
        ) : tab === 'gantt' ? (
          <Gantt tasks={scoped} onOpen={setOpen} />
        ) : (
          <Calendar tasks={scoped} onOpen={setOpen} onAdd={(dueAt) => add({ dueAt })} />
        )}
      </div>

      <TaskDialog
        task={openTask}
        tasks={p.tasks}
        sprints={p.sprints}
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
