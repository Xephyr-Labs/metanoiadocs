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
import { docsApi, type DocRow, type FolderRow } from '../lib/docsApi';
import { tasksApi, type ProjectRow } from '../lib/tasksApi';
import { setPendingSeed } from '../editor/pendingSeed';
import { MAX_IMPORT_BYTES } from '../lib/docFiles';
import { readRoute, showDoc, showFolder, showHome } from '../lib/route';
import { folderChain } from '../lib/folderPath';
import { useDocSaveTick } from '../lib/docSignal';
import { placeAt } from '../lib/reorder';
import { nestByParent } from '../lib/pageTree';
import type { Template } from '../data/templates';
import type { EditorMode, Folder, Page, PageId, Tag } from '../lib/types';

export type RightTab = 'intel' | 'comments' | 'outline' | 'details' | 'ai';

/** Which surface fills the main column. Cheaper than a router for four screens. */
export type View = 'home' | 'doc' | 'project' | 'folder';

interface WorkspaceState {
  view: View;
  activeProjectId: string | null;
  activeFolderId: string | null;
  openHome: () => void;
  openProject: (id: string) => void;
  /** Show a folder's contents in the main column — where a /f/<id> link lands. */
  openFolder: (id: string) => void;
  projects: ProjectRow[];
  refreshProjects: () => Promise<void>;

  pages: Record<PageId, Page>;
  folders: Record<string, Folder>;
  folderRootIds: string[];
  unfiledIds: PageId[];
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
  /** The document whose version history is open, or null. Full-screen, so it is
   *  its own piece of state rather than a right-panel tab. */
  historyDocId: PageId | null;
  openHistory: (id: PageId) => void;
  closeHistory: () => void;
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
  createPage: (folderId: string | null) => Promise<PageId | null>;
  /** A design is a page that opens on the canvas. Same everything else. */
  createDesign: () => Promise<PageId | null>;
  designIds: PageId[];
  movePage: (id: PageId, folderId: string | null) => Promise<void>;
  createChildPage: (parentId: PageId) => Promise<PageId | null>;
  reorderPage: (dragId: PageId, targetId: PageId, place: 'before' | 'after') => Promise<void>;
  linkPage: (parentId: PageId, childId: PageId) => Promise<void>;
  reorderFolder: (dragId: string, targetId: string, place: 'before' | 'after') => Promise<void>;
  moveFolder: (id: string, parentId: string | null) => Promise<void>;
  createFolder: (parentId: string | null) => Promise<string | null>;
  renameFolder: (id: string, name: string) => Promise<void>;
  setFolderColor: (id: string, color: string) => void;
  setIcon: (id: PageId, icon: string) => void;
  toggleFolder: (id: string) => void;
  deleteFolder: (id: string) => Promise<void>;
  createFromTemplate: (t: Template) => Promise<PageId | null>;
  importFiles: (files: File[], folderId: string | null) => Promise<PageId | null>;
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

function buildPages(rows: DocRow[]): Record<PageId, Page> {
  const map: Record<PageId, Page> = {};
  for (const r of rows) {
    map[r.id] = {
      id: r.id,
      title: r.title || 'Untitled',
      icon: r.icon || '📄',
      parentId: r.parent_id,
      folderId: r.folder_id ?? null,
      position: r.position,
      shared: !!r.shared,
      favorite: !!r.favorite,
      role: r.role,
      visibility: r.visibility === 'private' ? 'private' : 'team',
      kind: r.kind === 'design' ? 'design' : r.kind === 'task' ? 'task' : 'doc',
      updatedByName: r.updated_by_name ?? null,
      updatedAt: r.updated_at,
      linkCount: r.link_count ?? 0,
      tags: r.tags ?? [],
      children: [],
  };
  }
  // A page nested under another one hangs there and nowhere else — the rest of
  // the sidebar reads `parentId` to decide that, so a parent that is not in this
  // list (trashed, or private to someone else) has its children handed back to
  // the top level here rather than every caller having to check.
  const ordered = Object.values(map).sort(byOrder);
  const { roots, childrenOf } = nestByParent(ordered);
  for (const id of roots) map[id].parentId = null;
  for (const [parentId, childIds] of childrenOf) map[parentId].children = childIds;
  return map;
}

const byOrder = (a: Page, b: Page) => a.position - b.position || a.title.localeCompare(b.title);

function buildFolders(rows: FolderRow[], expanded: Set<string>, pages: Record<PageId, Page>): Record<string, Folder> {
  const map: Record<string, Folder> = {};
  for (const row of rows) {
    map[row.id] = {
      id: row.id,
      name: row.name,
      color: row.color || 'gray',
      parentId: row.parent_id,
      position: row.position,
      documentIds: [],
      children: [],
      expanded: expanded.has(row.id),
    };
  }
  // Same comparator as unfiledIds below, so a page keeps its place when it is
  // dragged from a folder to the top level. Position is what drag-reorder
  // writes; title only breaks ties among pages nobody has ordered yet.
  for (const page of Object.values(pages).sort(byOrder)) {
    if (page.parentId) continue;
    if (page.folderId && map[page.folderId]) map[page.folderId].documentIds.push(page.id);
  }
  for (const row of [...rows].sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))) {
    if (row.parent_id && map[row.parent_id]) map[row.parent_id].children.push(row.id);
  }
  return map;
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [pages, setPages] = useState<Record<PageId, Page>>({});
  const [folders, setFolders] = useState<Record<string, Folder>>({});
  const [currentId, setCurrentId] = useState<PageId | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pagesRef = useRef(pages);
  pagesRef.current = pages;
  const foldersRef = useRef(folders);
  foldersRef.current = folders;
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
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);
  const [historyDocId, setHistoryDocId] = useState<PageId | null>(null);
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

  const folderExpandedRef = useRef<Set<string>>(new Set());

  const applyRows = useCallback((rows: DocRow[], folderRows: FolderRow[]) => {
    const next = buildPages(rows);
    const nextFolders = buildFolders(folderRows, folderExpandedRef.current, next);
    setPages(next);
    setFolders(nextFolders);
    setCurrentId((cur) => {
      if (cur && next[cur]) return cur;
      // A /d/<id> address is a deliberate destination and outranks whatever was
      // open last — it is how a shared link, a block link and the back button
      // all arrive.
      const routed = readRoute().docId;
      if (routed && next[routed]) return routed;
      const last = localStorage.getItem('mn-last-doc');
      if (last && next[last]) return last;
      return rows[0]?.id ?? null;
    });
  }, []);

  // Arriving on a page or folder link opens it rather than the dashboard.
  useEffect(() => {
    const { docId, folderId } = readRoute();
    if (docId) setView('doc');
    else if (folderId) { setActiveFolderId(folderId); setView('folder'); }
  }, []);

  // Back/forward. The address is the source of truth here — this is the one
  // path where the URL changes without select() having been called.
  useEffect(() => {
    const onPop = () => {
      const { docId, folderId } = readRoute();
      if (docId) {
        setCurrentId((cur) => (pagesRef.current[docId] ? docId : cur));
        setView('doc');
      } else if (folderId) {
        setActiveFolderId(folderId);
        setView('folder');
      } else {
        setView('home');
      }
      // A version-history takeover is tied to the page underneath it; going
      // back should leave it, not strand it over whatever loads next.
      setHistoryDocId(null);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const refresh = useCallback(async () => {
    const [rows, folderRows] = await Promise.all([docsApi.list(), docsApi.folders().catch(() => [])]);
    applyRows(rows, folderRows);
  }, [applyRows]);

  // A save can change what the sidebar shows — a renamed title, a page nested
  // from inside the editor. The editor has announced its saves on a debounce all
  // along and nothing was listening; this is that listener. Guarded on the tick
  // so it doesn't fire a second list fetch on mount, on top of the one the
  // bootstrap already does.
  const saveTick = useDocSaveTick();
  useEffect(() => {
    if (saveTick) refresh().catch(() => {});
  }, [saveTick, refresh]);

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
        applyRows(rows, await docsApi.folders().catch(() => []));
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
    showHome();
  }, []);

  const openProject = useCallback((id: string) => {
    setActiveProjectId(id);
    setView('project');
    setMobileDrawer(false);
    // Projects have no address of their own yet; what matters is that the
    // /d/<id> in the bar stops claiming a document is open.
    showHome();
  }, []);

  /** Open a folder, and show in the sidebar where it lives — a link that only
   *  changed the main column leaves the reader unable to see the folder's
   *  neighbours, which is half of what a folder is. */
  const openFolder = useCallback((id: string) => {
    setActiveFolderId(id);
    setView('folder');
    setMobileDrawer(false);
    setFolders((prev) => {
      let next = prev;
      for (const f of folderChain(prev, id)) {
        folderExpandedRef.current.add(f.id);
        if (!next[f.id]?.expanded) next = { ...next, [f.id]: { ...next[f.id], expanded: true } };
      }
      return next;
    });
    showFolder(id);
  }, []);

  // A /f/<id> address arrives before the folder list does, so the reveal waits
  // for the folders and then runs exactly once — re-running it would fight
  // anyone who collapsed the tree by hand.
  const pendingFolderReveal = useRef<string | null>(readRoute().folderId);
  useEffect(() => {
    const id = pendingFolderReveal.current;
    if (!id || !folders[id]) return;
    pendingFolderReveal.current = null;
    setFolders((prev) => {
      let next = prev;
      for (const f of folderChain(prev, id)) {
        folderExpandedRef.current.add(f.id);
        if (!next[f.id]?.expanded) next = { ...next, [f.id]: { ...next[f.id], expanded: true } };
      }
      return next;
    });
  }, [folders]);

  const openHistory = useCallback((id: PageId) => setHistoryDocId(id), []);
  const closeHistory = useCallback(() => setHistoryDocId(null), []);

  const select = useCallback((id: PageId) => {
    setCurrentId(id);
    setView('doc');
    localStorage.setItem('mn-last-doc', id);
    setMobileDrawer(false);
    showDoc(id);
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

  const createPage = useCallback(async (folderId: string | null): Promise<PageId | null> => {
    try {
      const row = await docsApi.create({ title: 'Untitled', folderId });
      await refresh();
      if (folderId) {
        folderExpandedRef.current.add(folderId);
        setFolders((f) => (f[folderId] ? { ...f, [folderId]: { ...f[folderId], expanded: true } } : f));
      }
      setCurrentId(row.id);
      setView('doc');
      localStorage.setItem('mn-last-doc', row.id);
      return row.id;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create page.');
      return null;
    }
  }, [refresh]);

  const createDesign = useCallback(async (): Promise<PageId | null> => {
    try {
      const row = await docsApi.create({ title: 'Untitled design', icon: '🎨', kind: 'design' });
      await refresh();
      select(row.id);
      return row.id;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create that design.');
      return null;
    }
  }, [refresh, select]);

  const createFolder = useCallback(async (parentId: string | null): Promise<string | null> => {
    try {
      const row = await docsApi.createFolder({ name: 'New folder', parentId });
      folderExpandedRef.current.add(row.id);
      if (parentId) folderExpandedRef.current.add(parentId);
      await refresh();
      return row.id;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create folder.');
      return null;
    }
  }, [refresh]);

  const movePage = useCallback(async (id: PageId, folderId: string | null) => {
    await docsApi.patch(id, { folderId }).catch(() => {});
    await refresh();
  }, [refresh]);

  // Create a page inside another one and open it. The reference that does the
  // nesting is written into the parent's body server-side, so this only has to
  // refresh and navigate.
  const createChildPage = useCallback(async (parentId: PageId): Promise<PageId | null> => {
    try {
      const row = await docsApi.createChild(parentId);
      await refresh();
      // Same reason the drag opens its target: the page that was just made has
      // to be visible where it was made.
      setPages((p) => (p[parentId] ? { ...p, [parentId]: { ...p[parentId], expanded: true } } : p));
      setCurrentId(row.id);
      setView('doc');
      localStorage.setItem('mn-last-doc', row.id);
      showDoc(row.id);
      setMobileDrawer(false);
      return row.id;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create that page.');
      return null;
    }
  }, [refresh]);

  // Drop a page above or below another one. The target's container decides where
  // it lands, so dragging onto a page inside a folder both moves and places it —
  // one gesture, one request.
  const reorderPage = useCallback(async (dragId: PageId, targetId: PageId, place: 'before' | 'after') => {
    const all = pagesRef.current;
    const dragged = all[dragId];
    const target = all[targetId];
    if (!dragged || !target || dragId === targetId) return;

    const folderId = target.folderId;
    const siblings = Object.values(all).filter((p) => p.folderId === folderId).sort(byOrder).map((p) => p.id);
    const ids = placeAt(siblings, dragId, targetId, place);
    if (!ids) return;

    // Paint the new order immediately — the round trip is long enough that the
    // row visibly springs back to where it was dragged from otherwise.
    setPages((prev) => {
      const next = { ...prev };
      ids.forEach((id, i) => {
        if (next[id]) next[id] = { ...next[id], position: i, folderId };
      });
      return next;
    });
    await docsApi.reorder(folderId, ids).catch(() => {});
    await refresh();
  }, [refresh]);

  // Nest an existing page under another one — dropping a page onto the middle of
  // another page's row. The reference that does the nesting goes into the parent's
  // body server-side, exactly as "Add a page inside" does. A parent nobody has
  // opened yet has no body to write into, and that 409 has to reach the user:
  // silently doing nothing looks identical to a drop that missed.
  const linkPage = useCallback(async (parentId: PageId, childId: PageId) => {
    try {
      await docsApi.linkChild(parentId, childId);
      await refresh();
      // The Private and Library trees disclose from the store, so the parent has
      // to be open for the page that just moved into it to be visible at all.
      setPages((p) => (p[parentId] ? { ...p, [parentId]: { ...p[parentId], expanded: true } } : p));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not nest that page.');
    }
  }, [refresh]);

  // Drop a folder above or below another one. Same whole-list contract as
  // reorderPage, but no optimistic paint: the tree renders from each folder's
  // `children` array, which is derived on refresh — repositioning the folders
  // alone would leave the rows drawn in their old order anyway.
  const reorderFolder = useCallback(async (dragId: string, targetId: string, place: 'before' | 'after') => {
    const all = foldersRef.current;
    const target = all[targetId];
    if (!all[dragId] || !target || dragId === targetId) return;
    const parentId = target.parentId;
    const siblings = Object.values(all)
      .filter((f) => f.parentId === parentId)
      .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))
      .map((f) => f.id);
    const ids = placeAt(siblings, dragId, targetId, place);
    if (!ids) return;
    await docsApi.reorderFolders(parentId, ids).catch(() => {});
    await refresh();
  }, [refresh]);

  // Nest a folder inside another. The server rejects a move that would make a
  // folder its own ancestor; that message is worth showing rather than swallowing.
  const moveFolder = useCallback(async (id: string, parentId: string | null) => {
    if (id === parentId) return;
    try {
      await docsApi.patchFolder(id, { parentId });
      if (parentId) folderExpandedRef.current.add(parentId);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not move that folder.');
    }
  }, [refresh]);

  const renameFolder = useCallback(async (id: string, name: string) => {
    // Let a failure reject: the inline editor reports it and keeps what was
    // typed, which beats silently reverting to the old name.
    await docsApi.patchFolder(id, { name });
    await refresh();
  }, [refresh]);

  const setFolderColor = useCallback((id: string, color: string) => {
    setFolders((f) => (f[id] ? { ...f, [id]: { ...f[id], color } } : f));
    docsApi.patchFolder(id, { color }).catch(() => refresh());
  }, [refresh]);

  const setIcon = useCallback((id: PageId, icon: string) => {
    setPages((p) => (p[id] ? { ...p, [id]: { ...p[id], icon } } : p));
    docsApi.patch(id, { icon }).catch(() => refresh());
  }, [refresh]);

  const toggleFolder = useCallback((id: string) => {
    folderExpandedRef.current.has(id) ? folderExpandedRef.current.delete(id) : folderExpandedRef.current.add(id);
    setFolders((f) => (f[id] ? { ...f, [id]: { ...f[id], expanded: !f[id].expanded } } : f));
  }, []);

  const deleteFolder = useCallback(async (id: string) => {
    await docsApi.removeFolder(id).catch(() => {});
    await refresh();
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

  /**
   * Markdown files → documents. Each file is its own page; a file that fails
   * stops the run but keeps everything imported before it, which is why the
   * refresh below happens either way.
   */
  const importFiles = useCallback(async (files: File[], folderId: string | null): Promise<PageId | null> => {
    let first: PageId | null = null;
    // One file failing no longer abandons the rest: a bad PDF in a selection of
    // ten used to import nothing after it, with only the first error shown.
    const failed: string[] = [];
    const warnings: string[] = [];
    for (const file of files) {
      try {
        if (file.size > MAX_IMPORT_BYTES) throw new Error(`it is bigger than 25 MB`);
        const row = await docsApi.import(file, folderId);
        warnings.push(...(row.warnings ?? []));
        first ??= row.id;
      } catch (e) {
        failed.push(`${file.name} — ${e instanceof Error ? e.message : 'could not be imported'}`);
      }
    }
    if (failed.length) setError(failed.join('\n'));
    else if (warnings.length) setError(warnings.join('\n'));
    if (!first) return null;
    if (folderId) {
      folderExpandedRef.current.add(folderId);
      setFolders((f) => (f[folderId] ? { ...f, [folderId]: { ...f[folderId], expanded: true } } : f));
    }
    await refresh();
    setCurrentId(first);
    setView('doc');
    localStorage.setItem('mn-last-doc', first);
    return first;
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

  // Designs have their own section, so they are kept out of the document tree —
  // a page that appears in two places at once is the thing this sidebar has
  // repeatedly had to fix. Filed into a folder, a design still shows there.
  const rootIds = useMemo(
    () =>
      Object.values(pages)
        .filter((p) => !p.folderId && !p.parentId && p.kind !== 'design' && p.kind !== 'task')
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
  const designIds = useMemo(
    () => Object.values(pages).filter((p) => p.kind === 'design').sort(byOrder).map((p) => p.id),
    [pages],
  );
  const favoriteIds = useMemo(
    () => Object.values(pages).filter((p) => p.favorite).map((p) => p.id),
    [pages],
  );
  const liveRecentIds = useMemo(() => recentIds.filter((id) => pages[id]).slice(0, 5), [recentIds, pages]);
  const currentPage = currentId ? pages[currentId] ?? null : null;
  const folderRootIds = useMemo(
    () => Object.values(folders).filter((folder) => !folder.parentId).sort((a, b) => a.position - b.position || a.name.localeCompare(b.name)).map((folder) => folder.id),
    [folders],
  );
  const unfiledIds = useMemo(
    () => Object.values(pages).filter((p) => !p.folderId && !p.parentId && p.kind !== 'design' && p.kind !== 'task').sort(byOrder).map((p) => p.id),
    [pages],
  );

  const value = useMemo<WorkspaceState>(
    () => ({
      pages, folders, folderRootIds, unfiledIds, rootIds, workspaceRootIds, privateRootIds, sharedRootIds, libraryRootIds, favoriteIds, designIds, recentIds: liveRecentIds,
      allTags, tagFilter, unreadCount, refreshUnread, markInboxRead,
      currentId, currentPage, loading, error, workspaceId,
      historyDocId, openHistory, closeHistory,
      view, activeProjectId, activeFolderId, openHome, openProject, openFolder, projects, refreshProjects,
      sidebarCollapsed, sidebarWidth, mobileDrawerOpen, rightPanel, paletteOpen, shareOpen,
      settingsOpen, trashOpen, inboxOpen, mode, fullWidth, theme,
      refresh, select, toggleExpand, toggleFavorite, setVisibility, rename, applyTitleFromEditor,
      createPage, createDesign, movePage, createChildPage, reorderPage, linkPage, reorderFolder, moveFolder, createFolder, renameFolder, setFolderColor, setIcon, toggleFolder, deleteFolder, createFromTemplate, importFiles, deletePage, restorePage,
      refreshTags, addTagToPage, removeTagFromPage, setTagFilter,
      setSidebarCollapsed, setSidebarWidth, setMobileDrawer, setRightPanel, setPaletteOpen,
      setShareOpen, setSettingsOpen, setTrashOpen, setInboxOpen, setMode, setFullWidth, toggleTheme,
    }),
    [
      pages, folders, folderRootIds, unfiledIds, rootIds, workspaceRootIds, privateRootIds, sharedRootIds, libraryRootIds, favoriteIds, designIds, liveRecentIds,
      allTags, tagFilter, unreadCount, refreshUnread, markInboxRead,
      currentId, currentPage, loading, error, workspaceId,
      historyDocId, openHistory, closeHistory,
      view, activeProjectId, activeFolderId, openHome, openProject, openFolder, projects, refreshProjects,
      sidebarCollapsed, sidebarWidth, mobileDrawerOpen, rightPanel, paletteOpen, shareOpen,
      settingsOpen, trashOpen, inboxOpen, mode, fullWidth, theme,
      refresh, select, toggleExpand, toggleFavorite, setVisibility, rename, applyTitleFromEditor,
      createPage, createDesign, movePage, createChildPage, reorderPage, linkPage, reorderFolder, moveFolder, createFolder, renameFolder, setFolderColor, setIcon, toggleFolder, deleteFolder, createFromTemplate, importFiles, deletePage, restorePage,
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
