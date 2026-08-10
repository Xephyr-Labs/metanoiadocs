import { CheckCircle2, FilePlus2, MessageSquareText, Pencil, Plus } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { relativeTime } from '../../lib/time';
import { avatarFor } from '../../lib/avatar';
import type { ActivityRow, MyTask, ProjectRow } from '../../lib/tasksApi';

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
    <section className={cn('min-w-0 rounded-xl border border-line bg-canvas p-4', className)}>
      {(title || action) && (
        <header className="mb-3 flex items-center justify-between">
          <h2 className="text-2xs font-semibold uppercase tracking-wide text-faint">{title}</h2>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function StatTile({ label, value, tone }: { label: string; value: number; tone?: 'danger' | 'accent' }) {
  return (
    <div className="px-1">
      <p
        className={cn(
          'font-display text-3xl leading-8',
          tone === 'danger' && value > 0 ? 'text-danger' : tone === 'accent' ? 'text-accent' : 'text-ink',
        )}
      >
        {value}
      </p>
      <p className="mt-0.5 text-xs text-muted">{label}</p>
    </div>
  );
}

/** Donut showing done/total. Pure SVG — no chart library for one ring. */
export function ProgressRing({ pct, size = 34 }: { pct: number; size?: number }) {
  const r = (size - 4) / 2;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0" aria-hidden>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line)" strokeWidth={3} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="var(--accent)"
        strokeWidth={3}
        strokeLinecap="round"
        strokeDasharray={`${(c * pct) / 100} ${c}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" className="fill-muted text-3xs">
        {pct}
      </text>
    </svg>
  );
}

export function ProjectCard({ project, onOpen }: { project: ProjectRow; onOpen: () => void }) {
  const total = Number(project.total);
  const done = Number(project.done);
  const overdue = Number(project.overdue);
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex items-center gap-3 rounded-xl border border-line bg-canvas p-4 text-left transition-colors duration-120 hover:border-accent/50 hover:bg-accent-soft/50"
    >
      <span className="text-xl leading-none">{project.icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-ink">{project.name}</span>
        <span className="mt-0.5 block text-xs text-muted">
          {done}/{total} done
          {overdue > 0 && <span className="text-danger"> · {overdue} overdue</span>}
        </span>
      </span>
      <ProgressRing pct={pct} />
    </button>
  );
}

export function DocCard({ doc, onOpen }: {
  doc: { id: string; title: string; icon: string; updated_at: string; updated_by_name?: string | null };
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex h-full min-h-[132px] flex-col justify-between gap-3 rounded-lg border border-line bg-canvas p-4 text-left transition-colors duration-120 hover:border-accent/50 hover:bg-accent-soft/50"
    >
      <span className="text-xl leading-none">{doc.icon || '📄'}</span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium text-ink">{doc.title || 'Untitled'}</span>
        <span className="mt-0.5 block truncate text-xs text-faint">
          {doc.updated_by_name ? `${doc.updated_by_name} · ` : ''}{relativeTime(doc.updated_at)}
        </span>
      </span>
    </button>
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
      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors duration-120 hover:bg-hover"
    >
      <span
        className={cn(
          'h-1.5 w-1.5 shrink-0 rounded-full',
          task.bucket === 'overdue' ? 'bg-danger' : task.status === 'doing' ? 'bg-accent' : 'bg-line-strong',
        )}
      />
      <span className="min-w-0 flex-1 truncate text-sm text-ink">{task.title || 'Untitled task'}</span>
      <span className="shrink-0 truncate text-2xs text-faint">{task.project_name}</span>
      {task.due_at && (
        <span className={cn('shrink-0 text-2xs', task.bucket === 'overdue' ? 'text-danger' : 'text-faint')}>
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
      <p className={cn('mb-1 px-2 text-2xs font-semibold uppercase tracking-wide', bucket === 'overdue' ? 'text-danger' : 'text-faint')}>
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
      className="flex w-full items-start gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors duration-120 hover:bg-hover"
    >
      <span
        className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-3xs font-semibold text-white"
        style={{ background: av.color }}
      >
        {av.initials}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-ink">
          <span className="font-medium">{who}</span>{' '}
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
