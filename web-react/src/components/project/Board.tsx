import { useState } from 'react';
import { Plus } from 'lucide-react';
import { cn } from '../../lib/cn';
import type { TaskRow, TaskStatus, PropRow } from '../../lib/tasksApi';
import { STATUS_DOT, type BoardGroup } from '../../lib/grouping';
import type { UserRow } from '../../lib/docsApi';
import { TaskChip } from './TaskChip';

interface Props {
  tasks: TaskRow[];
  /**
   * The columns, in order, and which task belongs in which. Passed in rather
   * than derived here: the board used to map over the four statuses, so it
   * could only ever be a status board. `groupOf` is the caller's because only
   * it knows what the view is grouped by.
   */
  groups: BoardGroup[];
  groupOf: (task: TaskRow) => string;
  /** Custom properties to show on each card, ordered by the view's settings.
   *  Absent where there is no per-view setting to read — a database embedded
   *  in a page has no toolbar to configure one. */
  cardProps?: PropRow[];
  users?: UserRow[];
  /** `value` is the column's, whatever the board is grouped by — the caller
   *  turns it back into a status, an assignee or a property write. */
  onMove: (id: string, value: string, position: number) => void;
  onOpen: (t: TaskRow) => void;
  /** Absent where a column has nowhere to put a new row — a board drawn over
   *  tasks from several projects has no project to add one to. The control is
   *  then not drawn at all, rather than drawn and inert. */
  onAdd?: (value: string) => void;
}

/** One dot per column, so the four headers are told apart before they are read.
 *  Re-exported from lib/grouping rather than declared again: this file and that
 *  one held byte-identical copies, which is the drift the old comment here
 *  warned about happening to itself. */
export const DOT = STATUS_DOT as Record<TaskStatus, string>;

/**
 * Kanban. Uses the native HTML drag-and-drop API rather than a drag library —
 * columns are drop targets and a card carries its own id, which is all this
 * needs.
 */
export function Board({ tasks, groups, groupOf, cardProps, users, onMove, onOpen, onAdd }: Props) {
  const [over, setOver] = useState<string | null>(null);

  return (
    <div className="scrollarea flex h-full gap-3 overflow-x-auto p-4">
      {groups.map((group) => {
        // Only the ungrouped board keeps the manual order a drag writes; any
        // other grouping has no position of its own, so the list arrives
        // already sorted by the view and is left as it is.
        const column = tasks.filter((t) => groupOf(t) === group.value);
        return (
          <div
            key={group.value}
            onDragOver={(e) => { e.preventDefault(); setOver(group.value); }}
            onDragLeave={() => setOver((s) => (s === group.value ? null : s))}
            onDrop={(e) => {
              e.preventDefault();
              setOver(null);
              const id = e.dataTransfer.getData('text/task-id');
              if (!id) return;
              const last = column[column.length - 1];
              onMove(id, group.value, (last ? last.position : 0) + 1);
            }}
            className={cn(
              'flex w-[280px] shrink-0 flex-col rounded-lg bg-surface p-2 transition-colors duration-120',
              over === group.value && 'ring-2 ring-inset ring-accent',
            )}
          >
            <header className="flex h-8 items-center justify-between px-1.5">
              {/* Set like a section label, not like a heading: four of these sit
                  side by side all day, and the cards under them are the content. */}
              <span className="flex items-center gap-2 text-3xs font-semibold uppercase tracking-[0.08em] text-muted">
                <span aria-hidden className={cn('h-1.5 w-1.5 rounded-full', group.dot)} />
                {group.label}
                <span className="rounded-full bg-canvas px-1.5 text-3xs font-medium tabular-nums text-faint ring-1 ring-line">
                  {column.length}
                </span>
              </span>
              {onAdd && (
                <button
                  type="button"
                  onClick={() => onAdd(group.value)}
                  className="flex h-5 w-5 items-center justify-center rounded text-faint hover:bg-hover hover:text-muted"
                  aria-label={`Add to ${group.label}`}
                >
                  <Plus size={14} />
                </button>
              )}
            </header>

            <div className="scrollarea flex-1 space-y-1.5 overflow-y-auto p-0.5">
              {column.map((t) => (
                <div
                  key={t.id}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('text/task-id', t.id);
                    e.dataTransfer.effectAllowed = 'move';
                  }}
                >
                  <TaskChip task={t} onOpen={() => onOpen(t)} cardProps={cardProps} users={users} />
                </div>
              ))}
              {!column.length && (
                <p className="px-2 py-6 text-center text-2xs text-faint">Nothing here</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
