/**
 * Picking several rows out of a list.
 *
 * The rules are small but they are the ones everyone already knows from every
 * file manager and mail client — click to pick one, shift-click to take
 * everything between — and getting them slightly wrong is immediately
 * noticeable, which is why they are here on their own with a test rather than
 * inline in a click handler.
 */

/** `set` with `id` added or taken away. A new Set, never the one passed in. */
export function toggle(set: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(set);
  if (!next.delete(id)) next.add(id);
  return next;
}

/**
 * Every id from `anchor` to `id` inclusive, in list order, whichever way round
 * they were clicked. An anchor that is no longer in the list (its row was
 * filtered away, or deleted) selects just `id` — the alternative is a range
 * measured from nothing, which selects a surprising half of the table.
 */
export function range(ids: readonly string[], anchor: string | null, id: string): string[] {
  const to = ids.indexOf(id);
  if (to < 0) return [];
  const from = anchor === null ? -1 : ids.indexOf(anchor);
  if (from < 0) return [id];
  return ids.slice(Math.min(from, to), Math.max(from, to) + 1);
}

/**
 * The selection after a click, and the anchor to measure the next range from.
 *
 * A plain click moves the anchor; a shift-click extends from it and leaves it
 * where it was, so shift-clicking twice re-measures from the same row rather
 * than growing by accident.
 */
export function click(
  selected: ReadonlySet<string>,
  ids: readonly string[],
  anchor: string | null,
  id: string,
  shift: boolean,
): { selected: Set<string>; anchor: string | null } {
  if (!shift) return { selected: toggle(selected, id), anchor: id };
  const span = range(ids, anchor, id);
  const next = new Set(selected);
  for (const each of span) next.add(each);
  return { selected: next, anchor };
}

/** Drop the ids that are no longer in the list — filtered away, or deleted.
 *  Returns the same Set when nothing changed, so React can skip the render. */
export function prune(selected: ReadonlySet<string>, ids: readonly string[]): Set<string> {
  const live = new Set(ids);
  const next = new Set([...selected].filter((id) => live.has(id)));
  return next.size === selected.size ? (selected as Set<string>) : next;
}
