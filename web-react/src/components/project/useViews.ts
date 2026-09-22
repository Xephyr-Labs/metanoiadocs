import { useCallback, useEffect, useRef, useState } from 'react';
import { tasksApi, type ViewConfig, type ViewKind, type ViewRow } from '../../lib/tasksApi';
import { viewPropsKey } from '../../lib/viewProps';
import type { Filter } from '../../lib/taskFilter';

/** How long a toolbar change waits before it is written. Dragging a sort
 *  direction or ticking four properties in a row is one intent, not four. */
const SAVE_DELAY = 600;

/**
 * What a project's views were before they were rows.
 *
 * Filters lived in localStorage under the *project's* id and the shown
 * properties under `viewProps:<project>:<kind>`, so upgrading would otherwise
 * silently empty every board someone had set up. This lifts them into the
 * seeded views once and then leaves the keys alone — they are read again only
 * if a view's config is still untouched, so a later deliberate "show
 * everything" is never overwritten by a stale key.
 */
function inherited(projectId: string, view: ViewRow): ViewConfig | null {
  if (Object.keys(view.config ?? {}).length) return null;
  const out: ViewConfig = {};
  try {
    const savedFilters = localStorage.getItem(`mn-filters-${projectId}`);
    const parsed = savedFilters ? JSON.parse(savedFilters) : null;
    if (Array.isArray(parsed) && parsed.length) out.filters = parsed as Filter[];
  } catch { /* a half-written key is not an error, it is just not a filter set */ }
  try {
    const savedProps = localStorage.getItem(viewPropsKey(projectId, view.kind));
    const parsed = savedProps ? JSON.parse(savedProps) : null;
    if (Array.isArray(parsed) && parsed.every((x) => typeof x === 'string')) out.props = parsed;
  } catch { /* same */ }
  return Object.keys(out).length ? out : null;
}

/**
 * A database's saved views.
 *
 * The server seeds the six tabs the app has always shown the first time a
 * project is asked for them, so this never has to deal with "no views" — and
 * every one of those tabs is now a real row that can be renamed, refiltered,
 * sorted, grouped and deleted on its own.
 *
 * Config writes are debounced and optimistic: the toolbar has to feel like a
 * toolbar, and a PATCH per keystroke on a filter value would be a request per
 * character. The server merges rather than replaces, so two facets saved from
 * two controls do not race each other into a half-written view.
 */
/** The view a database opens on when the address names none: the board, if
 *  it has one. The backlog is first in the strip because planning reads left
 *  to right, but it is a planning tool, and most visits are to see where the
 *  work stands — which is the board. */
const firstView = (rows: ViewRow[]) => rows.find((v) => v.kind === 'board') ?? rows[0];

export function useViews(projectId: string | null) {
  const [views, setViews] = useState<ViewRow[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  // Clearing the map as well as the timers: this unmounts on every project
  // switch, and a stale id left behind would coalesce with the next project's.
  useEffect(() => () => {
    for (const t of timers.current.values()) clearTimeout(t);
    timers.current.clear();
  }, []);

  const load = useCallback(async () => {
    if (!projectId) { setViews([]); setActiveId(null); setLoading(false); return; }
    setLoading(true);
    try {
      const rows = await tasksApi.views(projectId);
      setViews(rows);
      setActiveId((cur) => (rows.some((v) => v.id === cur) ? cur : firstView(rows)?.id ?? null));
      // One-time lift of the pre-views localStorage settings.
      for (const v of rows) {
        const config = inherited(projectId, v);
        if (!config) continue;
        tasksApi.patchView(v.id, { config })
          .then((row) => setViews((prev) => prev.map((x) => (x.id === row.id ? row : x))))
          .catch(() => { /* the view simply opens on its defaults */ });
      }
    } catch {
      setViews([]);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  const active = views.find((v) => v.id === activeId) ?? firstView(views) ?? null;

  /** Merge a change into a view, on screen now and on the server shortly. */
  const setConfig = useCallback((id: string, patch: ViewConfig) => {
    setViews((prev) => prev.map((v) => (v.id === id ? { ...v, config: { ...v.config, ...patch } } : v)));
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.set(id, setTimeout(() => {
      timers.current.delete(id);
      tasksApi.patchView(id, { config: patch }).catch(() => load());
    }, SAVE_DELAY));
  }, [load]);

  const rename = useCallback((id: string, name: string) => {
    setViews((prev) => prev.map((v) => (v.id === id ? { ...v, name } : v)));
    tasksApi.patchView(id, { name }).catch(() => load());
  }, [load]);

  const retype = useCallback((id: string, kind: ViewKind) => {
    setViews((prev) => prev.map((v) => (v.id === id ? { ...v, kind } : v)));
    tasksApi.patchView(id, { kind }).catch(() => load());
  }, [load]);

  const create = useCallback(async (kind: ViewKind, name?: string) => {
    if (!projectId) return;
    try {
      const row = await tasksApi.createView(projectId, { kind, name });
      setViews((prev) => [...prev, row]);
      setActiveId(row.id);
    } catch { load(); }
  }, [projectId, load]);

  /** A copy carries the settings — duplicating a view is how you keep one and
   *  try a different filter on the other. */
  const duplicate = useCallback(async (view: ViewRow) => {
    if (!projectId) return;
    try {
      const row = await tasksApi.createView(projectId, {
        kind: view.kind,
        name: `${view.name} copy`,
        config: view.config,
      });
      setViews((prev) => [...prev, row]);
      setActiveId(row.id);
    } catch { load(); }
  }, [projectId, load]);

  const remove = useCallback(async (id: string) => {
    const before = views;
    const next = views.filter((v) => v.id !== id);
    // The server refuses the last one; not asking for it keeps the button
    // honest, but the guard stays because two tabs can delete at once.
    if (!next.length) return 'A database needs at least one view.';
    setViews(next);
    setActiveId((cur) => (cur === id ? next[0].id : cur));
    try {
      await tasksApi.deleteView(id);
      return null;
    } catch (e) {
      setViews(before);
      return e instanceof Error ? e.message : 'Could not delete that view.';
    }
  }, [views]);

  return { views, active, activeId: active?.id ?? null, setActiveId, loading, setConfig, rename, retype, create, duplicate, remove, reload: load };
}
