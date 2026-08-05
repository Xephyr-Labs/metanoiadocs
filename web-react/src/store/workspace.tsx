import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { docsApi, type DocRow } from '../lib/docsApi';
import { tasksApi, type ProjectRow } from '../lib/tasksApi';
import { setPendingSeed } from '../editor/pendingSeed';
import type { Template } from '../data/templates';
import type { EditorMode, Page, PageId, Tag } from '../lib/types';

export type RightTab = 'comments' | 'outline' | 'details' | 'history' | 'ai';

/** Which surface fills the main column. Cheaper than a router for three screens. */
export type View = 'home' | 'doc' | 'project';

interface WorkspaceState {
  view: View;
  activeProjectId: string | null;
  openHome: () => void;
  openProject: (id: string) => void;
  projects: ProjectRow[];
  refreshProjects: () => Promise<void>;

  pages: Record<PageId, Page>;
  rootIds: PageId[];
  workspaceRootIds: PageId[];
  privateRootIds: PageId[];
  sharedRootIds: PageId[];
  libraryRootIds: PageId[];
  favoriteIds: PageId[];
  recentIds: PageId[];
  allTags: Tag[];
  tagFilter: string | null;
  unreadCount: number;
  refreshUnread: () => void;
  markInboxRead: () => void;
  currentId: PageId | null;
  currentPage: Page | null;
  loading: boolean;
  error: string | null;
  workspaceId: string;

  sidebarCollapsed: boolean;
  sidebarWidth: number;
  mobileDrawerOpen: boolean;
  rightPanel: RightTab | null;
  paletteOpen: boolean;
  shareOpen: boolean;
  settingsOpen: boolean;
  trashOpen: boolean;
  inboxOpen: boolean;
  mode: EditorMode;
  fullWidth: boolean;
  theme: 'light' | 'dark';

  refresh: () => Promise<void>;
  select: (id: PageId) => void;
  toggleExpand: (id: PageId) => void;
  toggleFavorite: (id: PageId) => void;
  setVisibility: (id: PageId, visibility: 'team' | 'private') => void;
  rename: (id: PageId, title: string) => void;
  applyTitleFromEditor: (id: PageId, title: string) => void;
  createPage: (parentId: PageId | null) => Promise<PageId | null>;
  createFromTemplate: (t: Template) => Promise<PageId | null>;
  deletePage: (id: PageId) => void;
  restorePage: (id: PageId) => Promise<void>;
  refreshTags: () => Promise<void>;
  addTagToPage: (id: PageId, body: { tagId?: string; name?: string; color?: string }) => Promise<void>;
  removeTagFromPage: (id: PageId, tagId: string) => Promise<void>;
  setTagFilter: (tagId: string | null) => void;

  setSidebarCollapsed: (v: boolean) => void;
  setSidebarWidth: (w: number) => void;
  setMobileDrawer: (v: boolean) => void;
  setRightPanel: (t: RightTab | null) => void;
  setPaletteOpen: (v: boolean) => void;
  setShareOpen: (v: boolean) => void;
  setSettingsOpen: (v: boolean) => void;
  setTrashOpen: (v: boolean) => void;
  setInboxOpen: (v: boolean) => void;
  setMode: (m: EditorMode) => void;
  setFullWidth: (v: boolean) => void;
  toggleTheme: () => void;
}

const Ctx = createContext<WorkspaceState | null>(null);

function buildPages(rows: DocRow[], expanded: Set<PageId>): Record<PageId, Page> {
  const map: Record<PageId, Page> = {};
  for (const r of rows) {
    map[r.id] = {
      id: r.id,
      title: r.title || 'Untitled',
      icon: r.icon || '📄',
      parentId: r.parent_id,
      position: r.position,
      shared: !!r.shared,
      favorite: !!r.favorite,
      role: r.role,
      visibility: r.visibility === 'private' ? 'private' : 'team',
      updatedAt: r.updated_at,
      tags: r.tags ?? [],
      children: [],
      expanded: expanded.has(r.id),
    };
  }
  const sorted = [...rows].sort((a, b) => a.position - b.position);
  for (const r of sorted) {
    if (r.parent_id && map[r.parent_id]) map[r.parent_id].children.push(r.id);
  }
  return map;
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [pages, setPages] = useState<Record<PageId, Page>>({});
  const [currentId, setCurrentId] = useState<PageId | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pagesRef = useRef(pages);
  pagesRef.current = pages;
  const bootstrapped = useRef(false);

  const [workspaceId] = useState('ws-metanoia');
  // Sign-in lands on the dashboard, never inside a document. currentId is still
  // restored below so Home can offer "continue where you left off".
  const [view, setView] = useState<View>('home');
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(260);
  const [mobileDrawerOpen, setMobileDrawer] = useState(false);
  const [rightPanel, setRightPanel] = useState<RightTab | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [recentIds, setRecentIds] = useState<PageId[]>(() => {
    try { return JSON.parse(localStorage.getItem('mn-recents') || '[]'); } catch { return []; }
  });
  const [mode, setMode] = useState<EditorMode>('page');
  const [fullWidth, setFullWidth] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const stored = localStorage.getItem('mn-theme');
    if (stored === 'dark' || stored === 'light') return stored;
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    localStorage.setItem('mn-theme', theme);
  }, [theme]);

  const applyRows = useCallback((rows: DocRow[]) => {
    const expanded = new Set(
      Object.values(pagesRef.current).filter((p) => p.expanded).map((p) => p.id),
    );
    const next = buildPages(rows, expanded);
    setPages(next);
    setCurrentId((cur) => {
      if (cur && next[cur]) return cur;
      const last = localStorage.getItem('mn-last-doc');
      if (last && next[last]) return last;
      const firstRoot = rows.find((r) => !r.parent_id) || rows[0];
      return firstRoot?.id ?? null;
    });
  }, []);

  const refresh = useCallback(async () => {
    const rows = await docsApi.list();
    applyRows(rows);
  }, [applyRows]);

  // Initial load. Brand-new accounts have no docs -> seed a first page so the
  // workspace is never empty on first sign-in.
  useEffect(() => {
    if (bootstrapped.current) return;
    bootstrapped.current = true;
    (async () => {
      try {
        let rows = await docsApi.list();
        if (rows.length === 0) {
          await docsApi.create({ title: 'Getting Started', icon: '👋' });
          rows = await docsApi.list();
        }
        applyRows(rows);
        refreshTags();
        refreshUnread();
        refreshProjects();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load documents.');
      } finally {
        setLoading(false);
      }
    })();
  }, [applyRows]);

  const refreshProjects = useCallback(async () => {
    setProjects(await tasksApi.projects().catch(() => []));
  }, []);

  const openHome = useCallback(() => {
    setView('home');
    setMobileDrawer(false);
  }, []);

  const openProject = useCallback((id: string) => {
    setActiveProjectId(id);
    setView('project');
    setMobileDrawer(false);
  }, []);

  const select = useCallback((id: PageId) => {
    setCurrentId(id);
    setView('doc');
    localStorage.setItem('mn-last-doc', id);
    setMobileDrawer(false);
    setRecentIds((prev) => {
      const r = [id, ...prev.filter((x) => x !== id)].slice(0, 8);
      localStorage.setItem('mn-recents', JSON.stringify(r));
      return r;
    });
  }, []);

  const toggleExpand = useCallback((id: PageId) => {
    setPages((p) => (p[id] ? { ...p, [id]: { ...p[id], expanded: !p[id].expanded } } : p));
  }, []);

  const toggleFavorite = useCallback((id: PageId) => {
    setPages((p) => {
      const cur = p[id];
      if (!cur) return p;
      const favorite = !cur.favorite;
      docsApi.favorite(id, favorite).catch(() => refresh());
      return { ...p, [id]: { ...cur, favorite } };
    });
  }, [refresh]);

  const setVisibility = useCallback((id: PageId, visibility: 'team' | 'private') => {
    setPages((p) => (p[id] ? { ...p, [id]: { ...p[id], visibility } } : p));
    docsApi.setVisibility(id, visibility).catch(() => refresh());
  }, [refresh]);

  const rename = useCallback((id: PageId, title: string) => {
    setPages((p) => (p[id] ? { ...p, [id]: { ...p[id], title } } : p));
    docsApi.patch(id, { title }).catch(() => refresh());
  }, [refresh]);

  // Title edited inside BlockSuite -> reflect in the sidebar + persist to the DB.
  const applyTitleFromEditor = useCallback((id: PageId, title: string) => {
    const clean = title.trim() || 'Untitled';
    setPages((p) => (p[id] && p[id].title !== clean ? { ...p, [id]: { ...p[id], title: clean } } : p));
  }, []);

  const createPage = useCallback(async (parentId: PageId | null): Promise<PageId | null> => {
    try {
      const row = await docsApi.create({ title: 'Untitled', parentId });
      await refresh();
      if (parentId) setPages((p) => (p[parentId] ? { ...p, [parentId]: { ...p[parentId], expanded: true } } : p));
      setCurrentId(row.id);
      setView('doc');
      localStorage.setItem('mn-last-doc', row.id);
      return row.id;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create page.');
      return null;
    }
  }, [refresh]);

  const createFromTemplate = useCallback(async (t: Template): Promise<PageId | null> => {
    try {
      const row = await docsApi.create({ title: t.name, icon: t.icon });
      setPendingSeed(row.id, t.blocks); // consumed by mountEditor on first mount
      await refresh();
      setCurrentId(row.id);
      setView('doc');
      localStorage.setItem('mn-last-doc', row.id);
      return row.id;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create from template.');
      return null;
    }
  }, [refresh]);

  const restorePage = useCallback(async (id: PageId) => {
    await docsApi.restore(id).catch(() => {});
    await refresh();
    setCurrentId(id);
    setView('doc');
  }, [refresh]);

  const refreshUnread = useCallback(async () => {
    const { count } = await docsApi.unreadCount().catch(() => ({ count: 0 }));
    setUnreadCount(count);
  }, []);

  const markInboxRead = useCallback(async () => {
    setUnreadCount(0);
    await docsApi.markNotificationsRead().catch(() => {});
  }, []);

  const refreshTags = useCallback(async () => {
    const t = await docsApi.tags().catch(() => []);
    setAllTags(t);
  }, []);

  const addTagToPage = useCallback(
    async (id: PageId, body: { tagId?: string; name?: string; color?: string }) => {
      // Mirror removeTagFromPage: swallow failures and re-sync from the server so
      // a network/500/duplicate-race error can't clear the input as if it worked
      // or surface as an unhandled promise rejection.
      try {
        const tag = await docsApi.addDocTag(id, body);
        setPages((p) => {
          const cur = p[id];
          if (!cur || cur.tags.some((t) => t.id === tag.id)) return p;
          return { ...p, [id]: { ...cur, tags: [...cur.tags, tag].sort((a, b) => a.name.localeCompare(b.name)) } };
        });
        refreshTags();
      } catch {
        refresh();
      }
    },
    [refresh, refreshTags],
  );

  const removeTagFromPage = useCallback(async (id: PageId, tagId: string) => {
    setPages((p) => {
      const cur = p[id];
      if (!cur) return p;
      return { ...p, [id]: { ...cur, tags: cur.tags.filter((t) => t.id !== tagId) } };
    });
    await docsApi.removeDocTag(id, tagId).catch(() => refresh());
    refreshTags();
  }, [refresh, refreshTags]);

  const deletePage = useCallback((id: PageId) => {
    const snapshot = pagesRef.current;
    if (!snapshot[id]) return;
    docsApi.remove(id).then(refresh).catch(() => refresh());
    // Optimistic local removal of the doc (children re-parent to root, matching
    // the server's soft-delete behavior).
    setPages((p) => {
      const next = { ...p };
      const target = next[id];
      if (!target) return p;
      target.children.forEach((c) => {
        if (next[c]) next[c] = { ...next[c], parentId: null };
      });
      delete next[id];
      if (target.parentId && next[target.parentId]) {
        next[target.parentId] = {
          ...next[target.parentId],
          children: next[target.parentId].children.filter((c) => c !== id),
        };
      }
      return next;
    });
    setCurrentId((c) => {
      if (c !== id) return c;
      const survivor = Object.keys(snapshot).find((pid) => pid !== id);
      return survivor ?? null;
    });
  }, [refresh]);

  const toggleTheme = useCallback(() => setTheme((t) => (t === 'dark' ? 'light' : 'dark')), []);

  const rootIds = useMemo(
    () =>
      Object.values(pages)
        .filter((p) => !p.parentId)
        .sort((a, b) => a.position - b.position || a.title.localeCompare(b.title))
        .map((p) => p.id),
    [pages],
  );
  // Placement is by visibility (a public link is a non-exclusive overlay, like a
  // favorite — it never moves a doc out of its section):
  //   Workspace = team-visible pages (everyone in the workspace sees them).
  //   Private   = your own pages you flipped to private.
  //   Library   = private pages someone explicitly shared with you.
  //   Shared    = flat list of every page that currently has a public link.
  const workspaceRootIds = useMemo(
    () => rootIds.filter((id) => pages[id]?.visibility === 'team'),
    [rootIds, pages],
  );
  const privateRootIds = useMemo(
    () => rootIds.filter((id) => pages[id]?.role === 'owner' && pages[id]?.visibility === 'private'),
    [rootIds, pages],
  );
  const libraryRootIds = useMemo(
    () => rootIds.filter((id) => pages[id]?.role !== 'owner' && pages[id]?.visibility === 'private'),
    [rootIds, pages],
  );
  const sharedRootIds = useMemo(
    () => Object.values(pages).filter((p) => p.shared).map((p) => p.id),
    [pages],
  );
  const favoriteIds = useMemo(
    () => Object.values(pages).filter((p) => p.favorite).map((p) => p.id),
    [pages],
  );
  const liveRecentIds = useMemo(() => recentIds.filter((id) => pages[id]).slice(0, 5), [recentIds, pages]);
  const currentPage = currentId ? pages[currentId] ?? null : null;

  const value = useMemo<WorkspaceState>(
    () => ({
      pages, rootIds, workspaceRootIds, privateRootIds, sharedRootIds, libraryRootIds, favoriteIds, recentIds: liveRecentIds,
      allTags, tagFilter, unreadCount, refreshUnread, markInboxRead,
      currentId, currentPage, loading, error, workspaceId,
      view, activeProjectId, openHome, openProject, projects, refreshProjects,
      sidebarCollapsed, sidebarWidth, mobileDrawerOpen, rightPanel, paletteOpen, shareOpen,
      settingsOpen, trashOpen, inboxOpen, mode, fullWidth, theme,
      refresh, select, toggleExpand, toggleFavorite, setVisibility, rename, applyTitleFromEditor,
      createPage, createFromTemplate, deletePage, restorePage,
      refreshTags, addTagToPage, removeTagFromPage, setTagFilter,
      setSidebarCollapsed, setSidebarWidth, setMobileDrawer, setRightPanel, setPaletteOpen,
      setShareOpen, setSettingsOpen, setTrashOpen, setInboxOpen, setMode, setFullWidth, toggleTheme,
    }),
    [
      pages, rootIds, workspaceRootIds, privateRootIds, sharedRootIds, libraryRootIds, favoriteIds, liveRecentIds,
      allTags, tagFilter, unreadCount, refreshUnread, markInboxRead,
      currentId, currentPage, loading, error, workspaceId,
      view, activeProjectId, openHome, openProject, projects, refreshProjects,
      sidebarCollapsed, sidebarWidth, mobileDrawerOpen, rightPanel, paletteOpen, shareOpen,
      settingsOpen, trashOpen, inboxOpen, mode, fullWidth, theme,
      refresh, select, toggleExpand, toggleFavorite, setVisibility, rename, applyTitleFromEditor,
      createPage, createFromTemplate, deletePage, restorePage,
      refreshTags, addTagToPage, removeTagFromPage, toggleTheme,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWorkspace() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useWorkspace must be used within WorkspaceProvider');
  return ctx;
}
