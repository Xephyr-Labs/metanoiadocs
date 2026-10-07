/* Hallmark · component: task badge primitives · genre: modern-minimal
 * theme: project tokens (index.css) + tag palette (lib/tagColors)
 * pre-emit critique: P5 H5 E5 S5 R5 V4
 * states: default · loading (types not fetched) · deleted type · overflow (+n) · empty
 * note: display only — no interactive state; the card around them owns those.
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
import type { TaskKind, TaskKindRow, TaskRow } from '../../lib/tasksApi';
import { kindVisual } from '../../lib/taskKinds';
import { useKinds } from './kinds';

/**
 * A task's type, as a glyph in a small square of the type's colour.
 *
 * One component for every view. Each used to draw its own: an uppercase chip
 * on the board, a title-case pill in the table, grey text for plain tasks on
 * cards and nothing at all for them in the backlog — so "Task" was told apart
 * by absence, and the gantt and calendar had no type at all. The glyph says
 * the type without colour, and the name is always there for a screen reader
 * and a hover even where only the glyph is drawn.
 *
 * `labelled` adds the name beside the glyph, for the few places with room for
 * it and a reason to read it: the peek's type picker and the types dialog.
 * `row` lets the types dialog draw a type it is editing before the project's
 * list has caught up.
 */
export function KindIcon({ kind, labelled, row, className }: {
  kind: TaskKind;
  labelled?: boolean;
  row?: TaskKindRow;
  className?: string;
}) {
  const kinds = useKinds();
  const v = kindVisual(kind, row ? [row] : kinds);
  const Icon = v.icon;
  const title = v.missing ? `${v.label} — this type no longer exists; reopen the project to resync` : `Type: ${v.label}`;
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1.5', className)} title={labelled ? undefined : title}>
      <span aria-hidden className={cn('flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px]', swatch(v.color).icon)}>
        <Icon size={11} strokeWidth={2.5} />
      </span>
      {labelled
        ? <span className="truncate text-sm text-ink">{v.label}</span>
        : <span className="sr-only">{v.label}</span>}
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
