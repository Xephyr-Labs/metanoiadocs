import { useEffect, useState } from 'react';
import { Columns3, FolderOpen, MoreHorizontal, Plus, Tags } from 'lucide-react';
import { useWorkspace } from '../../store/workspace';
import { cn } from '../../lib/cn';
import { VIEW_KINDS, type TaskRow, type TaskStatus, type ViewKind } from '../../lib/tasksApi';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/EmptyState';
import { IconButton } from '../ui/IconButton';
import { Menu } from '../ui/Menu';
import { field } from '../ui/styles';
import { Skeleton } from '../ui/Skeleton';
import { Backlog } from './Backlog';
import { Board } from './Board';
import { addDays } from '../../lib/gantt';
import { Calendar } from './Calendar';
import { FilterBar } from './FilterBar';
import { SortBar } from './SortBar';
import { GroupBy } from './GroupBy';
import { TagFilter } from './TagFilter';
import { Gallery } from './Gallery';
import { Gantt } from './Gantt';
import { KindsProvider } from './kinds';
import { PropsDialog } from './props/PropsDialog';
import { PropertyVisibility } from './props/PropertyVisibility';
import { ViewTabs } from './ViewTabs';
import { TaskPeek } from './TaskPeek';
import { TaskKindsDialog } from './TaskKindsDialog';
import { TaskTable } from './TaskTable';
import { useDatabaseView } from './useDatabaseView';
import { useProject } from './useProject';
import { useViews } from './useViews';

/** Backlog, Board and Gantt read status, sprints and start/due dates, which a
 *  data database does not have. */
const DATA_KINDS: ViewKind[] = ['table', 'calendar', 'gallery'];

/** Views that draw properties on a card or in a column — the backlog is a
 *  planning list, not a grid of values. */
const SHOWS_PROPS = new Set<ViewKind>(['board', 'table', 'gantt', 'calendar', 'gallery']);

/** One database, as many saved views as anyone cares to make. */
export function ProjectView() {
  const ws = useWorkspace();
  const project = ws.projects.find((p) => p.id === ws.activeProjectId) ?? null;
  const [open, setOpen] = useState<TaskRow | null>(null);
  const [kindsOpen, setKindsOpen] = useState(false);
  const [propsOpen, setPropsOpen] = useState(false);
  // Status colours live on the project row, so a repaint has to refresh the
  // list the sidebar and this screen both read.
  const p = useProject(ws.activeProjectId, ws.refreshProjects);
  const v = useViews(ws.activeProjectId);
  const isData = project?.mode === 'data';

  const d = useDatabaseView({
    project,
    source: p,
    view: v.active,
    tagNames: ws.allTags.map((t) => t.name),
    onSave: (patch) => { if (v.activeId) v.setConfig(v.activeId, patch); },
  });

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

  if (!project) {
    return (
      <EmptyState
        icon={FolderOpen}
        title="No project selected"
        hint="Pick one from the sidebar, or create a new one."
      />
    );
  }

  const kinds = isData ? DATA_KINDS : VIEW_KINDS;
  const dateProps = p.props.filter((prop) => prop.type === 'date');

  // No window.prompt: create untitled and let the panel's title field take it.
  const add = async (extra: { status?: TaskStatus; dueAt?: string; sprintId?: string | null; props?: Record<string, unknown> } = {}) => {
    // A task added while a sprint is scoped lands in that sprint.
    const sprintId = extra.sprintId !== undefined ? extra.sprintId
      : d.scope !== 'all' && d.scope !== 'backlog' ? d.scope : undefined;
    const row = await p.create({ title: '', ...extra, ...(sprintId !== undefined ? { sprintId } : {}) });
    // Counts in the sidebar and on Home come from the project list.
    ws.refreshProjects();
    if (row) setOpen({ ...row, deps: [] });
  };

  // Keep the live task in the panel: patches land in p.tasks, not in `open`.
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

  return (
    <KindsProvider kinds={p.kinds}>
    <div className="flex h-full flex-col bg-canvas">
      {/* Two rows: which view, then how that view is narrowed. They were one,
          and at six tabs plus filters plus properties it wrapped on anything
          narrower than a desktop. */}
      <header className="shrink-0 border-b border-line px-4 pt-1.5">
        <div className="flex items-center gap-2">
          <ViewTabs
            views={v.views}
            activeId={v.activeId}
            kinds={kinds}
            onSelect={v.setActiveId}
            onCreate={(k) => v.create(k)}
            onRename={v.rename}
            onRetype={v.retype}
            onDuplicate={v.duplicate}
            onDelete={(id) => { void v.remove(id); }}
          />
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <Button variant="primary" size="sm" leftIcon={<Plus size={14} />} onClick={() => add()}>
              {isData ? 'Row' : 'Task'}
            </Button>
            <Menu
              align="end"
              trigger={<IconButton icon={<MoreHorizontal size={16} />} label="Database settings" />}
              items={[
                { icon: Tags, label: 'Task types…', onSelect: () => setKindsOpen(true) },
                { icon: Columns3, label: 'Properties…', onSelect: () => setPropsOpen(true) },
              ]}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 py-1.5">
          {d.kind !== 'backlog' && p.sprints.length > 0 && (
            <select
              aria-label="Sprint scope"
              value={d.scope}
              onChange={(e) => d.setScope(e.target.value)}
              className={cn(field, 'h-7 w-auto px-2 text-xs')}
            >
              <option value="all">All tasks</option>
              <option value="backlog">Backlog</option>
              {p.sprints.map((s) => (
                <option key={s.id} value={s.id}>{s.name}{s.state === 'active' ? ' (active)' : ''}</option>
              ))}
            </select>
          )}
          <TagFilter tags={ws.allTags} filters={d.filters} onChange={d.setFilters} />
          <FilterBar fields={d.fields} filters={d.filters} onChange={d.setFilters} />
          <SortBar fields={d.fields} sort={d.sort} onChange={d.setSort} />
          {d.kind === 'board' && (
            <GroupBy fields={d.fields} value={d.groupField?.key ?? null} onChange={d.setGroupBy} />
          )}
          {SHOWS_PROPS.has(d.kind) && (
            <PropertyVisibility
              view={d.kind}
              visible={d.visible}
              hidden={d.hidden}
              onToggle={d.toggleProp}
              onMove={d.moveProp}
              onShowAll={d.showAllProps}
              onHideAll={d.hideAllProps}
            />
          )}
          {(d.filters.length > 0 || d.sort.length > 0) && (
            <span className="shrink-0 text-2xs tabular-nums text-faint">
              {d.tasks.length} of {d.scopedCount}
            </span>
          )}
        </div>
      </header>

      {p.error && (
        <div className="border-b border-line bg-surface px-4 py-2 text-sm text-danger">{p.error}</div>
      )}

      <div className="min-h-0 flex-1">
        {p.loading || v.loading ? (
          <div className="space-y-3 p-4">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : d.kind === 'backlog' ? (
          <Backlog
            tasks={d.backlogTasks}
            sprints={p.sprints}
            onOpen={setOpen}
            onMoveToSprint={(id, sprintId) => p.patch(id, { sprintId })}
            onAdd={(sprintId) => add({ sprintId })}
            onCreateSprint={p.createSprint}
            onPatchSprint={p.patchSprint}
            onDeleteSprint={p.deleteSprint}
          />
        ) : d.kind === 'board' ? (
          <Board
            tasks={d.tasks}
            groups={d.groups}
            groupOf={d.groupOf}
            cardProps={d.visible}
            users={p.users}
            onOpen={setOpen}
            onAdd={(value) => add(d.groupSeed(value))}
            onMove={(id, value, position) => { d.moveToGroup(id, value, position); ws.refreshProjects(); }}
          />
        ) : d.kind === 'table' ? (
          <TaskTable
            tasks={d.tasks}
            props={d.visible}
            users={p.users}
            rowLabel={isData ? 'Name' : 'Task'}
            onPatch={(id, body) => { p.patch(id, body); syncPageTitle(id, body); ws.refreshProjects(); }}
            onOpen={setOpen}
            onDelete={(id) => { p.remove(id); ws.refreshProjects(); }}
            onSetProp={p.setProp}
            onEditOptions={p.editOptions}
            // A focus area is a tag on the task's page, so both the task list
            // and the workspace's tag counts have to be re-read.
            onTagsChanged={() => { p.refresh(); ws.refreshTags(); }}
          />
        ) : d.kind === 'gantt' ? (
          <Gantt tasks={d.tasks} cardProps={d.visible} users={p.users} onOpen={setOpen} />
        ) : d.kind === 'gallery' ? (
          <Gallery
            tasks={d.tasks}
            cardProps={d.visible}
            allProps={d.allProps}
            users={p.users}
            onOpen={setOpen}
            onAdd={() => add({})}
          />
        ) : (
          <Calendar
            tasks={d.tasks}
            dateProps={isData ? dateProps : []}
            cardProps={d.visible}
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
        onEditOptions={p.editOptions}
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
