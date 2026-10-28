import { CheckCircle2, FilePlus2, MessageSquareText, MoreHorizontal, Pencil, Plus } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { relativeTime } from '../../lib/time';
import { avatarFor } from '../../lib/avatar';
import type { ActivityRow, MyTask } from '../../lib/tasksApi';
import { ActorMark } from '../ui/ActorMark';
import { useDocMenu } from '../../hooks/useDocMenu';
import { IconButton } from '../ui/IconButton';
import { Menu } from '../ui/Menu';

/** Panel shell every home card sits in. Hairline + soft, matching the app. */
export function Card({ title, action, children, className }: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    // min-w-0: a card is always a grid/flex item, and a grid item's automatic
    // minimum is its min-content — one long doc title would push the card wider
    // than its column and slide it under the neighbouring one.
    <section className={cn('min-w-0 rounded-lg border border-line bg-canvas p-4', className)}>
      {(title || action) && (
        <header className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function DocCard({ doc, onOpen }: {
  doc: { id: string; title: string; icon: string; updated_at: string; updated_by_name?: string | null };
  onOpen: () => void;
}) {
  // A menu cannot live inside the card's own <button>, so the card is a box
  // with the button filling it and the menu sitting on top in the corner.
  const menu = useDocMenu(doc.id);
  return (
    <div className="group relative h-full">
      <button
        type="button"
        onClick={onOpen}
        className="flex h-full w-full items-start gap-2.5 rounded-lg border border-line bg-canvas p-3 pr-8 text-left transition-colors duration-120 hover:border-line-strong hover:bg-hover"
      >
        {/* Icon inline with the name, not floating above it: a 132px-tall box
            holding one line of text and an emoji was mostly empty space. It
            sits on the title's first line (`leading-5` matches the title's
            line box) rather than centring on the whole card, so a two-line
            title beside a one-line one keeps the icon at the same height. */}
        <span className="shrink-0 text-base leading-5">{doc.icon || '📄'}</span>
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 text-sm font-medium leading-5 text-ink">{doc.title || 'Untitled'}</span>
          <span className="mt-0.5 block truncate text-2xs text-faint">
            {doc.updated_by_name ? `${doc.updated_by_name} · ` : ''}{relativeTime(doc.updated_at)}
          </span>
        </span>
      </button>
      <span className="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 transition-opacity duration-120 focus-within:opacity-100 group-hover:opacity-100">
        <Menu
          align="end"
          items={menu}
          trigger={<span><IconButton icon={<MoreHorizontal size={16} />} label={`Actions for ${doc.title || 'Untitled'}`} /></span>}
        />
      </span>
    </div>
  );
}

const BUCKET_LABEL: Record<MyTask['bucket'], string> = {
  overdue: 'Overdue',
  today: 'Today',
  week: 'This week',
  later: 'Later',
};

export function TaskLine({ task, onOpen }: { task: MyTask; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors duration-120 hover:bg-hover coarse:min-h-11"
    >
      <span
        className={cn(
          'h-1.5 w-1.5 shrink-0 rounded-full',
          task.bucket === 'overdue' ? 'bg-danger-strong' : task.status === 'doing' ? 'bg-accent' : 'bg-line-strong',
        )}
      />
      <span className="min-w-0 flex-1 truncate text-sm text-ink">{task.title || 'Untitled task'}</span>
      <span className="shrink-0 truncate text-2xs text-faint">{task.project_name}</span>
      {task.due_at && (
        <span className={cn('shrink-0 text-2xs', task.bucket === 'overdue' ? 'text-danger-strong' : 'text-faint')}>
          {new Date(`${task.due_at.slice(0, 10)}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
        </span>
      )}
    </button>
  );
}

export function TaskBucket({ bucket, tasks, onOpen }: {
  bucket: MyTask['bucket'];
  tasks: MyTask[];
  onOpen: (t: MyTask) => void;
}) {
  if (!tasks.length) return null;
  return (
    <div className="mb-3 last:mb-0">
      <p className={cn('mb-1 px-2 text-2xs font-semibold', bucket === 'overdue' ? 'text-danger-strong' : 'text-muted')}>
        {BUCKET_LABEL[bucket]}
      </p>
      <div className="space-y-px">
        {tasks.map((t) => <TaskLine key={t.id} task={t} onOpen={() => onOpen(t)} />)}
      </div>
    </div>
  );
}

const VERB: Record<ActivityRow['kind'], { text: string; icon: typeof Pencil }> = {
  doc_created: { text: 'created', icon: FilePlus2 },
  doc_edited: { text: 'edited', icon: Pencil },
  comment: { text: 'commented on', icon: MessageSquareText },
  task_created: { text: 'added a task in', icon: Plus },
  task_done: { text: 'completed a task in', icon: CheckCircle2 },
};

export function ActivityLine({ row, onOpen }: { row: ActivityRow; onOpen: () => void }) {
  const { text, icon: Icon } = VERB[row.kind] ?? VERB.doc_edited;
  const who = row.actor_name || 'Someone';
  const av = avatarFor(who);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-start gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors duration-120 hover:bg-hover coarse:min-h-11 coarse:py-2.5"
    >
      <span
        className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold leading-none text-white"
        style={{ background: av.color }}
      >
        {av.initials}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-ink">
          <span className="font-medium">{who}</span>
          <ActorMark kind={row.actor_kind} via={row.via} name={who} className="ml-1" />{' '}
          <span className="text-muted">{text}</span>{' '}
          {row.title || 'Untitled'}
        </span>
        {row.body && <span className="mt-0.5 block truncate text-2xs text-faint">{row.body}</span>}
      </span>
      <span className="flex shrink-0 items-center gap-1.5 text-2xs text-faint">
        <Icon size={12} />
        {relativeTime(row.at)}
      </span>
    </button>
  );
}
