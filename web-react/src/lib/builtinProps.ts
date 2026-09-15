// The fields a task has before anyone defines a property, described in the
// same shape as the ones they define.
//
// Until now this app had two disjoint universes. `props` (the PropRow list)
// covered only what someone added from the Properties dialog; status,
// assignees, dates, type, points, tags and attachments were columns on
// TaskRow, hard-coded into a peek panel and a table. Everything built on top
// of the property system therefore only ever saw half the task: the
// visibility panel could offer three custom properties and not Status, and a
// card could not show an attached image because attachments were not a
// property to show.
//
// Rather than teach each of those places about both universes, the built-ins
// describe themselves AS properties. Their ids are namespaced `sys:` so they
// can never collide with a database-generated one, and their `type` is a real
// PropType wherever one fits — which is what lets PropChips, the visibility
// panel and the stored per-view order work on them with no special cases.
import {
  STATUSES,
  STATUS_LABEL,
  type ProjectMode,
  type PropOption,
  type PropRow,
  type SprintRow,
  type TaskKindRow,
  type TaskPatch,
  type TaskRow,
} from './tasksApi';

export const BUILTIN_PREFIX = 'sys:';

export const isBuiltinProp = (id: string) => id.startsWith(BUILTIN_PREFIX);

/** The colour each state carries everywhere else in the app (Board's DOT). */
const STATUS_COLOR: Record<string, string> = {
  todo: 'gray',
  doing: 'blue',
  review: 'yellow',
  done: 'green',
};

const row = (
  id: string,
  label: string,
  type: PropRow['type'],
  options: PropOption[] = [],
  position = 0,
): PropRow => ({
  id: `${BUILTIN_PREFIX}${id}`,
  project_id: '',
  key: `${BUILTIN_PREFIX}${id}`,
  label,
  type,
  options,
  target_project_id: null,
  // Negative, so a built-in sorts ahead of every database-defined property in
  // any list that orders by position.
  position: position - 1000,
});

/**
 * Every native field of a task, as properties.
 *
 * `kinds` and `sprints` are the project's own, so Type and Sprint offer the
 * real options rather than a free-text box. Passing them empty is fine — the
 * property still lists and still reads, it just has nothing to choose from.
 */
export function builtinProps(
  mode: ProjectMode,
  kinds: TaskKindRow[] = [],
  sprints: SprintRow[] = [],
  /** Per-project overrides for the status chips, `{ status: colour }`. */
  statusColors: Record<string, string> = {},
): PropRow[] {
  // A data database has no status, no assignee, no schedule — Backlog, Board
  // and the work half of the table are all hidden for it. Offering those as
  // properties would put controls on a card for columns the mode doesn't use.
  if (mode === 'data') return [row('attachments', 'Files & media', 'file', [], 10)];

  return [
    row('status', 'Status', 'select',
      STATUSES.map((s) => ({ id: s, label: STATUS_LABEL[s], color: statusColors[s] || STATUS_COLOR[s] || 'gray' })), 0),
    row('assignees', 'Assignees', 'person', [], 1),
    row('kind', 'Type', 'select',
      kinds.map((k) => ({ id: k.key, label: k.label, color: k.color })), 2),
    row('start', 'Start', 'date', [], 3),
    row('due', 'Due', 'date', [], 4),
    row('points', 'Points', 'number', [], 5),
    row('progress', 'Progress', 'number', [], 6),
    row('sprint', 'Sprint', 'select',
      sprints.map((s) => ({ id: s.id, label: s.name, color: s.state === 'active' ? 'green' : 'gray' })), 7),
    row('milestone', 'Milestone', 'checkbox', [], 8),
    row('tags', 'Focus area', 'multi_select', [], 9),
    row('attachments', 'Files & media', 'file', [], 10),
  ];
}

/**
 * A built-in's value, in the shape its declared type expects.
 *
 * The mapping is deliberately to the *option id* rather than the label — a
 * select chip looks its colour up by id, so `status` returning `'doing'` is
 * what makes it paint blue without a second lookup table.
 *
 * Returns undefined for an id that is not a built-in, which is the signal to
 * read `task.props` instead.
 */
export function readBuiltin(task: TaskRow, id: string): unknown {
  switch (id) {
    case 'sys:status': return task.status;
    case 'sys:assignees': return task.assignees ?? [];
    case 'sys:kind': return task.kind;
    case 'sys:start': return task.start_at;
    case 'sys:due': return task.due_at;
    case 'sys:points': return task.points;
    // 0% is the state every untouched task is in, so it is not worth a chip;
    // null reads as "nothing to draw" the whole way down.
    case 'sys:progress': return task.progress > 0 ? task.progress : null;
    case 'sys:sprint': return task.sprint_id;
    case 'sys:milestone': return task.milestone;
    case 'sys:tags': return task.tags ?? [];
    case 'sys:attachments': return task.attachments ?? [];
    default: return undefined;
  }
}

/**
 * What a view shows on a card before anyone configures it.
 *
 * Per view, because the same three chips are not right in three places: a
 * board card has always drawn its type, due date, points and people, so that
 * is what its default has to be or upgrading would silently strip them. A
 * calendar cell is ~45px per day and already says the date by *where it is*,
 * so repeating it there is the clutter this default exists to avoid. A gantt
 * row is a bar between two dates for the same reason.
 */
export const DEFAULT_CARD_PROPS: Record<string, string[]> = {
  board: ['sys:kind', 'sys:milestone', 'sys:points', 'sys:due', 'sys:assignees', 'sys:attachments'],
  // The gallery leads with the picture at full width, so a 24px copy of it in
  // the chip row would be the same file twice on one card.
  gallery: ['sys:kind', 'sys:milestone', 'sys:points', 'sys:due', 'sys:assignees'],
  calendar: ['sys:assignees', 'sys:attachments'],
  // One row, one line: a gantt bar has room for who, and nothing after that.
  gantt: ['sys:assignees'],
};

/**
 * How many of a database's own properties ride along in a default.
 *
 * Three, because three is what an unconfigured view showed before built-ins
 * existed (`resolveViewProps`'s old `props.slice(0, 3)`). Naming only the
 * built-ins in DEFAULT_CARD_PROPS quietly took a project's own properties
 * *off* every unconfigured card — the opposite of the point.
 */
const CUSTOM_IN_DEFAULT = 3;

/** Views with room for the database's properties as well as the built-ins. */
const ROOMY = new Set(['board', 'gallery']);

/**
 * The ids a view shows before anyone configures it.
 *
 * A board or gallery card gets the built-ins *and* the first few of the
 * project's own properties, which together are what those cards drew before.
 * A calendar cell is ~45px per day and a gantt row is one line, so those keep
 * to the built-ins alone.
 *
 * A data database is the exception to that, in every view: it has no status,
 * no people and no schedule, so its own properties are not extra detail on
 * top of the built-ins — they are the only thing the card has to say. Keying
 * this off the mode rather than off "did the built-in set come back empty"
 * matters, because `Files & media` exists in both modes and would otherwise
 * look like a full default all by itself.
 */
export function defaultPropIds(
  view: string,
  builtins: PropRow[],
  props: PropRow[],
  mode: ProjectMode = 'tasks',
): string[] {
  const has = new Set(builtins.map((b) => b.id));
  const named = (DEFAULT_CARD_PROPS[view] ?? []).filter((id) => has.has(id));
  if (!ROOMY.has(view) && mode !== 'data') return named;
  return [...named, ...props.slice(0, CUSTOM_IN_DEFAULT).map((p) => p.id)];
}

/**
 * The properties a view shows when there is nowhere to store a choice.
 *
 * A database embedded in a page has no toolbar, so it never had a visibility
 * setting to read — and once the card's metadata row stopped being hard-coded,
 * "no setting" rendered as "no properties" and those cards lost their type,
 * dates and people. This is the set they fall back to.
 */
export function defaultCardProps(
  view: string,
  mode: ProjectMode,
  kinds: TaskKindRow[] = [],
  sprints: SprintRow[] = [],
  props: PropRow[] = [],
): PropRow[] {
  const builtins = builtinProps(mode, kinds, sprints);
  const all = [...builtins, ...props];
  return defaultPropIds(view, builtins, props, mode)
    .map((id) => all.find((p) => p.id === id))
    .filter((p): p is PropRow => p !== undefined);
}

/**
 * The PATCH body that writes a built-in, or null when this id is not one that
 * can be written through `tasks.*`.
 *
 * The mirror of `readBuiltin`, and the reason a cell never has to know which
 * universe its property came from: it asks for a body, and either gets one to
 * send to the task endpoint or is told to write the value into the `props` bag
 * instead. Without it, "every property is editable" would mean a switch on
 * `sys:` ids in the table, in the peek, and in the embedded database — three
 * copies of the same mapping, two of which would eventually disagree.
 *
 * `sys:tags` is the deliberate null. A task's focus areas are the tags on its
 * *page*, written through the doc endpoints against a doc id this function
 * does not have; returning a body for it would silently write a `props` entry
 * that nothing reads. Callers that can reach the page (the peek) render the
 * real tag editor; the rest show the chips and leave them alone.
 */
export function writeBuiltin(id: string, value: unknown): TaskPatch | null {
  const str = () => (typeof value === 'string' && value ? value : null);
  const num = () => (typeof value === 'number' && Number.isFinite(value) ? value : null);
  switch (id) {
    case 'sys:status': return str() ? { status: str() as TaskRow['status'] } : null;
    case 'sys:assignees':
      return { assigneeIds: Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [] };
    case 'sys:kind': return str() ? { kind: str() as string } : null;
    case 'sys:start': return { startAt: str() };
    case 'sys:due': return { dueAt: str() };
    case 'sys:points': return { points: num() };
    // Progress is a percentage with a floor, not a nullable number: clearing
    // the box means 0% done, which is a real answer, and `null` would fail the
    // server's range check rather than reading as "not started".
    case 'sys:progress': return { progress: Math.max(0, Math.min(100, num() ?? 0)) };
    case 'sys:sprint': return { sprintId: str() };
    case 'sys:milestone': return { milestone: !!value };
    case 'sys:attachments': return { attachments: Array.isArray(value) ? (value as TaskPatch['attachments']) : [] };
    default: return null;
  }
}

/**
 * Every property a table column could hold, in the order the peek lists them.
 *
 * The table is the one view with somewhere to put all of them, so its default
 * is "all of them" rather than a chosen few — a grid that silently omits Points
 * and Sprint is the complaint this answers. `DEFAULT_CARD_PROPS` stays the
 * shorter list for views drawing cards, where six chips is already a lot.
 */
export function defaultTableProps(builtins: PropRow[], props: PropRow[]): string[] {
  return [...builtins, ...props].map((p) => p.id);
}
