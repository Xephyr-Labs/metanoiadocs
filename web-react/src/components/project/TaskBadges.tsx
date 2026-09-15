/* Hallmark · component: task badge primitives · genre: modern-minimal
 * theme: project tokens (index.css) + tag palette (lib/tagColors)
 * pre-emit critique: P5 H5 E5 S5 R5 V4
 * states: default · loading (types not fetched) · deleted type · overflow · empty
 */
// The small pieces a task draws wherever it appears — its type, its people,
// its dates.
//
// They live apart from TaskChip because the property chips need them too, and
// TaskChip already renders PropChips: importing back the other way would make
// a cycle between the two. A shared leaf module is the usual answer, and it
// keeps a card and a chip drawing the *same* avatar stack rather than two that
// drift.
import { avatarFor } from '../../lib/avatar';
import { cn } from '../../lib/cn';
import { todayISO } from '../../lib/gantt';
import { swatch } from '../../lib/tagColors';
import type { TaskKind, TaskRow } from '../../lib/tasksApi';
import { useKind, useKinds } from './kinds';

/**
 * The type chip. Colour comes from the shared tag palette, so a type darkens
 * with tags, folders and projects instead of carrying its own one-off hex.
 *
 * Two different absences used to render the same blank space: types not
 * fetched yet, and a type deleted from another tab since this task was loaded.
 * Only the first is nothing to say — the second gets the raw key in neutral
 * ink, so the task doesn't look untyped.
 */
export function KindBadge({ kind }: { kind: TaskKind }) {
  const kinds = useKinds();
  const loaded = kinds.length > 0;
  const row = useKind(kind);
  if (row && (kinds.length < 2 || row.key === 'task')) return null;
  if (!row) {
    if (!loaded) return null;
    return (
      <span
        title="This type no longer exists — reopen the project to resync"
        className={cn('shrink-0 rounded px-1 py-0.5 text-3xs font-semibold uppercase tracking-wide', swatch('gray').chip)}
      >
        {kind}
      </span>
    );
  }
  return (
    <span className={cn('shrink-0 rounded px-1 py-0.5 text-3xs font-semibold uppercase tracking-wide', swatch(row.color).chip)}>
      {row.label}
    </span>
  );
}

/**
 * The faces of everyone on a task, overlapped. `max` keeps a task with eight
 * people on it from pushing the rest of a card's metadata off the end; the
 * remainder shows as a count, and the full list is in the tooltip.
 */
export function AssigneeStack({ people, max = 3 }: { people: TaskRow['assignees']; max?: number }) {
  const list = people ?? [];
  if (!list.length) return null;
  const shown = list.slice(0, max);
  return (
    <span className="flex shrink-0 items-center" title={list.map((p) => p.name).join(', ')}>
      {shown.map((person, i) => {
        const av = avatarFor(person.name);
        return (
          <span
            key={person.id}
            className={cn(
              'flex h-5 w-5 items-center justify-center rounded-full text-3xs font-semibold text-white ring-1 ring-canvas',
              i > 0 && '-ml-1.5',
            )}
            style={{ background: av.color }}
          >
            {av.initials}
          </span>
        );
      })}
      {list.length > shown.length && (
        <span className="ml-1 text-2xs text-faint">+{list.length - shown.length}</span>
      )}
    </span>
  );
}

export const shortDate = (iso: string | null) =>
  iso
    ? new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    : '';

export const isOverdue = (t: TaskRow) =>
  !!t.due_at && t.status !== 'done' && t.due_at.slice(0, 10) < todayISO();
