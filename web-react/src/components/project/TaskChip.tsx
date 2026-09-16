/* Hallmark · component: task card · genre: modern-minimal
 * theme: project tokens (index.css)
 * pre-emit critique: P5 H5 E4 S5 R5 V4
 * states: default · hover · focus-visible · active · compact · flush ·
 *         done · overdue · in progress · with cover · empty title
 */
import { Link2 } from 'lucide-react';
import { cn } from '../../lib/cn';
import { isImageFile, isVideoFile, type StoredFile } from '../../lib/uploads';
import type { PropRow, TaskRow } from '../../lib/tasksApi';
import type { UserRow } from '../../lib/docsApi';
import { isOverdue } from './TaskBadges';
import { PropChips } from './props/PropChips';

// Re-exported so the views that drew these long before the property system
// existed keep their import path.
export { AssigneeStack, KindBadge, shortDate, isOverdue } from './TaskBadges';

/**
 * A task as it appears on the board, in the gallery and in the calendar.
 *
 * `flush` drops the card's own rounding, shadow and background so the gallery
 * can sit it directly under a preview panel inside one shared card frame —
 * the metadata row stays identical to the board's rather than being copied.
 *
 * The metadata under the title is not hard-coded any more. Type, points, due
 * date and assignees are properties like every other, delivered in
 * `cardProps` and drawn by PropChips, so the view's visibility panel governs
 * all of them; that default set is simply what the card drew before. What stays hard-coded here is the two things
 * that are *not* properties: how far along the task is, and what it waits on.
 */
export function TaskChip({ task, onOpen, compact, flush, cover, cardProps, users }: {
  task: TaskRow;
  onOpen: () => void;
  compact?: boolean;
  flush?: boolean;
  /** Suppresses the card's own thumbnails — the gallery is already showing
   *  this file full-width above, and twice is once too many. */
  cover?: StoredFile | null;
  /** Properties this view shows, already filtered and ordered. Omitted on
   *  views with no room for them (the compact chip) or no setting yet. */
  cardProps?: PropRow[];
  users?: UserRow[];
}) {
  const overdue = isOverdue(task);

  if (compact) {
    return (
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          'flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-2xs transition-colors hover:bg-hover',
          overdue ? 'text-danger-strong' : 'text-ink',
        )}
      >
        <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', overdue ? 'bg-danger-strong' : task.status === 'done' ? 'bg-line-strong' : 'bg-accent')} />
        <span className="truncate font-medium">{task.title || 'Untitled'}</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'w-full p-3 text-left transition-[background-color,border-color,box-shadow] duration-120',
        'hover:bg-hover active:bg-selected',
        flush ? 'bg-transparent' : 'rounded-lg border border-line bg-canvas hover:border-line-strong hover:shadow-subtle',
      )}
    >
      <div className="flex items-start gap-1.5">
        {/* A milestone is drawn by its own property chip now, so the title row
            is just the title — one less thing competing with it. */}
        <span className={cn('flex-1 text-sm font-semibold leading-5 text-ink', task.status === 'done' && 'line-through text-muted')}>
          {task.title || 'Untitled'}
        </span>
      </div>

      {cardProps?.length ? (
        <PropChips task={task} props={cardProps} users={users} skipFile={cover} className="mt-2" />
      ) : null}

      {task.progress > 0 && task.status !== 'done' && (
        <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-line">
          <div className="h-full rounded-full bg-accent" style={{ width: `${task.progress}%` }} />
        </div>
      )}

      {task.deps.length > 0 && (
        <div className="mt-2 flex items-center gap-0.5 text-2xs text-faint" title={`${task.deps.length} dependencies`}>
          <Link2 size={12} />{task.deps.length}
        </div>
      )}
    </button>
  );
}

/**
 * The image or video a card can lead with, or null when it has none.
 *
 * Attachments first, because that is the field people actually put a picture
 * in — a `file` property is the deliberate, named case and attachments are
 * the drop-it-here one. Within each, the first image wins over the first
 * video: a still costs one request and always renders, where a poster frame
 * depends on the browser fetching enough of the file to find one.
 */
export function coverFile(task: TaskRow, props?: PropRow[]): StoredFile | null {
  const pools: StoredFile[][] = [task.attachments ?? []];
  for (const p of props ?? []) {
    if (p.type === 'file') {
      const v = task.props?.[p.id];
      if (Array.isArray(v)) pools.push(v as StoredFile[]);
    }
  }
  const all = pools.flat();
  return all.find(isImageFile) ?? all.find(isVideoFile) ?? null;
}
