import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, Columns3, GanttChartSquare, KanbanSquare, LayoutGrid, ListTodo, MoreHorizontal, Plus, Table2, Tags, FolderOpen } from 'lucide-react';
import { useWorkspace } from '../../store/workspace';
import { cn } from '../../lib/cn';
import type { TaskRow, TaskStatus } from '../../lib/tasksApi';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/EmptyState';
import { IconButton } from '../ui/IconButton';
import { Menu } from '../ui/Menu';
import { field } from '../ui/styles';
import { SegmentedControl } from '../ui/SegmentedControl';
import { Skeleton } from '../ui/Skeleton';
import { applyFilters, fieldsFor, pruneUnresolvable, type Filter } from '../../lib/taskFilter';
import { Backlog } from './Backlog';
import { Board } from './Board';
import { addDays } from '../../lib/gantt';
import { Calendar } from './Calendar';
import { FilterBar } from './FilterBar';
import { TagFilter } from './TagFilter';
import { Gallery } from './Gallery';
import { Gantt } from './Gantt';
import { KindsProvider } from './kinds';
import { PropsDialog } from './props/PropsDialog';
import { PropertyVisibility } from './props/PropertyVisibility';
import { useViewProps } from '../../lib/viewProps';
import { TaskPeek } from './TaskPeek';
import { TaskKindsDialog } from './TaskKindsDialog';
import { TaskTable } from './TaskTable';
import { useProject } from './useProject';

const TABS = [
  { value: 'backlog', label: 'Backlog', icon: <ListTodo size={14} /> },
  { value: 'board', label: 'Board', icon: <KanbanSquare size={14} /> },
  { value: 'table', label: 'Table', icon: <Table2 size={14} /> },
  { value: 'gantt', label: 'Gantt', icon: <GanttChartSquare size={14} /> },
  { value: 'calendar', label: 'Calendar', icon: <CalendarDays size={14} /> },
  { value: 'gallery', label: 'Gallery', icon: <LayoutGrid size={14} /> },
];

/** Backlog, Board and Gantt read status, sprints and start/due dates, which a
 *  data database does not have — so it gets the table, the gallery (which reads
 *  only the row's page), and a calendar only once it has a date property for
 *  one to read. */
const DATA_TABS = TABS.filter(
  (t) => t.value === 'table' || t.value === 'calendar' || t.value === 'gallery',
);

/** One project, five views over the same task list. */
export function ProjectView() {
  const ws = useWorkspace();
  const project = ws.projects.find((p) => p.id === ws.activeProjectId) ?? null;
  const [tab, setTab] = useState('board');
  const [open, setOpen] = useState<TaskRow | null>(null);
  const [kindsOpen, setKindsOpen] = useState(false);
  const [propsOpen, setPropsOpen] = useState(false);
  // Scope for board/table/gantt/calendar: 'all', 'backlog', or a sprint id.
  const [scope, setScope] = useState('all');
  const [filters, setFilters] = useState<Filter[]>([]);
  const p = useProject(ws.activeProjectId);
  const isData = project?.mode === 'data';

  // Arriving from a page that belongs to a task: open that task's panel as soon
  // as the list it lives in has loaded, then forget the request so a later
  // visit to the same board opens on the board itself.
  const { pendingTaskId, clearPendingTask } = ws;
  useEffect(() => {
    if (!pendingTaskId) return;
    const wanted = p.tasks.find((t) => t.id === pendingTaskId);
    if (!wanted) return;
    setOpen(wanted);
    clearPendingTask();
  }, [pendingTaskId, p.tasks, clearPendingTask]);
  const dateProps = useMemo(() => p.props.filter((prop) => prop.type === 'date'), [p.props]);
  // Card views show properties; the table already shows every one as a column
  // and the backlog is a planning list, so neither needs the control.
  const CARD_VIEWS = ['board', 'gantt', 'calendar', 'gallery'];
  const viewProps = useViewProps(ws.activeProjectId, tab, p.props);
  const tabs = useMemo(
    () => (isData ? DATA_TABS.filter((t) => t.value !== 'calendar' || dateProps.length > 0) : TABS),
    [isData, dateProps.length],
  );
  const fields = useMemo(
    () => fieldsFor({
      mode: project?.mode ?? 'tasks',
      props: p.props,
      users: p.users,
      kinds: p.kinds,
      sprints: p.sprints,
      tags: ws.allTags.map((t) => t.name),
    }),
    [project?.mode, p.props, p.users, p.kinds, p.sprints, ws.allTags],
  );

  // Filters are per project and survive a reload, so a view someone set up is
  // still there tomorrow. Per browser, not per account — nothing to sync.
  const filterKey = ws.activeProjectId ? `mn-filters-${ws.activeProjectId}` : null;

  // Sprint ids are per-project; a stale scope from the last project would
  // filter every view down to nothing. Same for a filter naming a property
  // that only the last project had.
  useEffect(() => {
    setScope('all');
    try {
      const saved = filterKey ? localStorage.getItem(filterKey) : null;
      const parsed = saved ? JSON.parse(saved) : [];
      // Anything can be in localStorage — a half-written value, a key someone
      // else's code wrote. JSON.parse succeeding does not make it a filter list.
      setFilters(Array.isArray(parsed) ? parsed : []);
    } catch {
      setFilters([]);
    }
  }, [ws.activeProjectId, filterKey]);
  useEffect(() => {
    if (!tabs.some((t) => t.value === tab)) setTab(tabs[0]?.value ?? 'table');
  }, [tabs, tab]);

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
  const add = async (extra: { status?: TaskStatus; dueAt?: string; sprintId?: string | null; props?: Record<string, unknown> } = {}) => {
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

  // A title edit from the board/table/peek writes tasks.title (and,
  // server-side, docs.title) but never touches ws.pages — the cache
  // EditorArea reads `title` from for a full-screen open. Without this, that
  // path would mount the editor with a stale title and, by design, write it
  // into the document, undoing the very rename that was just made.
  const syncPageTitle = (id: string, body: { title?: string }) => {
    if (body.title === undefined) return;
    const t = p.tasks.find((x) => x.id === id);
    if (t?.doc_id) ws.applyTitleFromEditor(t.doc_id, body.title);
  };

  const scoped = scope === 'all' ? p.tasks
    : scope === 'backlog' ? p.tasks.filter((t) => !t.sprint_id)
    : p.tasks.filter((t) => t.sprint_id === scope);

  // Saved chips that can't resolve in this project (a sprint that was deleted,
  // a member who left) are ignored rather than shown as "Choose…" matching nothing.
  const live = pruneUnresolvable(filters, fields);
  const visible = applyFilters(scoped, live, fields);
  // The backlog is the sprint-planning view, so the sprint scope means nothing
  // there — but the filters still do.
  const backlogTasks = applyFilters(p.tasks, live, fields);

  const changeFilters = (next: Filter[]) => {
    setFilters(next);
    if (!filterKey) return;
    try {
      if (next.length) localStorage.setItem(filterKey, JSON.stringify(next));
      else localStorage.removeItem(filterKey);
    } catch {
      /* private mode — filters still work for this session, just not the next */
    }
  };

  return (
    <KindsProvider kinds={p.kinds}>
    <div className="flex h-full flex-col bg-canvas">
      {/* No project name here: the top bar's path already says which database
          this is, and repeating it made two headings, one of them redundant.
          This row is the controls only. */}
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-4 py-2">
        {tab !== 'backlog' && p.sprints.length > 0 && (
          <select
            aria-label="Sprint scope"
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            className={cn(field, 'h-7 w-auto px-2 text-xs')}
          >
            <option value="all">All tasks</option>
            <option value="backlog">Backlog</option>
            {p.sprints.map((s) => (
              <option key={s.id} value={s.id}>{s.name}{s.state === 'active' ? ' (active)' : ''}</option>
            ))}
          </select>
        )}
        {/* Scope and filters are the same question — what am I looking at —
            so they share a row with the view switcher instead of stacking a
            second full-width bar under it for one word. */}
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <TagFilter tags={ws.allTags} filters={filters} onChange={changeFilters} />
          <FilterBar fields={fields} filters={filters} onChange={changeFilters} />
          {CARD_VIEWS.includes(tab) && (
            <PropertyVisibility
              view={tab}
              visible={viewProps.visible}
              hidden={viewProps.hidden}
              onToggle={viewProps.toggle}
              onMove={viewProps.move}
              onShowAll={viewProps.showAll}
              onHideAll={viewProps.hideAll}
            />
          )}
          {filters.length > 0 && (
            <span className="shrink-0 text-2xs tabular-nums text-faint">
              {visible.length} of {scoped.length}
            </span>
          )}
        </div>
        <SegmentedControl aria-label="Project view" segments={tabs} value={tab} onChange={setTab} />
        <Button variant="primary" size="sm" leftIcon={<Plus size={14} />} onClick={() => add()}>
          {isData ? 'Row' : 'Task'}
        </Button>
        <Menu
          align="end"
          trigger={<IconButton icon={<MoreHorizontal size={16} />} label="Project settings" />}
          items={[
            { icon: Tags, label: 'Task types…', onSelect: () => setKindsOpen(true) },
            { icon: Columns3, label: 'Properties…', onSelect: () => setPropsOpen(true) },
          ]}
        />
      </header>

      {p.error && (
        <div className="border-b border-line bg-surface px-4 py-2 text-sm text-danger">{p.error}</div>
      )}

      <div className="min-h-0 flex-1">
        {p.loading ? (
          <div className="space-y-3 p-4">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : tab === 'backlog' ? (
          <Backlog
            tasks={backlogTasks}
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
            tasks={visible}
            cardProps={viewProps.visible}
            users={p.users}
            onOpen={setOpen}
            onAdd={(status) => add({ status })}
            onMove={(id, status, position) => {
              p.patch(id, { status, position });
              ws.refreshProjects();
            }}
          />
        ) : tab === 'table' ? (
          <TaskTable
            tasks={visible}
            mode={project.mode}
            users={p.users}
            props={p.props}
            onPatch={(id, body) => { p.patch(id, body); syncPageTitle(id, body); }}
            onOpen={setOpen}
            onDelete={(id) => { p.remove(id); ws.refreshProjects(); }}
            onSetProp={p.setProp}
          />
        ) : tab === 'gantt' ? (
          <Gantt tasks={visible} cardProps={viewProps.visible} users={p.users} onOpen={setOpen} />
        ) : tab === 'gallery' ? (
          <Gallery
            tasks={visible}
            cardProps={viewProps.visible}
            users={p.users}
            onOpen={setOpen}
            onAdd={() => add({})}
          />
        ) : (
          <Calendar
            tasks={visible}
            dateProps={isData ? dateProps : []}
            cardProps={viewProps.visible}
            users={p.users}
            onOpen={setOpen}
            onAdd={(date, propId) => add(propId ? { props: { [propId]: date } } : { dueAt: date })}
            onMove={(id, date, propId, days) => {
              if (propId) p.setProp(id, propId, date);
              // A row with a start date keeps its length when it moves; one
              // with only a due date has nothing to keep.
              else if (days) p.patch(id, { startAt: date, dueAt: addDays(date, days - 1) });
              else p.patch(id, { dueAt: date });
            }}
            // Dragging an edge sets that edge only. Pulling the left edge of a
            // row that had just a due date gives it a start, which is how it
            // becomes a span.
            onResize={(id, from, to) => p.patch(id, { startAt: from, dueAt: to })}
          />
        )}
      </div>

      <TaskPeek
        key={openTask?.id ?? 'none'}
        task={openTask}
        mode={project.mode}
        tasks={p.tasks}
        props={p.props}
        sprints={p.sprints}
        users={p.users}
        onClose={() => setOpen(null)}
        onPatch={(id, body) => { p.patch(id, body); ws.refreshProjects(); syncPageTitle(id, body); }}
        onSetProp={p.setProp}
        onDelete={(id) => { p.remove(id); ws.refreshProjects(); }}
        onAddDep={p.addDep}
        onRemoveDep={p.removeDep}
        onManageKinds={() => setKindsOpen(true)}
        onManageProps={() => setPropsOpen(true)}
      />

      <TaskKindsDialog
        open={kindsOpen}
        onOpenChange={setKindsOpen}
        kinds={p.kinds}
        tasks={p.tasks}
        onCreate={p.createKind}
        onPatch={p.patchKind}
        onDelete={p.deleteKind}
      />

      <PropsDialog
        open={propsOpen}
        onOpenChange={setPropsOpen}
        props={p.props}
        projects={ws.projects}
        onCreate={p.createProp}
        onPatch={p.patchProp}
        onReorder={p.reorderProp}
        onDelete={p.deleteProp}
      />
    </div>
    </KindsProvider>
  );
}
