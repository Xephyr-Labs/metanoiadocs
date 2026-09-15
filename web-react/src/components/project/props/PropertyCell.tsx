/* Hallmark · component: one property of one task, editable · genre: modern-minimal
 * theme: project tokens (index.css) + tag palette (lib/tagColors)
 * pre-emit critique: P5 H5 E4 S5 R5 V4
 * states: default · hover · focus-visible · empty · read-only (tags, relation)
 */
import type { UserRow } from '../../../lib/docsApi';
import { isBuiltinProp, readBuiltin, writeBuiltin } from '../../../lib/builtinProps';
import { isComputed, type PropOption, type PropRow, type TaskPatch, type TaskRow } from '../../../lib/tasksApi';
import { AssigneePicker } from '../AssigneePicker';
import { TagsCell } from './TagsCell';
import { isOverdue } from '../TaskBadges';

/** The read-only built-ins — see AUDIT in lib/builtinProps. */
const AUDIT_IDS = new Set(['sys:created', 'sys:createdBy', 'sys:edited', 'sys:editedBy']);

/** A timestamp as a day, since the time of day is rarely the question. */
const shortDateTime = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
import { PropertyValue } from './PropertyValue';

/**
 * A task's value for one property, in a control that writes it.
 *
 * The point of this file is that nothing above it has to know whether a
 * property is a column on `tasks` or an entry in the `props` bag. A table
 * column, a peek row and an embedded database all hand it the same pair —
 * a property and a task — and it picks the endpoint. Before it existed, the
 * table hard-coded six columns and could not show Points, Sprint, Type,
 * Milestone or Files at all; the peek hard-coded eleven fields and the two
 * lists drifted.
 *
 * `onEditOptions` is passed straight through to the select editor: where it is
 * given, an option can be made, renamed, recoloured and deleted from the same
 * menu that sets the value. Where it isn't, the menu is a picker.
 */
export function PropertyCell({
  prop,
  task,
  users,
  onPatch,
  onSetProp,
  onEditOptions,
  onOpenRow,
  onTagsChanged,
}: {
  prop: PropRow;
  task: TaskRow;
  users: UserRow[];
  onPatch: (id: string, body: TaskPatch) => void;
  onSetProp: (taskId: string, propId: string, value: unknown) => void;
  /** Persist a change to this property's own option list. */
  onEditOptions?: (prop: PropRow, options: PropOption[]) => void;
  /** Relations are edited on the row itself — this opens it. */
  onOpenRow?: () => void;
  /** Re-read the row after its page tags change. Omit to leave Focus area
   *  read-only. */
  onTagsChanged?: () => void;
}) {
  const builtin = isBuiltinProp(prop.id);
  const value = builtin ? readBuiltin(task, prop.id) : task.props?.[prop.id] ?? null;

  const write = (next: unknown) => {
    if (!builtin) {
      onSetProp(task.id, prop.id, next);
      return;
    }
    const body = writeBuiltin(prop.id, next);
    // Null means this built-in has no task column to write — `sys:tags` is the
    // only one, and it renders read-only below rather than reaching here.
    if (body) onPatch(task.id, body);
  };

  // Everyone on the task, as the overlapping faces the rest of the app draws.
  // A `person` select would only hold one, and a task with three people on it
  // is the normal case, not the exception.
  if (prop.id === 'sys:assignees') {
    return (
      <AssigneePicker
        compact
        assignees={task.assignees ?? []}
        users={users}
        onChange={(assigneeIds) => onPatch(task.id, { assigneeIds })}
      />
    );
  }

  // Focus areas are the tags on the task's *page*, not a task column — see
  // writeBuiltin — so they get their own cell, which resolves the doc id
  // (minting the page if the row has never been opened) and writes through the
  // doc endpoints. Without `onTagsChanged` it stays the read-only chip list:
  // the caller's cached row would otherwise keep showing the old tags after a
  // write, which reads as the click having failed.
  if (prop.id === 'sys:tags') {
    return <TagsCell task={task} onChanged={onTagsChanged} />;
  }

  if (prop.type === 'relation') {
    return (
      <button type="button" onClick={onOpenRow} className="px-1 text-2xs text-muted hover:text-accent-strong">
        Open row
      </button>
    );
  }

  // A formula and a rollup are computed every time they are read, so there is
  // nothing to write — PropertyValue renders them, and `write` is never called.
  if (isComputed(prop.type)) {
    return <PropertyValue prop={prop} users={users} value={value} onChange={() => {}} />;
  }

  // The four audit columns are the database's own record of what happened —
  // `writeBuiltin` returns null for them, so a control here would be one that
  // silently does nothing.
  if (AUDIT_IDS.has(prop.id)) {
    const shown = typeof value === 'string' && value
      ? (prop.type === 'date' ? shortDateTime(value) : value)
      : '—';
    return <span className="block truncate px-1 text-sm text-muted" title={typeof value === 'string' ? value : ''}>{shown}</span>;
  }

  return (
    <PropertyValue
      prop={prop}
      users={users}
      value={value}
      onChange={write}
      // Built-ins mostly own their options somewhere else — a project's task
      // types and sprints are rows with their own editors — so offering to
      // edit them from here would draw controls that quietly do nothing.
      // Status is the exception: its ids are fixed, so only the colour can
      // change, and that is a project setting the value menu can write.
      onEditOptions={
        onEditOptions && (!builtin || prop.id === 'sys:status')
          ? (options) => onEditOptions(prop, options)
          : undefined
      }
      // Only the *due* date goes red. A start date in the past is a task that
      // has started, which is the normal state of most of them.
      danger={prop.id === 'sys:due' && isOverdue(task)}
      // The four statuses are load-bearing ids — every board column, filter
      // and rollup names them — so they repaint but never appear or vanish.
      fixedOptions={prop.id === 'sys:status'}
    />
  );
}
