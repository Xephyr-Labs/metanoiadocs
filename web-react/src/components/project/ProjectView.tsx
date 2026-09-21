/* Hallmark · component: one database, many saved views · genre: modern-minimal
 * pre-emit critique: P5 H5 E4 S5 R5 V4
 * theme: project tokens (index.css)
 * states: loading · empty (no project) · error · view open · peek open ·
 *         filtered · sorted · grouped · data mode (three views)
 * note: two header rows — which view, then how it is narrowed — separated by a
 *       hairline so navigation and chrome are not one undifferentiated field.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, Columns3, Download, FolderOpen, Hash, Inbox, LayoutTemplate, MoreHorizontal, Plus, Tags, Upload, Zap } from 'lucide-react';
import { useWorkspace } from '../../store/workspace';
import { showDatabase } from '../../lib/route';
import { tasksApi, VIEW_KINDS, type RowTemplateRow, type TaskRow, type TaskStatus, type ViewKind } from '../../lib/tasksApi';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/EmptyState';
import { IconButton } from '../ui/IconButton';
import { Menu } from '../ui/Menu';
import { Skeleton } from '../ui/Skeleton';
import { Backlog } from './Backlog';
import { BulkBar } from './BulkBar';
import { Board } from './Board';
import { addDays } from '../../lib/gantt';
import { Calendar } from './Calendar';
import { Dashboard } from './Dashboard';
import { FilterBar } from './FilterBar';
import { SortBar } from './SortBar';
import { GroupBy } from './GroupBy';
import { TagFilter } from './TagFilter';
import { Gallery } from './Gallery';
import { Gantt } from './Gantt';
import { KindsProvider } from './kinds';
import { SearchSelect } from '../ui/SearchSelect';
import { PropsDialog } from './props/PropsDialog';
import { PropertyVisibility } from './props/PropertyVisibility';
import { ViewTabs } from './ViewTabs';
import { TaskPeek } from './TaskPeek';
import { AutomationsDialog } from './AutomationsDialog';
import { ProjectKeyDialog } from './ProjectKeyDialog';
import { IntakeFormDialog } from './IntakeFormDialog';
import { CsvDialog } from './CsvDialog';
import { downloadCsv, tasksToRows, toCsv } from '../../lib/csv';
import { RowTemplatesDialog } from './RowTemplatesDialog';
import { TaskKindsDialog } from './TaskKindsDialog';
import { TaskTable } from './TaskTable';
import { useDatabaseView } from './useDatabaseView';
import { useProject } from './useProject';
import { useTaskSelection } from './useTaskSelection';
import { useRowKeys } from './useRowKeys';
import { useViews } from './useViews';

/** A stable empty list, so a view with no rows to walk does not hand the key
 *  listener a fresh array to re-subscribe to on every render. */
const EMPTY_IDS: string[] = [];

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
  const [keyOpen, setKeyOpen] = useState(false);
  const [autoOpen, setAutoOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [csvOpen, setCsvOpen] = useState(false);
  const [rowTemplatesOpen, setRowTemplatesOpen] = useState(false);
  const [rowTemplates, setRowTemplates] = useState<RowTemplateRow[]>([]);
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
  // The ids the current view is showing, in the order the eye reads them — down
  // a table, but column by column on a board, which is not the order the
  // filtered list is in. Both the selection and j/k walk this, so a shift-click
  // on a board takes the run you can actually see rather than a slice of the
  // underlying list interleaved across four columns.
  //
  // Keyed by the joined ids rather than by the array: d.tasks is rebuilt on
  // every render (it is a filter and a sort, not a memo), so identity alone
  // would re-arm the key listener and rebuild every callback each time.
  const orderedIds = d.kind === 'board'
    ? d.groups.flatMap((g) => d.tasks.filter((t) => d.groupOf(t) === g.value).map((t) => t.id))
    : d.tasks.map((t) => t.id);
  const idKey = orderedIds.join(',');
  const rowIds = useMemo(() => (idKey ? idKey.split(',') : []), [idKey]);

  const sel = useTaskSelection(rowIds);

  // j/k/Enter/x walk the rows the board and the table draw. Off while the peek
  // owns the keyboard, and off on the views whose rows are not a flat list.
  const walkable = d.kind === 'table' || d.kind === 'board';
  const focusId = useRowKeys({
    enabled: walkable && !open,
    ids: walkable ? rowIds : EMPTY_IDS,
    onOpen: (id) => { const t = d.tasks.find((x) => x.id === id); if (t) setOpen(t); },
    onToggle: (id) => sel.onSelect(id, false),
    onClear: sel.clear,
  });

  // The New button's menu is built from these, so they are read once per
  // database rather than when the menu opens — a menu that appears empty for a
  // moment and then grows is a menu people click through.
  const projectId = project?.id ?? null;
  const loadRowTemplates = useCallback(() => {
    if (!projectId) return;
    tasksApi.rowTemplates(projectId).then(setRowTemplates).catch(() => setRowTemplates([]));
  }, [projectId]);
  useEffect(() => { setRowTemplates([]); loadRowTemplates(); }, [loadRowTemplates]);

  const { pendingTaskId, clearPendingTask, pendingViewId, clearPendingView } = ws;
  useEffect(() => {
    if (!pendingTaskId) return;
    const wanted = p.tasks.find((t) => t.id === pendingTaskId);
    if (!wanted) return;
    setOpen(wanted);
    clearPendingTask();
  }, [pendingTaskId, p.tasks, clearPendingTask]);

  // A /db/<id>/<view> link names the view it wants. Applied once the list has
  // loaded, then forgotten — after that the screen owns which view is open.
  const { views, setActiveId } = v;
  useEffect(() => {
    if (!pendingViewId || !views.some((x) => x.id === pendingViewId)) return;
    setActiveId(pendingViewId);
    clearPendingView();
  }, [pendingViewId, views, setActiveId, clearPendingView]);

  // Keep the address on the open view, so a copied link reopens what is on
  // screen rather than the database's first view.
  useEffect(() => {
    if (ws.view === 'project' && ws.activeProjectId && v.activeId) {
      showDatabase(ws.activeProjectId, v.activeId, { replace: true });
    }
  }, [ws.view, ws.activeProjectId, v.activeId]);

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

  /** Start a row from a template — the server merges, this only names it. */
  const addFromTemplate = async (t: RowTemplateRow) => {
    const row = await p.create({ title: '', templateId: t.id });
    ws.refreshProjects();
    if (row) setOpen({ ...row, deps: [] });
  };

  /**
   * The view on screen, as a file.
   *
   * Written here rather than fetched from the server because "this view" means
   * its filters, its sort and its visible columns — all of which live in this
   * browser. A server route would need a second copy of the filter engine, and
   * the day the two disagree is the day an export quietly drops rows.
   */
  const exportCsv = () => {
    const name = [project?.name, v.views.find((x) => x.id === v.activeId)?.name]
      .filter(Boolean).join(' — ') || 'database';
    // The columns on screen — or, where the view draws none of them (Backlog,
    // Board, the gantt), every property there is. A file of nothing but titles
    // is not what anybody means by "export this".
    const columns = d.visible.length ? d.visible : d.allProps;
    downloadCsv(name, toCsv(tasksToRows(d.tasks, columns, p.users)));
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
      <header className="shrink-0 border-b border-line">
        {/* Row one is navigation, row two is chrome. Without the rule between
            them the whole header reads as one grey field and neither row leads. */}
        <div className="flex items-center gap-2 border-b border-line px-4 py-1.5">
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
            <div className="flex items-center">
              <Button
                variant="primary"
                size="sm"
                leftIcon={<Plus size={14} />}
                className={rowTemplates.length ? 'rounded-r-none' : undefined}
                onClick={() => add()}
              >
                {isData ? 'Row' : 'Task'}
              </Button>
              {/* Only where there is something to choose. A chevron that opens
                  a menu of one item is a chevron that wastes a click. */}
              {rowTemplates.length > 0 && (
                <Menu
                  align="end"
                  trigger={(
                    <button
                      type="button"
                      aria-label="Start from a template"
                      className="flex h-7 items-center rounded-r border-y border-r border-accent-fill bg-accent-fill pl-0.5 pr-1.5 text-white
                                 transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      <ChevronDown size={14} />
                    </button>
                  )}
                  items={[
                    ...rowTemplates.map((t) => ({
                      label: `${t.icon}  ${t.name}`,
                      onSelect: () => { void addFromTemplate(t); },
                    })),
                    {
                      icon: LayoutTemplate,
                      label: 'Manage templates…',
                      separatorBefore: true,
                      onSelect: () => setRowTemplatesOpen(true),
                    },
                  ]}
                />
              )}
            </div>
            <Menu
              align="end"
              trigger={<IconButton icon={<MoreHorizontal size={16} />} label="Database settings" />}
              items={[
                { icon: Tags, label: 'Task types…', onSelect: () => setKindsOpen(true) },
                { icon: Columns3, label: 'Properties…', onSelect: () => setPropsOpen(true) },
                { icon: Zap, label: 'Automations…', onSelect: () => setAutoOpen(true) },
                { icon: Hash, label: isData ? 'Row key…' : 'Task key…', onSelect: () => setKeyOpen(true) },
                { icon: LayoutTemplate, label: isData ? 'Row templates…' : 'Task templates…', onSelect: () => setRowTemplatesOpen(true) },
                { icon: Inbox, label: 'Intake form…', onSelect: () => setFormOpen(true) },
                { icon: Upload, label: 'Import a CSV…', separatorBefore: true, onSelect: () => setCsvOpen(true) },
                { icon: Download, label: 'Export this view as CSV', onSelect: exportCsv },
              ]}
            />
          </div>
        </div>

        {/* Row one scrolls, row two wraps — deliberately different, because a
            tab strip that reflows onto two lines loses its order and a row of
            filter chips that scrolls hides the ones you set. */}
        <div className="flex flex-wrap items-center gap-2 px-4 py-1.5">
          {d.kind !== 'backlog' && p.sprints.length > 0 && (
            <SearchSelect
              variant="inline"
              label="Sprint scope"
              className="h-7 rounded-md px-2 ring-1 ring-inset ring-line"
              value={d.scope}
              options={[
                { value: 'all', label: 'All tasks' },
                { value: 'backlog', label: 'Backlog' },
                ...p.sprints.map((s) => ({ value: s.id, label: s.name, hint: s.state === 'active' ? 'active' : undefined })),
              ]}
              onChange={d.setScope}
            />
          )}
          <TagFilter tags={ws.allTags} filters={d.filters} onChange={d.setFilters} />
          <FilterBar fields={d.fields} filters={d.filters} onChange={d.setFilters} />
          {/* A chart has no row order, so there is nothing for a sort to do. */}
          {d.kind !== 'dashboard' && <SortBar fields={d.fields} sort={d.sort} onChange={d.setSort} />}
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
        <div className="border-b border-line bg-surface px-4 py-2 text-sm text-danger-strong">{p.error}</div>
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
            selected={sel.selected}
            onSelect={sel.onSelect}
            focusedId={focusId}
          />
        ) : d.kind === 'table' ? (
          <TaskTable
            tasks={d.tasks}
            props={d.visible}
            users={p.users}
            rowLabel={isData ? 'Name' : 'Task'}
            // Widths are per person (localStorage, keyed by view); order is
            // shared and goes back into the view's own `props` array.
            viewId={v.activeId ?? undefined}
            onReorder={(ids) => d.setProps(ids)}
            onPatch={(id, body) => { p.patch(id, body); syncPageTitle(id, body); ws.refreshProjects(); }}
            onOpen={setOpen}
            onDelete={(id) => { p.remove(id); ws.refreshProjects(); }}
            onSetProp={p.setProp}
            onEditOptions={p.editOptions}
            // A focus area is a tag on the task's page, so both the task list
            // and the workspace's tag counts have to be re-read.
            onTagsChanged={() => { p.refresh(); ws.refreshTags(); }}
            selected={sel.selected}
            onSelect={sel.onSelect}
            onToggleAll={sel.toggleAll}
            focusedId={focusId}
          />
        ) : d.kind === 'gantt' ? (
          <Gantt tasks={d.tasks} cardProps={d.visible} users={p.users} onOpen={setOpen} />
        ) : d.kind === 'dashboard' ? (
          // The same filtered list every other view reads, so narrowing the
          // view narrows the charts.
          <Dashboard tasks={d.tasks} sprints={p.sprints} scope={d.scope} statusColors={d.statusColors} />
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

      {/* Only where a selection can be made — the board and the table are the
          two views with checkboxes on their rows. */}
      {sel.count > 0 && (d.kind === 'table' || d.kind === 'board') && (
        <BulkBar
          count={sel.count}
          ids={sel.ids}
          users={p.users}
          sprints={p.sprints}
          isData={isData}
          onPatch={async (ids, body) => {
            // Sequential, not Promise.all: every one of these is an UPDATE on
            // the same table plus a webhook, and twenty at once is how a small
            // Postgres ends up refusing the twenty-first.
            for (const id of ids) await p.patch(id, body);
            ws.refreshProjects();
          }}
          onDelete={async (ids) => {
            for (const id of ids) await p.remove(id);
            ws.refreshProjects();
          }}
          onClear={sel.clear}
        />
      )}

      <IntakeFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        projectId={project.id}
        projectName={project.name}
      />

      <CsvDialog
        open={csvOpen}
        onOpenChange={setCsvOpen}
        projectId={project.id}
        onImported={() => { p.refresh(); ws.refreshProjects(); }}
      />

      <RowTemplatesDialog
        open={rowTemplatesOpen}
        onOpenChange={setRowTemplatesOpen}
        projectId={project.id}
        props={d.allProps}
        users={p.users}
        noun={isData ? 'row' : 'task'}
        onChanged={loadRowTemplates}
      />

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
        statusColors={project.status_colors}
        onManageKinds={() => setKindsOpen(true)}
        onManageProps={() => setPropsOpen(true)}
        onEditOptions={p.editOptions}
        onTagsChanged={p.refresh}
      />

      <ProjectKeyDialog
        open={keyOpen}
        onOpenChange={setKeyOpen}
        project={project}
        tasks={p.tasks}
        isData={isData}
        // A key change rewrites every title the server holds; both lists on
        // screen are reading the old ones.
        onSaved={() => { ws.refreshProjects(); p.refresh(); }}
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

      <AutomationsDialog
        open={autoOpen}
        onOpenChange={setAutoOpen}
        projectId={project.id}
        kinds={p.kinds}
        sprints={p.sprints}
        users={p.users}
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
