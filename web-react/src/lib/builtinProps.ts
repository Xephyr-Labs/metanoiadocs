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
): PropRow[] {
  // A data database has no status, no assignee, no schedule — Backlog, Board
  // and the work half of the table are all hidden for it. Offering those as
  // properties would put controls on a card for columns the mode doesn't use.
  if (mode === 'data') return [row('attachments', 'Files & media', 'file', [], 10)];

  return [
    row('status', 'Status', 'select',
      STATUSES.map((s) => ({ id: s, label: STATUS_LABEL[s], color: STATUS_COLOR[s] ?? 'gray' })), 0),
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
  const all = [...builtinProps(mode, kinds, sprints), ...props];
  const wanted = DEFAULT_CARD_PROPS[view] ?? [];
  return wanted
    .map((id) => all.find((p) => p.id === id))
    .filter((p): p is PropRow => p !== undefined);
}
