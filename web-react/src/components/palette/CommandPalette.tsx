import * as Dialog from '@radix-ui/react-dialog';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowRight, Clock, FilePlus2, Moon, PanelRight, Search, Settings, Share2, Sparkles, Sun } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '../../lib/cn';
import { docsApi, type SearchRow } from '../../lib/docsApi';
import { useWorkspace } from '../../store/workspace';
import { DocIcon } from '../ui/DocIcon';

type Item =
  | { kind: 'page'; id: string; title: string; sub: string }
  | { kind: 'command'; id: string; title: string; icon: typeof Search; run: () => void };

export function CommandPalette() {
  const ws = useWorkspace();
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const [results, setResults] = useState<SearchRow[]>([]);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (ws.paletteOpen) { setQ(''); setActive(0); setResults([]); }
  }, [ws.paletteOpen]);

  // Debounced server-side full-text search.
  useEffect(() => {
    const query = q.trim();
    if (!query) { setResults([]); return; }
    let alive = true;
    const t = setTimeout(() => {
      docsApi.search(query).then((r) => alive && setResults(r)).catch(() => alive && setResults([]));
    }, 160);
    return () => { alive = false; clearTimeout(t); };
  }, [q]);

  const commands: Item[] = useMemo(() => [
    { kind: 'command', id: 'new', title: 'Create new page', icon: FilePlus2, run: () => ws.createPage(null) },
    { kind: 'command', id: 'share', title: 'Share current page', icon: Share2, run: () => ws.setShareOpen(true) },
    { kind: 'command', id: 'ai', title: 'Ask AI', icon: Sparkles, run: () => ws.setRightPanel('ai') },
    { kind: 'command', id: 'panel', title: 'Toggle side panel', icon: PanelRight, run: () => ws.setRightPanel(ws.rightPanel ? null : 'outline') },
    { kind: 'command', id: 'theme', title: ws.theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode', icon: ws.theme === 'dark' ? Sun : Moon, run: ws.toggleTheme },
    { kind: 'command', id: 'settings', title: 'Open settings', icon: Settings, run: () => ws.setSettingsOpen(true) },
  ], [ws]);

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

  const searchItems: Item[] = query
    ? results.map((r) => ({ kind: 'page' as const, id: r.id, title: r.title, sub: (r.snippet || '').replace(/\s+/g, ' ').trim().slice(0, 60) }))
    : allPages.slice(0, 5);

  const cmdItems = commands.filter((c) => !query || c.title.toLowerCase().includes(query));

  const groups = [
    { label: 'Recent', items: recentItems },
    { label: query ? 'Search results' : 'Jump to', items: searchItems },
    { label: 'Actions', items: cmdItems },
  ].filter((g) => g.items.length > 0);

  const flat = groups.flatMap((g) => g.items);

  const choose = (it: Item) => {
    if (it.kind === 'page') ws.select(it.id);
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
    return (<>{title.slice(0, i)}<mark className="bg-transparent font-semibold text-accent">{title.slice(i, i + query.length)}</mark>{title.slice(i + query.length)}</>);
  };

  let idx = -1;

  return (
    <Dialog.Root open={ws.paletteOpen} onOpenChange={ws.setPaletteOpen}>
      <AnimatePresence>
        {ws.paletteOpen && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild>
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }} className="fixed inset-0 z-50 bg-overlay backdrop-blur-[2px]" />
            </Dialog.Overlay>
            <Dialog.Content onKeyDown={onKey} aria-describedby={undefined} asChild>
              <div className="pointer-events-none fixed inset-0 z-50 flex items-start justify-center p-4 pt-[14vh]">
                <motion.div
                  initial={{ opacity: 0, scale: 0.98, y: -8 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.98, y: -8 }}
                  transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                  className="pointer-events-auto w-[min(92vw,620px)] overflow-hidden rounded-xl border border-line bg-canvas shadow-modal"
                >
                  <Dialog.Title className="sr-only">Command palette</Dialog.Title>
                  <div className="flex items-center gap-2.5 border-b border-line px-4">
                    <Search size={18} className="shrink-0 text-faint" />
                    <input
                      autoFocus
                      value={q}
                      onChange={(e) => { setQ(e.target.value); setActive(0); }}
                      placeholder="Search pages or type a command…"
                      className="h-[52px] flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-faint"
                    />
                    <kbd className="rounded bg-hover px-1.5 py-0.5 text-2xs text-faint">Esc</kbd>
                  </div>

                  <div ref={listRef} className="scrollarea max-h-[52vh] overflow-y-auto p-2">
                    {flat.length === 0 && (
                      <div className="flex flex-col items-center gap-1.5 py-12 text-center">
                        <Search size={20} className="text-faint" />
                        <p className="text-sm text-muted">{query ? `No results for “${q}”` : 'Start typing to search'}</p>
                      </div>
                    )}
                    {groups.map((g) => (
                      <div key={g.label} className="mb-1.5">
                        <p className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-faint">{g.label}</p>
                        {g.items.map((it) => {
                          idx++;
                          const myIdx = idx;
                          const isActive = myIdx === active;
                          return (
                            <button
                              key={it.kind + it.id}
                              data-idx={myIdx}
                              onMouseMove={() => setActive(myIdx)}
                              onClick={() => choose(it)}
                              className={cn('flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left text-[14px] transition-colors', isActive ? 'bg-hover' : 'hover:bg-hover/60')}
                            >
                              {it.kind === 'page' ? (
                                <span className="flex h-6 w-6 shrink-0 items-center justify-center text-faint"><DocIcon hasChildren={(ws.pages[it.id]?.children.length ?? 0) > 0} size={16} className="" /></span>
                              ) : (
                                <span className="flex h-6 w-6 shrink-0 items-center justify-center text-muted"><it.icon size={16} /></span>
                              )}
                              <span className="flex min-w-0 flex-col">
                                <span className="truncate text-ink">{highlight(it.title)}</span>
                                {it.kind === 'page' && it.sub && it.sub !== 'Recent' && (
                                  <span className="truncate text-2xs text-faint">{it.sub}</span>
                                )}
                              </span>
                              <span className="ml-auto shrink-0">
                                {it.kind === 'page' ? (
                                  it.sub === 'Recent' ? <Clock size={12} className="text-faint" /> : null
                                ) : (
                                  <ArrowRight size={14} className={cn('text-faint transition-opacity', isActive ? 'opacity-100' : 'opacity-0')} />
                                )}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                </motion.div>
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}
