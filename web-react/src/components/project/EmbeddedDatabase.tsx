/* Hallmark · component: database embedded in a page · genre: modern-minimal
 * theme: project tokens (index.css)
 * pre-emit critique: P5 H5 E4 S5 R5 V4
 * states: loading · picker (no database chosen) · missing · unavailable
 *         (share/snapshot) · default · header hidden · full width · resizing
 */
import { createElement } from 'react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import {
  CalendarDays, Columns3, ExternalLink, GanttChartSquare, KanbanSquare, LayoutGrid,
  ListTodo, Maximize2, Minimize2, MoreHorizontal, PieChart, Table2,
} from 'lucide-react';
import { requestOpenProject } from '../../lib/navSignal';
import { addDays } from '../../lib/gantt';
import { tasksApi, type ProjectRow, type ViewKind } from '../../lib/tasksApi';
import { cn } from '../../lib/cn';
import { IconButton } from '../ui/IconButton';
import { Menu } from '../ui/Menu';
import { Skeleton } from '../ui/Skeleton';
import { SearchSelect } from '../ui/SearchSelect';
import { TooltipProvider } from '../ui/Tooltip';
import { Backlog } from './Backlog';
import { Board } from './Board';
import { Calendar } from './Calendar';
import { FilterBar } from './FilterBar';
import { Dashboard } from './Dashboard';
import { Gallery } from './Gallery';
import { Gantt } from './Gantt';
import { GroupBy } from './GroupBy';
import { KindsProvider } from './kinds';
import { PropertyVisibility } from './props/PropertyVisibility';
import { SortBar } from './SortBar';
import { TaskTable } from './TaskTable';
import { useDatabaseView } from './useDatabaseView';
import { useProject } from './useProject';
import { useViews } from './useViews';

const VIEW_ICON: Record<ViewKind, typeof Table2> = {
  backlog: ListTodo, board: KanbanSquare, table: Table2,
  gantt: GanttChartSquare, calendar: CalendarDays, gallery: LayoutGrid,
  dashboard: PieChart,
};

interface Props {
  projectId: string;
  /** The saved view this block shows. Empty means "whichever is first", which
   *  is also what a block written before saved views existed carries. */
  viewId: string;
  /** 'full' breaks the block out of the page's reading measure. */
  width: 'column' | 'full';
  /** Draw the database's icon and name above the view. */
  header: boolean;
  /** Pixel height of the views that need a viewport. The table ignores it. */
  height: number;
  onPick: (projectId: string) => void;
  onView: (viewId: string) => void;
  onWidth: (width: 'column' | 'full') => void;
  onHeader: (header: boolean) => void;
  onHeight: (height: number) => void;
  /** True in a public share or a version snapshot: the project/task endpoints
   *  this block reads need a member session and 401 there. Skip fetching them
   *  and say so, rather than fetching anyway and reporting the database gone. */
  unavailable?: boolean;
  /** No editing controls — a shared or archived page is read-only. */
  readonly?: boolean;
}

/**
 * Widen a block past the page's reading measure, out to the editor's own column.
 *
 * Measured rather than expressed in CSS. The obvious `margin-inline: calc(50% -
 * 50vw)` runs to the window edges and slides under the sidebar and the right
 * panel; container query units would need `container-type` on the editor, whose
 * containment breaks BlockSuite's absolutely positioned overlays. Reading the
 * two boxes is three lines and is correct at every sidebar width.
 *
 * The measurement is taken from `.mn-db` — the block's own wrapper, which keeps
 * the note's width — and applied to a child, so applying it never moves what is
 * being measured.
 */
function useBreakout(ref: React.RefObject<HTMLDivElement | null>, enabled: boolean): CSSProperties {
  const [style, setStyle] = useState<CSSProperties>({});
  useLayoutEffect(() => {
    if (!enabled) {
      setStyle({});
      return;
    }
    const el = ref.current;
    const anchor = el?.closest('.mn-db') as HTMLElement | null;
    const host = el?.closest('affine-editor-container') as HTMLElement | null;
    if (!anchor || !host) return;
    const GUTTER = 24;
    const measure = () => {
      const a = anchor.getBoundingClientRect();
      const h = host.getBoundingClientRect();
      if (!h.width) return;
      setStyle({
        width: Math.max(h.width - GUTTER * 2, 280),
        marginLeft: h.left + GUTTER - a.left,
        maxWidth: 'none',
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(host);
    return () => ro.disconnect();
  }, [enabled, ref]);
  return style;
}

/**
 * A saved view of a database, on a page.
 *
 * It points at a *view*, not at a project and a type — which is what makes it
 * a linked view in the Notion sense: the same database can appear on two pages
 * showing two different saved questions, and each is the real view, not a copy
 * that drifts. Everything it draws comes from `useDatabaseView`, the same hook
 * the project screen uses, so the two cannot disagree.
 *
 * This mounts inside its own React root (see database-block.ts), a separate
 * tree from the app's — `useWorkspace()`'s context can't cross that boundary,
 * so the project list is fetched directly here, navigation goes through
 * lib/navSignal, and every provider has to be re-declared inside.
 */
export function EmbeddedDatabase({
  projectId, viewId, width, header, height,
  onPick, onView, onWidth, onHeader, onHeight, unavailable, readonly,
}: Props) {
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(!unavailable);
  const root = useRef<HTMLDivElement>(null);
  const breakout = useBreakout(root, width === 'full');

  const fetchProjects = useCallback(
    () => tasksApi.projects().then(setProjects).catch(() => {}).finally(() => setProjectsLoading(false)),
    [],
  );
  useEffect(() => {
    if (unavailable) return;
    fetchProjects();
    window.addEventListener('focus', fetchProjects);
    return () => window.removeEventListener('focus', fetchProjects);
  }, [unavailable, fetchProjects]);

  // Status colours are on the project row, so a repaint refetches the list
  // this block reads its name and mode from.
  const live = unavailable ? null : (projectId || null);
  const p = useProject(live, fetchProjects);
  const v = useViews(live);
  const project = projects.find((x) => x.id === projectId) ?? null;

  // The block names a view; falling back to the first is what a block written
  // before saved views existed gets, and what one whose view was deleted gets.
  const view = v.views.find((x) => x.id === viewId) ?? v.views[0] ?? null;

  const d = useDatabaseView({
    project,
    source: p,
    view,
    onSave: (patch) => { if (view) v.setConfig(view.id, patch); },
  });

  // Dragging the foot of the block. Only the views that need a viewport have
  // one; the table grows to its content, which is the whole point of `auto`.
  // State rather than a ref, because the listeners are registered by an effect
  // and a ref write does not re-render — the drag would arm nothing.
  const [drag, setDrag] = useState<{ y: number; h: number } | null>(null);
  useEffect(() => {
    if (!drag) return;
    const move = (e: MouseEvent) => onHeight(Math.max(180, Math.min(1200, drag.h + e.clientY - drag.y)));
    const up = () => setDrag(null);
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
  }, [drag, onHeight]);

  if (unavailable) {
    return <p className="rounded-md border border-line p-4 text-sm text-faint">This embedded database isn&apos;t available here.</p>;
  }
  if (projectsLoading) {
    return <Skeleton className="h-24 w-full" />;
  }
  if (!projectId) {
    return (
      <div className="rounded-md border border-line p-4">
        <SearchSelect
          value={null}
          placeholder="Pick a database…"
          empty="No databases in this workspace yet."
          options={projects.map((x) => ({ value: x.id, label: x.name }))}
          onChange={(id) => id && onPick(id)}
        />
      </div>
    );
  }
  if (!project) {
    return <p className="rounded-md border border-line p-4 text-sm text-faint">That database no longer exists.</p>;
  }

  const mode = project.mode;
  const dateProps = p.props.filter((prop) => prop.type === 'date');
  // The table is the one view with no viewport of its own — it grows down the
  // page, so the page scrolls and the block does not. Every other view is a
  // viewport by nature (a board scrolls sideways, a gantt both ways), and
  // those keep an explicit height you can drag.
  const scrolls = d.kind !== 'table';
  const ViewIcon = VIEW_ICON[d.kind] ?? Table2;

  const settings = [
    { icon: ExternalLink, label: 'Open database', onSelect: () => requestOpenProject(projectId) },
    {
      icon: width === 'full' ? Minimize2 : Maximize2,
      label: width === 'full' ? 'Fit to text width' : 'Full width',
      checked: width === 'full',
      separatorBefore: true,
      onSelect: () => onWidth(width === 'full' ? 'column' : 'full'),
    },
    { icon: Columns3, label: 'Show database name', checked: header, onSelect: () => onHeader(!header) },
  ];

  const controls = (
    <>
      {/* Which saved view, not which type: two blocks can show the same
          database asking two different questions. */}
      <Menu
        align="start"
        trigger={
          <button
            type="button"
            className="flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-xs text-muted transition-colors hover:bg-hover hover:text-ink"
          >
            {createElement(ViewIcon, { size: 13 })}
            <span className="max-w-[9rem] truncate">{view?.name ?? 'View'}</span>
          </button>
        }
        items={v.views.map((x) => ({
          icon: VIEW_ICON[x.kind] ?? Table2,
          label: x.name,
          checked: x.id === view?.id,
          onSelect: () => onView(x.id),
        }))}
      />
      <FilterBar fields={d.fields} filters={d.filters} onChange={d.setFilters} />
      <SortBar fields={d.fields} sort={d.sort} onChange={d.setSort} />
      {d.kind === 'board' && (
        <GroupBy fields={d.fields} value={d.groupField?.key ?? null} onChange={d.setGroupBy} />
      )}
      <PropertyVisibility
        view={d.kind}
        visible={d.visible}
        hidden={d.hidden}
        onToggle={d.toggleProp}
        onMove={d.moveProp}
        onShowAll={d.showAllProps}
        onHideAll={d.hideAllProps}
      />
      <Menu
        align="end"
        trigger={<span><IconButton icon={<MoreHorizontal size={16} />} label="Database settings" /></span>}
        items={settings}
      />
    </>
  );

  return (
    // This block renders in its own React root (database-block.ts), so the
    // app's providers are not above it — an IconButton here throws "Tooltip
    // must be used within TooltipProvider" without this. Same reason the
    // project list is fetched over REST rather than read from the store.
    <TooltipProvider delayDuration={700} skipDelayDuration={300}>
    <KindsProvider kinds={p.kinds}>
    <div ref={root} style={breakout} className="group/db relative">
      <div className="rounded-md border border-line">
        {header ? (
          <header className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
            <span>{project.icon}</span>
            {/* A floor, not just flex-1: at the page's reading measure the
                controls are wider than the room left over, and without one
                the name was squeezed to "We…" while they stayed whole. With
                it they wrap to a second line and the name keeps its words. */}
            <button
              type="button"
              onClick={() => requestOpenProject(projectId)}
              title="Open this database"
              className="min-w-[140px] flex-1 truncate rounded px-1 text-left text-sm font-medium text-ink hover:bg-hover"
            >
              {project.name}
            </button>
            {!readonly && controls}
          </header>
        ) : (
          // With the name off, the controls are still reachable — they fade in
          // over the top-right corner rather than disappearing with it.
          !readonly && (
            <div className="absolute right-1 top-1 z-10 flex flex-wrap items-center justify-end gap-1 rounded-md border border-line bg-canvas px-1 py-0.5 opacity-0 shadow-subtle transition-opacity focus-within:opacity-100 group-hover/db:opacity-100">
              {controls}
            </div>
          )
        )}

        <div className={cn(scrolls && 'min-h-0')} style={scrolls ? { height } : undefined}>
          {v.loading ? (
            <Skeleton className="h-24 w-full" />
          ) : d.kind === 'backlog' ? (
            <Backlog
              tasks={d.backlogTasks}
              sprints={p.sprints}
              onOpen={() => requestOpenProject(projectId)}
              onMoveToSprint={(id, sprintId) => p.patch(id, { sprintId })}
              onAdd={(sprintId) => p.create({ title: '', sprintId })}
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
              onOpen={() => requestOpenProject(projectId)}
              onAdd={(value) => p.create({ title: '', ...d.groupSeed(value) })}
              onMove={d.moveToGroup}
            />
          ) : d.kind === 'gantt' ? (
            <Gantt tasks={d.tasks} cardProps={d.visible} users={p.users} onOpen={() => requestOpenProject(projectId)} />
          ) : d.kind === 'gallery' ? (
            <Gallery
              tasks={d.tasks}
              cardProps={d.visible}
              allProps={d.allProps}
              users={p.users}
              onOpen={() => requestOpenProject(projectId)}
              onAdd={() => p.create({ title: '' })}
            />
          ) : d.kind === 'dashboard' ? (
            <Dashboard tasks={d.tasks} sprints={p.sprints} scope={d.scope} statusColors={d.statusColors} />
          ) : d.kind === 'calendar' ? (
            <Calendar
              tasks={d.tasks}
              dateProps={mode === 'data' ? dateProps : []}
              cardProps={d.visible}
              users={p.users}
              onOpen={() => requestOpenProject(projectId)}
              onAdd={(date, propId) => p.create(propId ? { title: '', props: { [propId]: date } } : { title: '', dueAt: date })}
              onMove={(id, date, propId, days) => {
                if (propId) p.setProp(id, propId, date);
                else if (days) p.patch(id, { startAt: date, dueAt: addDays(date, days - 1) });
                else p.patch(id, { dueAt: date });
              }}
              onResize={(id, from, to) => p.patch(id, { startAt: from, dueAt: to })}
            />
          ) : (
            <TaskTable
              auto
              tasks={d.tasks}
              props={d.visible}
              users={p.users}
              rowLabel={mode === 'data' ? 'Name' : 'Task'}
              onPatch={p.patch}
              onOpen={() => requestOpenProject(projectId)}
              onDelete={p.remove}
              onSetProp={p.setProp}
              onEditOptions={p.editOptions}
              onTagsChanged={p.refresh}
            />
          )}
        </div>
      </div>

      {scrolls && !readonly && (
        <div
          role="separator"
          aria-label="Resize database"
          onMouseDown={(e) => { e.preventDefault(); setDrag({ y: e.clientY, h: height }); }}
          className="mx-auto h-2 w-16 cursor-ns-resize rounded-b bg-transparent transition-colors hover:bg-line-strong"
        />
      )}
    </div>
    </KindsProvider>
    </TooltipProvider>
  );
}
