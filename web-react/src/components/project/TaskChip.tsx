import { Diamond, Link2 } from 'lucide-react';
import { avatarFor } from '../../lib/avatar';
import { cn } from '../../lib/cn';
import { todayISO } from '../../lib/gantt';
import { swatch } from '../../lib/tagColors';
import { KIND_LABEL, type TaskKind, type TaskRow } from '../../lib/tasksApi';

// Epic borrows the shared purple swatch so it darkens with tags/folders/projects
// instead of carrying its own one-off hex (which had no dark-mode value).
const KIND_STYLE: Record<TaskKind, string> = {
  epic: swatch('purple').chip,
  story: 'bg-accent-soft text-accent',
  task: 'bg-surface text-muted',
  bug: 'bg-danger/10 text-danger',
};

/** Small colored type chip (epic/story/task/bug). Plain tasks stay unbadged. */
export function KindBadge({ kind, always }: { kind: TaskKind; always?: boolean }) {
  if (kind === 'task' && !always) return null;
  return (
    <span className={cn('shrink-0 rounded px-1 py-0.5 text-3xs font-semibold uppercase tracking-wide', KIND_STYLE[kind])}>
      {KIND_LABEL[kind]}
    </span>
  );
}

export const shortDate = (iso: string | null) =>
  iso
    ? new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    : '';

export const isOverdue = (t: TaskRow) =>
  !!t.due_at && t.status !== 'done' && t.due_at.slice(0, 10) < todayISO();

/** A task as it appears on the board and in the calendar. */
export function TaskChip({ task, onOpen, compact }: { task: TaskRow; onOpen: () => void; compact?: boolean }) {
  const av = task.assignee_name ? avatarFor(task.assignee_name) : null;
  const overdue = isOverdue(task);

  if (compact) {
    return (
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          'flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-2xs transition-colors hover:bg-hover',
          overdue ? 'text-danger' : 'text-ink',
        )}
      >
        <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', overdue ? 'bg-danger' : task.status === 'done' ? 'bg-line-strong' : 'bg-accent')} />
        <span className="truncate">{task.title || 'Untitled'}</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full rounded-lg bg-canvas p-2.5 text-left shadow-subtle transition-colors duration-120 hover:bg-hover"
    >
      <div className="flex items-start gap-1.5">
        {task.milestone && <Diamond size={12} className="mt-1 shrink-0 fill-current text-accent" />}
        <span className={cn('flex-1 text-sm leading-5 text-ink', task.status === 'done' && 'line-through text-muted')}>
          {task.title || 'Untitled'}
        </span>
      </div>

      {task.progress > 0 && task.status !== 'done' && (
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-line">
          <div className="h-full rounded-full bg-accent" style={{ width: `${task.progress}%` }} />
        </div>
      )}

      <div className="mt-2 flex items-center gap-2">
        <KindBadge kind={task.kind} />
        {task.points != null && (
          <span className="rounded-full bg-surface px-1.5 text-2xs font-medium text-muted" title="Story points">{task.points}</span>
        )}
        {task.due_at && (
          <span className={cn('text-2xs', overdue ? 'font-medium text-danger' : 'text-faint')}>
            {shortDate(task.due_at)}
          </span>
        )}
        {task.deps.length > 0 && (
          <span className="flex items-center gap-0.5 text-2xs text-faint" title={`${task.deps.length} dependencies`}>
            <Link2 size={12} />{task.deps.length}
          </span>
        )}
        <span className="flex-1" />
        {av && (
          <span
            className="flex h-5 w-5 items-center justify-center rounded-full text-3xs font-semibold text-white"
            style={{ background: av.color }}
            title={task.assignee_name ?? ''}
          >
            {av.initials}
          </span>
        )}
      </div>
    </button>
  );
}
