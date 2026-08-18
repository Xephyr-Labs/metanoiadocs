export type DropZone = 'before' | 'inside' | 'after';

/**
 * Which third of a row the pointer is over: the outer quarters place the dragged
 * row next to this one, the middle half puts it *inside*. `nestable` is false for
 * rows that can hold nothing — they fall back to a plain before/after split, so
 * the whole row height stays usable for reordering rather than going dead.
 */
export function dropZone(offsetY: number, height: number, nestable = true): DropZone {
  const t = height > 0 ? offsetY / height : 0;
  if (!nestable) return t < 0.5 ? 'before' : 'after';
  if (t < 0.25) return 'before';
  if (t > 0.75) return 'after';
  return 'inside';
}

/**
 * Sibling ordering for the sidebar's drag-reorder, shared by pages and folders.
 *
 * `ids` is the *target's* container in its current order. The dragged row may
 * come from somewhere else entirely, so it is removed first and then placed —
 * that is what makes dragging a page from one folder onto a row in another
 * both move it and put it where it was dropped, in one gesture.
 *
 * Returns null when there is nothing to do: a row dropped on itself, or a
 * target that has since left the list.
 */
export function placeAt(
  ids: string[],
  dragId: string,
  targetId: string,
  place: 'before' | 'after',
): string[] | null {
  if (dragId === targetId) return null;
  const next = ids.filter((id) => id !== dragId);
  const at = next.indexOf(targetId);
  if (at === -1) return null;
  next.splice(place === 'before' ? at : at + 1, 0, dragId);
  return next;
}
