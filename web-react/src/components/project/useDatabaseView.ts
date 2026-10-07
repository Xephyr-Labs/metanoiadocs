import { useMemo } from 'react';
import type { UserRow } from '../../lib/docsApi';
import { builtinProps, visibleProps, defaultPropIds, defaultTableProps } from '../../lib/builtinProps';
import { canGroupBy, EPIC_KEY, epicField, epicOf, epicsOf, groupOf, groupValue, groupsFor, movedValue, type BoardGroup } from '../../lib/grouping';
import { withComputed } from '../../lib/computed';
import { applyFilters, fieldsFor, pruneUnresolvable, type Filter, type FilterField } from '../../lib/taskFilter';
import { applySort, pruneSort, type SortRule } from '../../lib/taskSort';
import { moveInOrder, resolveViewProps } from '../../lib/viewProps';
import type { PropRow, ProjectRow, SprintRow, TaskKindRow, TaskPatch, TaskRow, TaskStatus, ViewRow } from '../../lib/tasksApi';

interface Source {
  tasks: TaskRow[];
  /** Rows and properties of the databases a rollup reads. Empty when none does. */
  linkedRows?: Map<string, TaskRow>;
  linkedProps?: Map<string, PropRow>;
  props: PropRow[];
  kinds: TaskKindRow[];
  sprints: SprintRow[];
  users: UserRow[];
  patch: (id: string, body: TaskPatch) => void;
  setProp: (taskId: string, propId: string, value: unknown) => void;
}

/**
 * What one saved view actually shows.
 *
 * Every part of this — the merged property list, the pruned filters, the sort,
 * the board's columns, what dropping a card into one writes — is needed twice:
 * once by the project screen and once by a database embedded in a page. They
 * were two copies before saved views existed, and the embed was already the
 * poorer of the two. One hook, so a view looks the same wherever it is drawn.
 *
 * Pure derivation on purpose: it owns no state and issues no requests. The
 * view row comes from `useViews`, the rows from `useProject`, and writing a
 * setting is the caller's `setConfig`.
 */
export function useDatabaseView({
  project,
  source,
  view,
  tagNames = [],
  onSave,
}: {
  project: ProjectRow | null;
  source: Source;
  view: ViewRow | null;
  /** Focus areas, for the filter field. */
  tagNames?: string[];
  /** Persist one facet of the view's config. Absent on a read-only embed. */
  onSave?: (patch: ViewRow['config']) => void;
}) {
  const mode = project?.mode ?? 'tasks';
  const kind = view?.kind ?? 'table';
  const config = view?.config ?? {};

  // Every built-in, switched-off ones included: that is the list the
  // properties dialog shows, since a hidden property has to stay findable.
  const builtins = useMemo(
    () => builtinProps(mode, source.kinds, source.sprints, project?.status_colors, project?.builtin_props),
    [mode, source.kinds, source.sprints, project?.status_colors, project?.builtin_props],
  );
  // Machine-owned properties (`_`-prefixed) and built-ins the project has
  // hidden never reach a card, a column, a filter or the peek — see
  // visibleProps. They are still stored, still readable through the API, and
  // still listed in the properties dialog.
  const shownBuiltins = useMemo(() => visibleProps(builtins), [builtins]);
  const readable = useMemo(() => visibleProps(source.props), [source.props]);
  const allProps = useMemo(() => [...shownBuiltins, ...readable], [shownBuiltins, readable]);

  const fields = useMemo(
    () => fieldsFor({
      mode,
      props: readable,
      users: source.users,
      kinds: source.kinds,
      sprints: source.sprints,
      tags: tagNames,
    }),
    [mode, source.props, source.users, source.kinds, source.sprints, tagNames],
  );

  const viewDefaults = useMemo(
    // The table is the one view with room for all of them, so its unconfigured
    // state is every property rather than a chosen few.
    () => (kind === 'table'
      ? defaultTableProps(shownBuiltins, source.props)
      : defaultPropIds(kind, shownBuiltins, source.props, mode)),
    [kind, shownBuiltins, source.props, mode],
  );

  const { visible, hidden } = useMemo(
    () => resolveViewProps(config.props ?? null, allProps, viewDefaults),
    [config.props, allProps, viewDefaults],
  );
  const order = visible.map((x) => x.id);

  // Saved settings that can no longer resolve — a sprint that was deleted, a
  // member who left, a property somebody removed — are ignored rather than
  // shown as "Choose…" matching nothing.
  const filters = pruneUnresolvable(config.filters ?? [], fields);
  const sort = pruneSort(config.sort ?? [], fields);
  const scope = config.scope ?? 'all';

  // Formulas and rollups are materialised before anything else looks at the
  // list, so filtering, sorting, grouping and every cell see them as ordinary
  // values — see lib/computed.ts.
  const rows = useMemo(
    () => withComputed(source.tasks, {
      props: source.props,
      users: source.users,
      linkedRows: source.linkedRows ?? new Map(),
      linkedProps: source.linkedProps ?? new Map(),
    }),
    [source.tasks, source.props, source.users, source.linkedRows, source.linkedProps],
  );

  const scoped = scope === 'all' ? rows
    : scope === 'backlog' ? rows.filter((t) => !t.sprint_id)
    : rows.filter((t) => t.sprint_id === scope);
  const tasks = applySort(applyFilters(scoped, filters, fields), sort, fields);
  // The backlog is the sprint-planning view, so the sprint scope means nothing
  // there — but the filters and the sort still do.
  const backlogTasks = applySort(applyFilters(rows, filters, fields), sort, fields);

  // Epics are the project's container rows, so grouping by them is offered
  // only where the project has a container type at all. Built from every row,
  // not the filtered list: a group is an epic of the project, and an epic
  // whose own card is filtered out still has stories to hold.
  const groupKinds = useMemo(() => new Set(source.kinds.filter((k) => k.is_group).map((k) => k.key)), [source.kinds]);
  const isGroupRow = (t: TaskRow) => groupKinds.has(t.kind);
  const epics = useMemo(() => epicsOf(rows, (t) => groupKinds.has(t.kind)), [rows, groupKinds]);
  const byId = useMemo(() => new Map(rows.map((t) => [t.id, t])), [rows]);
  const groupFields = useMemo(
    () => (groupKinds.size ? [...fields, epicField(epics)] : fields),
    [fields, epics, groupKinds],
  );

  // What a board is split by. Status unless the view says otherwise — which is
  // what it always was, only now a default rather than the only option. A
  // table is a list until somebody groups it, so it has no default.
  const groupField: FilterField | null = (() => {
    const named = config.groupBy ? groupFields.find((f) => f.key === config.groupBy) : null;
    if (named && canGroupBy(named)) return named;
    if (kind === 'table') return null;
    return fields.find((f) => f.key === 'status') ?? null;
  })();

  const groupColors: Record<string, string> = (() => {
    if (!groupField) return {};
    if (groupField.key === 'status') return project?.status_colors ?? {};
    // Each epic's dot is its type's colour, the same one its glyph wears.
    if (groupField.key === EPIC_KEY) {
      const colorOf = new Map(source.kinds.map((k) => [k.key, k.color]));
      return Object.fromEntries(epics.map((t) => [t.id, colorOf.get(t.kind) ?? 'gray']));
    }
    const prop = groupField.key.startsWith('prop:')
      ? source.props.find((x) => x.id === groupField.key.slice(5))
      : null;
    return Object.fromEntries((prop?.options ?? []).map((o) => [o.id, o.color]));
  })();

  const groups: BoardGroup[] = groupField ? groupsFor(groupField, groupColors) : [];

  /** Dropping a card into a column writes whatever that column stands for. */
  const moveToGroup = (id: string, value: string, position: number) => {
    if (!groupField) return;
    if (groupField.key === 'status') {
      source.patch(id, { status: value as TaskStatus, position });
      return;
    }
    // A person or multi-select card keeps its other values; see movedValue.
    const task = source.tasks.find((t) => t.id === id);
    // Into an epic's column is under that epic; into "No epic" is out of
    // every one. An epic's own card stays where it is — epics do not nest —
    // and a drop back into the column it came from writes nothing.
    if (groupField.key === EPIC_KEY) {
      if (!task || isGroupRow(task) || epicOf(task, byId, isGroupRow) === value) return;
      source.patch(id, { parentId: value || null });
      return;
    }
    if (groupField.key === 'assignee_id') {
      const next = movedValue(groupField, task, value);
      source.patch(id, { assigneeIds: Array.isArray(next) ? (next as string[]) : [] });
      return;
    }
    if (groupField.key.startsWith('prop:')) {
      source.setProp(id, groupField.key.slice(5), movedValue(groupField, task, value));
      return;
    }
    const patch: TaskPatch = groupField.key === 'kind' ? { kind: value }
      : groupField.key === 'sprint_id' ? { sprintId: value || null }
      : groupField.key === 'milestone' ? { milestone: value === 'true' }
      : {};
    if (Object.keys(patch).length) source.patch(id, patch);
  };

  /** What a row added from a board column should start with. */
  const groupSeed = (value: string): { status?: TaskStatus; props?: Record<string, unknown>; parentId?: string } => {
    if (!groupField || !value) return {};
    if (groupField.key === 'status') return { status: value as TaskStatus };
    if (groupField.key === EPIC_KEY) return { parentId: value };
    if (groupField.key.startsWith('prop:')) return { props: { [groupField.key.slice(5)]: groupValue(groupField, value) } };
    return {};
  };

  return {
    kind,
    config,
    // The project's own status palette, for anything that paints a status
    // outside a board column — the dashboard's charts, today. `groupColors`
    // above is not it: that follows whatever the view is grouped by.
    statusColors: project?.status_colors ?? {},
    fields,
    allProps,
    builtins,
    filters,
    sort,
    scope,
    tasks,
    scopedCount: scoped.length,
    backlogTasks,
    visible,
    hidden,
    groupField,
    groups,
    groupFields,
    groupOf: (task: TaskRow) => (!groupField ? ''
      : groupField.key === EPIC_KEY ? epicOf(task, byId, isGroupRow)
      : groupOf(task, groupField)),
    moveToGroup,
    groupSeed,
    // The five writers the toolbar needs, each saving one facet. The server
    // merges, so a sort change never blanks the filters beside it.
    setFilters: (next: Filter[]) => onSave?.({ filters: next }),
    setSort: (next: SortRule[]) => onSave?.({ sort: next }),
    setGroupBy: (next: string | null) => onSave?.({ groupBy: next }),
    setScope: (next: string) => onSave?.({ scope: next }),
    setProps: (next: string[]) => onSave?.({ props: next }),
    toggleProp: (id: string) => onSave?.({ props: order.includes(id) ? order.filter((x) => x !== id) : [...order, id] }),
    moveProp: (id: string, by: -1 | 1) => onSave?.({ props: moveInOrder(order, id, by) }),
    showAllProps: () => onSave?.({ props: allProps.map((x) => x.id) }),
    hideAllProps: () => onSave?.({ props: [] }),
  };
}
