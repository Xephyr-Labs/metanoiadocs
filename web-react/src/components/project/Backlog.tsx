import { useState } from 'react';
import { CheckCircle2, ChevronDown, MoreHorizontal, Play, Plus, Trash2 } from 'lucide-react';
import { avatarFor } from '../../lib/avatar';
import { cn } from '../../lib/cn';
import {
  STATUS_LABEL,
  type SprintRow,
  type SprintState,
  type TaskRow,
  type TaskStatus,
} from '../../lib/tasksApi';
import { Menu } from '../ui/Menu';
import { KindBadge } from './TaskChip';

interface Props {
  tasks: TaskRow[];
  sprints: SprintRow[];
  onOpen: (t: TaskRow) => void;
  onMoveToSprint: (taskId: string, sprintId: string | null) => void;
  onAdd: (sprintId: string | null) => void;
  onCreateSprint: (name: string) => void;
  onPatchSprint: (id: string, body: Partial<{ name: string; startAt: string | null; endAt: string | null; state: SprintState }>) => void;
  onDeleteSprint: (id: string) => void;
}

const shortDate = (iso: string | null) =>
  iso ? new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : null;

const STATE_BADGE: Record<SprintState, string> = {
  planned: 'bg-surface text-muted',
  active: 'bg-accent-soft text-accent',
  done: 'bg-surface text-faint',
};

function TaskLine({ task, tasks, onOpen }: { task: TaskRow; tasks: TaskRow[]; onOpen: () => void }) {
  const av = task.assignee_name ? avatarFor(task.assignee_name) : null;
  const children = task.kind === 'epic' ? tasks.filter((t) => t.parent_id === task.id) : [];
  const childDone = children.filter((t) => t.status === 'done').length;
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/task-id', task.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      onClick={onOpen}
      className="group flex h-9 cursor-pointer items-center gap-2.5 rounded-md px-2.5 transition-colors duration-120 hover:bg-hover"
    >
      <KindBadge kind={task.kind} />
      <span className={cn('min-w-0 flex-1 truncate text-[13px]', task.status === 'done' ? 'text-muted line-through' : 'text-ink')}>
        {task.title || 'Untitled'}
      </span>
      {children.length > 0 && (
        <span className="shrink-0 text-2xs text-faint" title="Stories done in this epic">
          {childDone}/{children.length}
        </span>
      )}
      {task.points != null && (
        <span className="shrink-0 rounded-full bg-surface px-1.5 py-0.5 text-2xs font-medium text-muted" title="Story points">
          {task.points}
        </span>
      )}
      <span className="hidden w-20 shrink-0 text-right text-2xs text-faint sm:block">{STATUS_LABEL[task.status as TaskStatus]}</span>
      {av ? (
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold text-white" style={{ background: av.color }} title={task.assignee_name ?? ''}>
          {av.initials}
        </span>
      ) : (
        <span className="h-5 w-5 shrink-0" />
      )}
    </div>
  );
}

function Section({
  title, meta, badge, actions, children, onDropTask, onAdd, defaultOpen = true,
}: {
  title: React.ReactNode;
  meta?: React.ReactNode;
  badge?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  onDropTask: (taskId: string) => void;
  onAdd: () => void;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [over, setOver] = useState(false);
  return (
    <section
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('text/task-id')) { e.preventDefault(); setOver(true); }
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const id = e.dataTransfer.getData('text/task-id');
        if (id) onDropTask(id);
      }}
      className={cn('rounded-xl border border-line transition-colors duration-120', over && 'border-accent bg-accent-soft/30')}
    >
      <header className="flex h-11 items-center gap-2 px-3">
        <button type="button" onClick={() => setOpen((o) => !o)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          <ChevronDown size={14} className={cn('shrink-0 text-faint transition-transform duration-150', !open && '-rotate-90')} />
          <span className="truncate text-[13px] font-semibold text-ink">{title}</span>
          {badge}
          {meta && <span className="hidden truncate text-2xs text-faint md:inline">{meta}</span>}
        </button>
        {actions}
        <button type="button" onClick={onAdd} className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-faint hover:bg-hover hover:text-muted" aria-label="Add task">
          <Plus size={14} />
        </button>
      </header>
      {open && <div className="border-t border-line p-1.5">{children}</div>}
    </section>
  );
}

/**
 * Sprint planning: one section per sprint plus the backlog (tasks with no
 * sprint). Drag a row onto a section to move it; start/complete drive the
 * single-active-sprint flow (completing returns unfinished work here).
 */
export function Backlog({ tasks, sprints, onOpen, onMoveToSprint, onAdd, onCreateSprint, onPatchSprint, onDeleteSprint }: Props) {
  const backlog = tasks.filter((t) => !t.sprint_id).sort((a, b) => b.priority - a.priority || a.position - b.position);
  const bySprint = (id: string) => tasks.filter((t) => t.sprint_id === id).sort((a, b) => a.position - b.position);

  // Inline editors instead of window.prompt: which sprint is being renamed /
  // rescheduled, and whether the new-sprint composer is open.
  const [renaming, setRenaming] = useState<string | null>(null);
  const [datesFor, setDatesFor] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);

  const commitRename = (s: SprintRow, value: string) => {
    const name = value.trim();
    if (name && name !== s.name) onPatchSprint(s.id, { name });
    setRenaming(null);
  };

  return (
    <div className="scrollarea h-full overflow-y-auto p-4">
      <div className="mx-auto max-w-[860px] space-y-3">
        {sprints.map((s) => {
          const rows = bySprint(s.id);
          const range = [shortDate(s.start_at), shortDate(s.end_at)].filter(Boolean).join(' → ');
          return (
            <Section
              key={s.id}
              title={
                renaming === s.id ? (
                  <input
                    autoFocus
                    defaultValue={s.name}
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename(s, e.currentTarget.value);
                      if (e.key === 'Escape') setRenaming(null);
                    }}
                    onBlur={(e) => commitRename(s, e.target.value)}
                    className="h-6 w-40 rounded-md border border-line bg-canvas px-1.5 text-[13px] font-semibold text-ink outline-none focus:border-accent"
                  />
                ) : (
                  s.name
                )
              }
              defaultOpen={s.state !== 'done'}
              badge={<span className={cn('shrink-0 rounded-full px-1.5 py-0.5 text-2xs font-medium capitalize', STATE_BADGE[s.state])}>{s.state}</span>}
              meta={[range, `${s.done}/${s.total} done`, Number(s.points) > 0 ? `${s.points_done}/${s.points} pts` : null].filter(Boolean).join(' · ')}
              onDropTask={(id) => onMoveToSprint(id, s.id)}
              onAdd={() => onAdd(s.id)}
              actions={
                <span className="flex shrink-0 items-center gap-1">
                  {s.state === 'planned' && (
                    <button type="button" onClick={() => onPatchSprint(s.id, { state: 'active' })} className="flex h-6 items-center gap-1 rounded-md px-2 text-2xs font-medium text-accent hover:bg-accent-soft">
                      <Play size={11} /> Start
                    </button>
                  )}
                  {s.state === 'active' && (
                    <button type="button" onClick={() => onPatchSprint(s.id, { state: 'done' })} className="flex h-6 items-center gap-1 rounded-md px-2 text-2xs font-medium text-accent hover:bg-accent-soft">
                      <CheckCircle2 size={11} /> Complete
                    </button>
                  )}
                  <Menu
                    align="end"
                    trigger={
                      <button type="button" className="flex h-6 w-6 items-center justify-center rounded text-faint hover:bg-hover hover:text-muted" aria-label="Sprint actions">
                        <MoreHorizontal size={14} />
                      </button>
                    }
                    items={[
                      { label: 'Rename', onSelect: () => setRenaming(s.id) },
                      { label: 'Edit dates', onSelect: () => setDatesFor(datesFor === s.id ? null : s.id) },
                      ...(s.state === 'done' ? [{ label: 'Reopen', onSelect: () => onPatchSprint(s.id, { state: 'planned' }) }] : []),
                      { icon: Trash2, label: 'Delete sprint', danger: true, separatorBefore: true, onSelect: () => onDeleteSprint(s.id) },
                    ]}
                  />
                </span>
              }
            >
              {datesFor === s.id && (
                <div className="mb-1 flex flex-wrap items-center gap-2 border-b border-line px-2.5 pb-2 pt-1">
                  <input
                    type="date"
                    defaultValue={s.start_at?.slice(0, 10) ?? ''}
                    onChange={(e) => onPatchSprint(s.id, { startAt: e.target.value || null })}
                    aria-label="Sprint start"
                    className="h-7 rounded-md border border-line bg-canvas px-2 text-[12px] text-ink outline-none focus:border-accent"
                  />
                  <span className="text-2xs text-faint">to</span>
                  <input
                    type="date"
                    defaultValue={s.end_at?.slice(0, 10) ?? ''}
                    onChange={(e) => onPatchSprint(s.id, { endAt: e.target.value || null })}
                    aria-label="Sprint end"
                    className="h-7 rounded-md border border-line bg-canvas px-2 text-[12px] text-ink outline-none focus:border-accent"
                  />
                  <button type="button" onClick={() => setDatesFor(null)} className="ml-auto rounded-md px-2 py-1 text-2xs font-medium text-accent hover:bg-accent-soft">
                    Done
                  </button>
                </div>
              )}
              {rows.length ? rows.map((t) => <TaskLine key={t.id} task={t} tasks={tasks} onOpen={() => onOpen(t)} />) : (
                <p className="px-3 py-4 text-center text-2xs text-faint">Drag tasks here to plan this sprint.</p>
              )}
            </Section>
          );
        })}

        <Section
          title="Backlog"
          badge={<span className="shrink-0 rounded-full bg-surface px-1.5 py-0.5 text-2xs font-medium text-muted">{backlog.length}</span>}
          onDropTask={(id) => onMoveToSprint(id, null)}
          onAdd={() => onAdd(null)}
        >
          {backlog.length ? backlog.map((t) => <TaskLine key={t.id} task={t} tasks={tasks} onOpen={() => onOpen(t)} />) : (
            <p className="px-3 py-4 text-center text-2xs text-faint">Backlog is empty.</p>
          )}
        </Section>

        {composing ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const input = e.currentTarget.elements.namedItem('sprint-name') as HTMLInputElement;
              const name = input.value.trim();
              if (name) onCreateSprint(name);
              setComposing(false);
            }}
            className="flex items-center gap-2 rounded-xl border border-line p-2"
          >
            <input
              autoFocus
              name="sprint-name"
              placeholder="Sprint name…"
              defaultValue={`Sprint ${sprints.length + 1}`}
              onKeyDown={(e) => e.key === 'Escape' && setComposing(false)}
              className="h-8 min-w-0 flex-1 rounded-md border border-line bg-canvas px-2.5 text-[13px] text-ink outline-none focus:border-accent"
            />
            <button type="submit" className="h-8 shrink-0 rounded-md bg-accent px-3 text-[13px] font-medium text-white hover:opacity-90">
              Create
            </button>
            <button type="button" onClick={() => setComposing(false)} className="h-8 shrink-0 rounded-md px-2.5 text-[13px] text-muted hover:bg-hover">
              Cancel
            </button>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setComposing(true)}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-line py-2.5 text-[13px] text-faint transition-colors hover:border-line-strong hover:text-muted"
          >
            <Plus size={14} /> New sprint
          </button>
        )}
      </div>
    </div>
  );
}
