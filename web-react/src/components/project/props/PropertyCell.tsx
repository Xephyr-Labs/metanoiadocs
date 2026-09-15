/* Hallmark · component: one property of one task, editable · genre: modern-minimal
 * theme: project tokens (index.css) + tag palette (lib/tagColors)
 * pre-emit critique: P5 H5 E4 S5 R5 V4
 * states: default · hover · focus-visible · empty · read-only (tags, relation)
 */
import { cn } from '../../../lib/cn';
import type { UserRow } from '../../../lib/docsApi';
import { isBuiltinProp, readBuiltin, writeBuiltin } from '../../../lib/builtinProps';
import { swatch } from '../../../lib/tagColors';
import type { PropOption, PropRow, TaskPatch, TaskRow } from '../../../lib/tasksApi';
import { AssigneePicker } from '../AssigneePicker';
import { isOverdue } from '../TaskBadges';
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
  // writeBuiltin. Shown, because they are worth scanning; not edited here,
  // because the write needs a doc id this cell does not have. The peek, which
  // does, draws the real tag editor.
  if (prop.id === 'sys:tags') {
    const tags = Array.isArray(value) ? (value as string[]) : [];
    if (!tags.length) return <span className="px-1 text-sm text-faint">—</span>;
    return (
      <span className="flex flex-wrap items-center gap-1" title="Focus areas are edited on the task’s page">
        {tags.map((t) => (
          <span key={t} className={cn('truncate rounded px-1.5 py-0.5 text-2xs', swatch('gray').chip)}>{t}</span>
        ))}
      </span>
    );
  }

  if (prop.type === 'relation') {
    return (
      <button type="button" onClick={onOpenRow} className="px-1 text-2xs text-muted hover:text-accent-strong">
        Open row
      </button>
    );
  }

  return (
    <PropertyValue
      prop={prop}
      users={users}
      value={value}
      onChange={write}
      onEditOptions={onEditOptions ? (options) => onEditOptions(prop, options) : undefined}
      // Only the *due* date goes red. A start date in the past is a task that
      // has started, which is the normal state of most of them.
      danger={prop.id === 'sys:due' && isOverdue(task)}
      // The four statuses are load-bearing ids — every board column, filter
      // and rollup names them — so they repaint but never appear or vanish.
      fixedOptions={prop.id === 'sys:status'}
    />
  );
}
