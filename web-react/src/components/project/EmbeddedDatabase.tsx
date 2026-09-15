/* Hallmark · component: database embedded in a page · genre: modern-minimal
 * theme: project tokens (index.css)
 * pre-emit critique: P5 H5 E4 S5 R5 V4
 * states: loading · picker (no database chosen) · missing · unavailable
 *         (share/snapshot) · default · header hidden · full width · resizing
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { CalendarDays, Columns3, ExternalLink, GanttChartSquare, KanbanSquare, LayoutGrid, ListTodo, Maximize2, Minimize2, MoreHorizontal, Table2 } from 'lucide-react';
import type { EmbeddedView } from '../../editor/database/database-model';
import { requestOpenProject } from '../../lib/navSignal';
import { addDays } from '../../lib/gantt';
import { tasksApi, type ProjectRow } from '../../lib/tasksApi';
import { builtinProps, defaultCardProps, defaultPropIds, defaultTableProps } from '../../lib/builtinProps';
import { useViewProps } from '../../lib/viewProps';
import { cn } from '../../lib/cn';
import { IconButton } from '../ui/IconButton';
import { Menu } from '../ui/Menu';
import { SegmentedControl } from '../ui/SegmentedControl';
import { Skeleton } from '../ui/Skeleton';
import { TooltipProvider } from '../ui/Tooltip';
import { selectField } from '../ui/styles';
import { Backlog } from './Backlog';
import { Board } from './Board';
import { Calendar } from './Calendar';
import { Gallery } from './Gallery';
import { Gantt } from './Gantt';
import { KindsProvider } from './kinds';
import { PropertyVisibility } from './props/PropertyVisibility';
import { TaskTable } from './TaskTable';
import { useProject } from './useProject';

const VIEW_TABS = [
  { value: 'backlog', label: 'Backlog', icon: <ListTodo size={13} /> },
  { value: 'board', label: 'Board', icon: <KanbanSquare size={13} /> },
  { value: 'table', label: 'Table', icon: <Table2 size={13} /> },
  { value: 'gantt', label: 'Gantt', icon: <GanttChartSquare size={13} /> },
  { value: 'calendar', label: 'Calendar', icon: <CalendarDays size={13} /> },
  { value: 'gallery', label: 'Gallery', icon: <LayoutGrid size={13} /> },
];

/** A data database has no status, people or schedule for these three to read. */
const DATA_VIEWS = new Set(['table', 'calendar', 'gallery']);

interface Props {
  projectId: string;
  view: EmbeddedView;
  /** 'full' breaks the block out of the page's reading measure. */
  width: 'column' | 'full';
  /** Draw the database's icon and name above the view. */
  header: boolean;
  /** Pixel height of the views that need a viewport. The table ignores it. */
  height: number;
  onPick: (projectId: string) => void;
  onView: (view: EmbeddedView) => void;
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
 * Renders the SAME views the full project screen uses, so an embedded database
 * can't drift from what a click-through to the project shows — and so the six
 * views are six views here too, rather than the table and the board it used to
 * be limited to.
 *
 * This mounts inside its own React root (see database-block.ts), a separate
 * tree from the app's main root — `useWorkspace()`'s context can't cross that
 * boundary, so the project list is fetched directly here and navigation goes
 * through lib/navSignal.
 *
 * Refetches on window focus so a rename/delete/create made elsewhere while
 * this document stays open is picked up. An embed in a tab that never loses
 * focus won't see the update until it does — same residual gap `useProject`
 * itself has (no live push channel exists for project metadata).
 */
export function EmbeddedDatabase({
  projectId, view, width, header, height,
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
  const p = useProject(unavailable ? null : (projectId || null), fetchProjects);
  const project = projects.find((x) => x.id === projectId) ?? null;
  const mode = project?.mode ?? 'tasks';

  // The same merge the project screen does — built-ins and the database's own,
  // as one list. It is what puts Assignees (and so "tag people"), Status,
  // dates and Files on an embedded table at all.
  const builtins = useMemo(
    () => builtinProps(mode, p.kinds, p.sprints, project?.status_colors),
    [mode, p.kinds, p.sprints, project?.status_colors],
  );
  const allProps = useMemo(() => [...builtins, ...p.props], [builtins, p.props]);
  const viewDefaults = useMemo(
    () => (view === 'table' ? defaultTableProps(builtins, p.props) : defaultPropIds(view, builtins, p.props, mode)),
    [view, builtins, p.props, mode],
  );
  // Keyed by project + view, the same storage the project screen uses — so a
  // column hidden on the board stays hidden whether you got there through the
  // sidebar or through this block.
  const viewProps = useViewProps(projectId || null, view, allProps, viewDefaults);

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
        <select className={selectField} defaultValue="" onChange={(e) => e.target.value && onPick(e.target.value)}>
          <option value="">Pick a database…</option>
          {projects.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
      </div>
    );
  }
  if (!project) {
    return <p className="rounded-md border border-line p-4 text-sm text-faint">That database no longer exists.</p>;
  }

  const tabs = VIEW_TABS.filter((t) => mode !== 'data' || DATA_VIEWS.has(t.value));
  const current: EmbeddedView = tabs.some((t) => t.value === view) ? view : (tabs[0].value as EmbeddedView);
  const dateProps = p.props.filter((prop) => prop.type === 'date');
  // The table is the one view with no viewport of its own — it grows down the
  // page, so the page scrolls and the block does not. Every other view is a
  // viewport by nature (a board scrolls sideways, a gantt both ways), and
  // those keep an explicit height you can drag.
  const scrolls = current !== 'table';

  const settings = [
    {
      icon: ExternalLink,
      label: 'Open database',
      onSelect: () => requestOpenProject(projectId),
    },
    {
      icon: width === 'full' ? Minimize2 : Maximize2,
      label: width === 'full' ? 'Fit to text width' : 'Full width',
      checked: width === 'full',
      separatorBefore: true,
      onSelect: () => onWidth(width === 'full' ? 'column' : 'full'),
    },
    {
      icon: Columns3,
      label: 'Show database name',
      checked: header,
      onSelect: () => onHeader(!header),
    },
  ];

  const controls = (
    <>
      <PropertyVisibility
        view={current}
        visible={viewProps.visible}
        hidden={viewProps.hidden}
        onToggle={viewProps.toggle}
        onMove={viewProps.move}
        onShowAll={viewProps.showAll}
        onHideAll={viewProps.hideAll}
      />
      <SegmentedControl
        aria-label="Database view"
        segments={tabs}
        value={current}
        onChange={(v) => onView(v as EmbeddedView)}
      />
      <Menu
        align="end"
        trigger={<span><IconButton icon={<MoreHorizontal size={15} />} label="Database settings" /></span>}
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
            <div className="absolute right-1 top-1 z-10 flex items-center gap-1 rounded-md border border-line bg-canvas px-1 py-0.5 opacity-0 shadow-subtle transition-opacity focus-within:opacity-100 group-hover/db:opacity-100">
              {controls}
            </div>
          )
        )}

        <div className={cn(scrolls && 'min-h-0')} style={scrolls ? { height } : undefined}>
          {current === 'backlog' ? (
            <Backlog
              tasks={p.tasks}
              sprints={p.sprints}
              onOpen={() => requestOpenProject(projectId)}
              onMoveToSprint={(id, sprintId) => p.patch(id, { sprintId })}
              onAdd={(sprintId) => p.create({ title: '', sprintId })}
              onCreateSprint={p.createSprint}
              onPatchSprint={p.patchSprint}
              onDeleteSprint={p.deleteSprint}
            />
          ) : current === 'board' ? (
            <Board
              tasks={p.tasks}
              cardProps={viewProps.visible.length ? viewProps.visible : defaultCardProps('board', mode, p.kinds, p.sprints, p.props)}
              users={p.users}
              onOpen={() => requestOpenProject(projectId)}
              onAdd={(status) => p.create({ title: '', status })}
              onMove={(id, status, position) => p.patch(id, { status, position })}
            />
          ) : current === 'gantt' ? (
            <Gantt tasks={p.tasks} cardProps={viewProps.visible} users={p.users} onOpen={() => requestOpenProject(projectId)} />
          ) : current === 'gallery' ? (
            <Gallery
              tasks={p.tasks}
              cardProps={viewProps.visible}
              allProps={allProps}
              users={p.users}
              onOpen={() => requestOpenProject(projectId)}
              onAdd={() => p.create({ title: '' })}
            />
          ) : current === 'calendar' ? (
            <Calendar
              tasks={p.tasks}
              dateProps={mode === 'data' ? dateProps : []}
              cardProps={viewProps.visible}
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
              tasks={p.tasks}
              props={viewProps.visible}
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
