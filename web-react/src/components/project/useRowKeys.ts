import { useCallback, useEffect, useState } from 'react';
import { isInDialog, isTyping } from '../../lib/typing';

interface Options {
  /** Off while a dialog owns the keyboard, or on a view with no rows to walk. */
  enabled: boolean;
  /** The rows on screen, in the order they are drawn. */
  ids: string[];
  onOpen: (id: string) => void;
  onToggle: (id: string) => void;
  onClear: () => void;
}

/**
 * Walking a task list from the keyboard: j, k, Enter, x, Escape.
 *
 * The letters are the ones every mail client has used since mutt, which is the
 * whole argument for them — nobody has to learn this, and the people who reach
 * for it reach for it without looking.
 *
 * The focused row is tracked by id rather than index: a list that re-sorts
 * under a filter, or loses the row above the one you were on, should keep the
 * focus on the row you were looking at rather than on whatever slid into its
 * place. When that row goes altogether the focus goes with it, and the next j
 * starts from the top.
 *
 * Scrolling is done by finding the row in the DOM rather than by holding a ref
 * per row: three views draw these rows, in three different shapes, and a
 * `data-task-row` attribute is the one thing they can all agree to carry.
 */
export function useRowKeys({ enabled, ids, onOpen, onToggle, onClear }: Options) {
  const [focusId, setFocusId] = useState<string | null>(null);

  // A row that leaves the list takes the focus with it.
  useEffect(() => {
    if (focusId && !ids.includes(focusId)) setFocusId(null);
  }, [ids, focusId]);

  const reveal = useCallback((id: string) => {
    document.querySelector(`[data-task-row="${CSS.escape(id)}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // A dialog over the list owns the keyboard: j should not walk rows
      // behind a panel someone is reading.
      if (isTyping(e.target) || isInDialog(e.target)) return;
      if (!ids.length) return;

      const at = focusId ? ids.indexOf(focusId) : -1;
      const step = (delta: number) => {
        // From nowhere, j lands on the first row and k on the last — the two
        // ends someone pressing them is reaching for.
        const next = at < 0
          ? (delta > 0 ? 0 : ids.length - 1)
          : Math.min(ids.length - 1, Math.max(0, at + delta));
        e.preventDefault();
        setFocusId(ids[next]);
        reveal(ids[next]);
      };

      // j/k only, not the arrow keys. An arrow belongs to whatever has focus,
      // and the grid's own column-resize handles are focusable spans that
      // already read them — claiming arrows here would resize a column and
      // move the row focus with one press.
      if (e.key === 'j') return step(1);
      if (e.key === 'k') return step(-1);
      if (at < 0) {
        // Escape still clears a selection made with the mouse, even when no row
        // has the keyboard's attention.
        if (e.key === 'Escape') { e.preventDefault(); onClear(); }
        return;
      }
      if (e.key === 'Enter') { e.preventDefault(); onOpen(ids[at]); }
      else if (e.key === 'x') { e.preventDefault(); onToggle(ids[at]); }
      else if (e.key === 'Escape') { e.preventDefault(); setFocusId(null); onClear(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled, ids, focusId, onOpen, onToggle, onClear, reveal]);

  return focusId;
}
