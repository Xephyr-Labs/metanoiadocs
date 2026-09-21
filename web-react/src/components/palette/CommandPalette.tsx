/* Hallmark · component: command palette · genre: modern-minimal
 * theme: project tokens (index.css)
 * pre-emit critique: P5 H5 E4 S5 R5 V4
 * states: default · hover · focus (roving, keyboard-owned) · active · loading ·
 *         empty · offline/failed · success (chosen, dismisses)
 * note: one list, three kinds of row. A task carries its key, a database its
 *       icon, a command its verb — the glyph column is what tells them apart,
 *       so it is never empty.
 */
import {
  ArrowRight, Clock, Database, FilePlus2, Files, History, Home, Inbox, ListTodo,
  Keyboard, Loader2, Moon, PanelRight, Search, Settings, Share2, Sparkles, Sun, Trash2, Upload,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '../../lib/cn';
import { docsApi, type SearchRow } from '../../lib/docsApi';
import { pickImportFiles } from '../../lib/docFiles';
import { splitKey } from '../../lib/taskKey';
import { STATUS_COLOR } from '../../lib/builtinProps';
import { swatch } from '../../lib/tagColors';
import { useWorkspace } from '../../store/workspace';
import { DocIcon } from '../ui/DocIcon';
import { Modal } from '../ui/Modal';

type Item =
  | { kind: 'page'; id: string; title: string; sub: string }
  | { kind: 'task'; id: string; title: string; sub: string; projectId: string; status: string }
  | { kind: 'database'; id: string; title: string; icon: string }
  | { kind: 'command'; id: string; title: string; icon: typeof Search; run: () => void };

export function CommandPalette() {
  const ws = useWorkspace();
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const [results, setResults] = useState<SearchRow[]>([]);
  // The palette answered instantly before there were tasks in it, and a search
  // that takes 300ms with no sign of it reads as a palette that ignored you.
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (ws.paletteOpen) { setQ(''); setActive(0); setResults([]); setBusy(false); }
  }, [ws.paletteOpen]);

  useEffect(() => {
    const query = q.trim();
    if (!query) { setResults([]); setBusy(false); return; }
    let alive = true;
    setBusy(true);
    const t = setTimeout(() => {
      docsApi.search(query)
        .then((r) => { if (alive) { setResults(r); setBusy(false); } })
        .catch(() => { if (alive) { setResults([]); setBusy(false); } });
    }, 160);
    return () => { alive = false; clearTimeout(t); };
  }, [q]);

  const commands: Item[] = useMemo(() => {
    const db = ws.projects.find((p) => p.id === ws.activeProjectId) ?? null;
    return [
      { kind: 'command', id: 'new', title: 'Create new page', icon: FilePlus2, run: () => ws.createPage(null) },
      // Offered only with a database open, because a task has to be created
      // somewhere and guessing which database is worse than not offering it.
      // The no-database answer is Quick capture, which has its own inbox.
      ...(db
        ? [{ kind: 'command' as const, id: 'newtask', title: `New task in ${db.name}`, icon: ListTodo, run: () => void ws.createTaskIn(db.id) }]
        : []),
      {
        kind: 'command',
        id: 'import',
        title: 'Import Markdown, Word or PDF as a new page',
        icon: Upload,
        run: () => { pickImportFiles().then((f) => { if (f.length) ws.importFiles(f, null); }); },
      },
      { kind: 'command', id: 'home', title: 'Go to Home', icon: Home, run: ws.openHome },
      { kind: 'command', id: 'mytasks', title: 'My tasks — every database in one list', icon: ListTodo, run: ws.openTasks },
      { kind: 'command', id: 'inbox', title: 'Open Inbox', icon: Inbox, run: () => ws.setInboxOpen(true) },
      {
        kind: 'command',
        id: 'alldocs',
        title: 'All documents — browse every page, filed or not',
        icon: Files,
        run: ws.openAllDocs,
      },
      { kind: 'command', id: 'share', title: 'Share current page', icon: Share2, run: () => ws.setShareOpen(true) },
      ...(ws.currentId
        ? [{ kind: 'command' as const, id: 'history', title: 'Version history', icon: History, run: () => ws.openHistory(ws.currentId!) }]
        : []),
      { kind: 'command', id: 'ai', title: 'Ask AI', icon: Sparkles, run: () => ws.setRightPanel('ai') },
      { kind: 'command', id: 'panel', title: 'Toggle side panel', icon: PanelRight, run: () => ws.setRightPanel(ws.rightPanel ? null : 'outline') },
      { kind: 'command', id: 'theme', title: ws.theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode', icon: ws.theme === 'dark' ? Sun : Moon, run: ws.toggleTheme },
      { kind: 'command', id: 'shortcuts', title: 'Keyboard shortcuts', icon: Keyboard, run: () => ws.setShortcutsOpen(true) },
      { kind: 'command', id: 'trash', title: 'Open Trash', icon: Trash2, run: () => ws.setTrashOpen(true) },
      { kind: 'command', id: 'settings', title: 'Open settings', icon: Settings, run: () => ws.setSettingsOpen(true) },
    ];
  }, [ws]);

  const query = q.trim().toLowerCase();

  const recentItems: Item[] = useMemo(() => {
    if (query) return [];
    const ids = JSON.parse(localStorage.getItem('mn-recents') || '[]') as string[];
    return ids.map((id) => ws.pages[id]).filter(Boolean).slice(0, 4)
      .map((p) => ({ kind: 'page' as const, id: p.id, title: p.title, sub: 'Recent' }));
  }, [query, ws.pages]);

  const allPages: Item[] = useMemo(
    () => Object.values(ws.pages).map((p) => ({ kind: 'page' as const, id: p.id, title: p.title, sub: '' })),
    [ws.pages],
  );

  // Databases are matched here rather than on the server: the whole list is
  // already in memory and there are tens of them, not thousands.
  const dbItems: Item[] = useMemo(() => {
    const rows = ws.projects.filter((p) => !query || p.name.toLowerCase().includes(query)
      || (p.key ?? '').toLowerCase().startsWith(query));
    return rows.slice(0, query ? 6 : 4)
      .map((p) => ({ kind: 'database' as const, id: p.id, title: p.name, icon: p.icon || '📋' }));
  }, [ws.projects, query]);

  const searchItems: Item[] = query
    ? results.map((r) => (r.kind === 'task'
      ? {
        kind: 'task' as const,
        id: r.id,
        title: r.title,
        sub: r.snippet || '',
        projectId: r.projectId ?? '',
        status: r.status ?? 'todo',
      }
      : {
        kind: 'page' as const,
        id: r.id,
        title: r.title,
        sub: (r.snippet || '').replace(/\s+/g, ' ').trim().slice(0, 60),
      }))
    : allPages.slice(0, 5);

  const cmdItems = commands.filter((c) => !query || c.title.toLowerCase().includes(query));

  const groups = [
    { label: 'Recent', items: recentItems },
    { label: query ? 'Search results' : 'Jump to', items: searchItems },
    { label: 'Databases', items: dbItems },
    { label: 'Actions', items: cmdItems },
  ].filter((g) => g.items.length > 0);

  const flat = groups.flatMap((g) => g.items);

  const choose = (it: Item) => {
    if (it.kind === 'page') ws.select(it.id);
    else if (it.kind === 'task') ws.openProject(it.projectId, it.id);
    else if (it.kind === 'database') ws.openProject(it.id);
    else it.run();
    ws.setPaletteOpen(false);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, flat.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (flat[active]) choose(flat[active]); }
  };

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const highlight = (title: string) => {
    if (!query) return title;
    const i = title.toLowerCase().indexOf(query);
    if (i < 0) return title;
    return (<>{title.slice(0, i)}<mark className="bg-transparent font-semibold text-accent-strong">{title.slice(i, i + query.length)}</mark>{title.slice(i + query.length)}</>);
  };

  let idx = -1;

  return (
    <Modal
      open={ws.paletteOpen}
      onOpenChange={ws.setPaletteOpen}
      onKeyDown={onKey}
      title="Command palette"
      bare
      placement="top"
      width={620}
    >
      <div className="flex shrink-0 items-center gap-2.5 border-b border-line px-4">
        <Search size={18} className="shrink-0 text-faint" />
        <input
          autoFocus
          value={q}
          onChange={(e) => { setQ(e.target.value); setActive(0); }}
          placeholder="Search pages, tasks (MD-14) or type a command…"
          className="h-[52px] flex-1 bg-transparent text-md text-ink outline-none placeholder:text-faint"
        />
        {busy && <Loader2 size={14} className="shrink-0 animate-spin text-faint" aria-label="Searching" />}
        <kbd className="rounded bg-hover px-1.5 py-0.5 text-2xs text-faint">Esc</kbd>
      </div>

      <div ref={listRef} className="scrollarea max-h-[52vh] overflow-y-auto p-2">
        {flat.length === 0 && (
          <div className="flex flex-col items-center gap-1.5 py-12 text-center">
            <Search size={20} className="text-faint" />
            <p className="text-sm text-muted">
              {busy ? 'Searching…' : query ? `No results for “${q}”` : 'Start typing to search'}
            </p>
          </div>
        )}
        {groups.map((g) => (
          <div key={g.label} className="mb-1.5">
            <p className="px-2 py-1 text-2xs font-semibold uppercase tracking-wide text-faint">{g.label}</p>
            {g.items.map((it) => {
              idx++;
              const myIdx = idx;
              const isActive = myIdx === active;
              const named = it.kind === 'task' ? splitKey(it.title) : null;
              return (
                <button
                  key={it.kind + it.id}
                  data-idx={myIdx}
                  onMouseMove={() => setActive(myIdx)}
                  onClick={() => choose(it)}
                  className={cn('flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left text-base transition-colors', isActive ? 'bg-hover' : 'hover:bg-hover')}
                >
                  {/* The glyph column is never empty: it is what says whether a
                      row is a page, a task, a database or a verb. */}
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center">
                    {it.kind === 'page' ? (
                      <span className="text-faint"><DocIcon hasChildren={(ws.pages[it.id]?.children.length ?? 0) > 0} size={16} className="" /></span>
                    ) : it.kind === 'task' ? (
                      <span className={cn('h-2 w-2 rounded-full', swatch(STATUS_COLOR[it.status] || 'gray').dot)} />
                    ) : it.kind === 'database' ? (
                      <span className="text-base leading-none">{it.icon}</span>
                    ) : (
                      <span className="text-muted"><it.icon size={16} /></span>
                    )}
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-ink">
                      {/* A key is the most quotable thing about a task, so it
                          leads — and it is drawn apart from the name rather
                          than left in the middle of the sentence it prefixes. */}
                      {named?.key && (
                        <span className="mr-1.5 font-mono text-2xs font-semibold tracking-tight text-muted">{named.key}</span>
                      )}
                      {named ? (named.text ? highlight(named.text) : <span className="text-faint">Untitled</span>) : highlight(it.title)}
                    </span>
                    {(it.kind === 'page' || it.kind === 'task') && it.sub && it.sub !== 'Recent' && (
                      <span className="truncate text-2xs text-faint">{it.sub}</span>
                    )}
                  </span>
                  <span className="ml-auto shrink-0">
                    {it.kind === 'page' && it.sub === 'Recent' ? <Clock size={14} className="text-faint" /> : null}
                    {it.kind === 'database' ? <Database size={14} className={cn('text-faint transition-opacity', isActive ? 'opacity-100' : 'opacity-0')} /> : null}
                    {it.kind === 'command' ? <ArrowRight size={14} className={cn('text-faint transition-opacity', isActive ? 'opacity-100' : 'opacity-0')} /> : null}
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </Modal>
  );
}
