import { useState } from 'react';
import { Plus } from 'lucide-react';
import { cn } from '../../lib/cn';
import { STATUSES, STATUS_LABEL, type TaskRow, type TaskStatus } from '../../lib/tasksApi';
import { TaskChip } from './TaskChip';

interface Props {
  tasks: TaskRow[];
  onMove: (id: string, status: TaskStatus, position: number) => void;
  onOpen: (t: TaskRow) => void;
  onAdd: (status: TaskStatus) => void;
}

/**
 * Kanban. Uses the native HTML drag-and-drop API rather than a drag library —
 * columns are drop targets and a card carries its own id, which is all this
 * needs.
 */
export function Board({ tasks, onMove, onOpen, onAdd }: Props) {
  const [over, setOver] = useState<TaskStatus | null>(null);

  return (
    <div className="flex h-full gap-3 overflow-x-auto p-4">
      {STATUSES.map((status) => {
        const column = tasks
          .filter((t) => t.status === status)
          .sort((a, b) => a.position - b.position);
        return (
          <div
            key={status}
            onDragOver={(e) => { e.preventDefault(); setOver(status); }}
            onDragLeave={() => setOver((s) => (s === status ? null : s))}
            onDrop={(e) => {
              e.preventDefault();
              setOver(null);
              const id = e.dataTransfer.getData('text/task-id');
              if (!id) return;
              const last = column[column.length - 1];
              onMove(id, status, (last ? last.position : 0) + 1);
            }}
            className={cn(
              'flex w-[280px] shrink-0 flex-col rounded-xl bg-surface p-2 transition-colors duration-120',
              over === status && 'ring-2 ring-inset ring-accent',
            )}
          >
            <header className="flex h-8 items-center justify-between px-1.5">
              <span className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
                {STATUS_LABEL[status]}
                <span className="text-2xs font-normal text-faint">{column.length}</span>
              </span>
              <button
                type="button"
                onClick={() => onAdd(status)}
                className="flex h-5 w-5 items-center justify-center rounded text-faint hover:bg-hover hover:text-muted"
                aria-label={`Add to ${STATUS_LABEL[status]}`}
              >
                <Plus size={14} />
              </button>
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
                  <TaskChip task={t} onOpen={() => onOpen(t)} />
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
