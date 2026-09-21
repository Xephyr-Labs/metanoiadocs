import { useCallback, useMemo, useRef, useState } from 'react';
import { click, prune } from '../../lib/selection';

export interface TaskSelection {
  selected: Set<string>;
  /** Handle a row's click. `shift` extends from the last plain click. */
  onSelect: (id: string, shift: boolean) => void;
  /** Every row in the list, or none if they are all already picked. */
  toggleAll: () => void;
  clear: () => void;
  /** The ids actually still on screen, in list order — what the bulk bar acts
   *  on, so a filtered-away row is never quietly included. */
  ids: string[];
  count: number;
}

/**
 * Which rows are picked, for the views that let you act on several at once.
 *
 * Lives above the views rather than inside one because the bar that acts on a
 * selection is the same bar whether the rows were picked in a table or on a
 * board, and two copies of it would be two answers to "what does Delete do".
 *
 * `ids` is the visible list. Narrowing a filter drops the rows it hides out of
 * the selection: a bar reading "6 selected" over a table showing four is a
 * promise about rows nobody can see.
 */
export function useTaskSelection(visibleIds: string[]): TaskSelection {
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set<string>());
  const anchor = useRef<string | null>(null);

  // Derived rather than stored, so a row that leaves the list takes itself out
  // of the selection without an effect having to notice.
  const live = useMemo(() => prune(selected, visibleIds), [selected, visibleIds]);

  const onSelect = useCallback((id: string, shift: boolean) => {
    setSelected((prev) => {
      const out = click(prune(prev, visibleIds), visibleIds, anchor.current, id, shift);
      anchor.current = out.anchor;
      return out.selected;
    });
  }, [visibleIds]);

  const toggleAll = useCallback(() => {
    setSelected((prev) => {
      const all = prune(prev, visibleIds).size >= visibleIds.length && visibleIds.length > 0;
      anchor.current = null;
      return all ? new Set<string>() : new Set(visibleIds);
    });
  }, [visibleIds]);

  const clear = useCallback(() => {
    anchor.current = null;
    setSelected(new Set<string>());
  }, []);

  return useMemo(() => ({
    selected: live as Set<string>,
    onSelect,
    toggleAll,
    clear,
    ids: visibleIds.filter((id) => live.has(id)),
    count: live.size,
  }), [live, onSelect, toggleAll, clear, visibleIds]);
}
