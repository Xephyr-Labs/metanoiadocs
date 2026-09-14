import { useCallback, useEffect, useState } from 'react';
import type { PropRow } from './tasksApi';

/**
 * Which properties a view shows on its cards, and in what order.
 *
 * Per project AND per view, because the answer differs: a calendar cell has
 * room for two chips, a gallery tile for six. Stored as an ordered list of
 * property ids — the order IS the display order, which is why this is a list
 * and not a set of booleans.
 *
 * Kept in localStorage beside the view's filters. It is a display preference,
 * not data: losing it costs a reconfigure, and syncing it to the server would
 * mean one person's card layout reshaping everyone else's screen.
 */
const KEY_PREFIX = 'viewProps';

export const viewPropsKey = (projectId: string, view: string) =>
  `${KEY_PREFIX}:${projectId}:${view}`;

/** How many properties a freshly opened view shows before anyone configures it. */
const DEFAULT_SHOWN = 3;

/**
 * Split the project's properties into shown (in stored order) and hidden.
 *
 * `order` is whatever was in storage, which is not to be trusted: it can name
 * a property that has since been deleted, repeat one, or be missing ones added
 * to the database later. Deleted and duplicate ids are dropped; new properties
 * land in Hidden rather than silently appearing on every card.
 *
 * A null `order` means nothing was ever stored — that is the only case that
 * gets the default, so "I hid everything" survives a reload instead of
 * springing back to three chips.
 */
export function resolveViewProps(
  order: string[] | null,
  props: PropRow[],
): { visible: PropRow[]; hidden: PropRow[] } {
  if (order === null) {
    return { visible: props.slice(0, DEFAULT_SHOWN), hidden: props.slice(DEFAULT_SHOWN) };
  }
  const byId = new Map(props.map((p) => [p.id, p]));
  const seen = new Set<string>();
  const visible: PropRow[] = [];
  for (const id of order) {
    const p = byId.get(id);
    if (p && !seen.has(id)) {
      seen.add(id);
      visible.push(p);
    }
  }
  return { visible, hidden: props.filter((p) => !seen.has(p.id)) };
}

/** Move `id` one place within the list; a no-op at either end. */
export function moveInOrder(order: string[], id: string, by: -1 | 1): string[] {
  const i = order.indexOf(id);
  const j = i + by;
  if (i === -1 || j < 0 || j >= order.length) return order;
  const next = [...order];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

function read(key: string): string[] | null {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return null;
    const parsed = JSON.parse(raw);
    // Anything can be in localStorage — a half-written value, a key someone
    // edited by hand. A shape we don't recognise reads as "never configured".
    return Array.isArray(parsed) && parsed.every((x) => typeof x === 'string') ? parsed : null;
  } catch {
    return null;
  }
}

export function useViewProps(projectId: string | null, view: string, props: PropRow[]) {
  const key = projectId ? viewPropsKey(projectId, view) : null;
  const [order, setOrder] = useState<string[] | null>(() => (key ? read(key) : null));

  // Switching project or view swaps the whole preference, so re-read rather
  // than carrying the previous view's list across.
  useEffect(() => {
    setOrder(key ? read(key) : null);
  }, [key]);

  const write = useCallback(
    (next: string[]) => {
      setOrder(next);
      if (key) {
        try {
          localStorage.setItem(key, JSON.stringify(next));
        } catch {
          /* private mode, quota — the view still works for this session */
        }
      }
    },
    [key],
  );

  const { visible, hidden } = resolveViewProps(order, props);
  const currentOrder = visible.map((p) => p.id);

  return {
    visible,
    hidden,
    toggle: (id: string) =>
      write(
        currentOrder.includes(id)
          ? currentOrder.filter((x) => x !== id)
          : [...currentOrder, id],
      ),
    showAll: () => write(props.map((p) => p.id)),
    hideAll: () => write([]),
    move: (id: string, by: -1 | 1) => write(moveInOrder(currentOrder, id, by)),
  };
}
