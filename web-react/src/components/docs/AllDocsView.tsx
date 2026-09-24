/* Hallmark · component: every page in the workspace · genre: modern-minimal
 * theme: project tokens (index.css) + tag palette (lib/tagColors)
 * pre-emit critique: P5 H5 E4 S5 R5 V4
 * states: default · row hover · row focus · searching · no matches ·
 *         empty workspace · filtered to unfiled · sorted
 */
import { useMemo, useRef, useState } from 'react';
import { FileText, FolderOpen, MoreHorizontal, Search } from 'lucide-react';
import { cn } from '../../lib/cn';
import { folderChain } from '../../lib/folderPath';
import { swatch } from '../../lib/tagColors';
import { relativeTime } from '../../lib/time';
import { useDocMenu } from '../../hooks/useDocMenu';
import { useWorkspace } from '../../store/workspace';
import type { Page } from '../../lib/types';
import { EmptyState } from '../ui/EmptyState';
import { IconButton } from '../ui/IconButton';
import { Menu } from '../ui/Menu';
import { Pager, usePaged } from '../ui/Pager';
import { PageIcon } from '../ui/PageIcon';
import { SegmentedControl } from '../ui/SegmentedControl';

type Sort = 'updated' | 'title' | 'folder';

/** A task's page belongs to a database row and is reached through it; a
 *  hundred of them in this list would bury the documents people wrote. */
const listable = (p: Page) => p.kind !== 'task';

/**
 * Every page, in one list.
 *
 * The sidebar is a set of places — folders, favourites, a tree — and it only
 * draws a page once somebody has filed it somewhere. Which means the pages
 * most likely to be lost are exactly the ones it does not draw: made in a
 * hurry, never moved, still sitting at the top level under a title nobody
 * remembers. Search finds a page you can name. This is for the one you cannot.
 *
 * Reads the store rather than the server: `/api/docs` already returns every
 * page this account can open, and it is what the sidebar tree, the folder
 * pages and the "@" menu are all built from. A second endpoint would be a
 * second answer to the same question.
 */
export function AllDocsView() {
  const ws = useWorkspace();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<Sort>('updated');
  const [scope, setScope] = useState<'all' | 'unfiled'>('all');

  const total = useMemo(() => Object.values(ws.pages).filter(listable).length, [ws.pages]);
  const unfiled = useMemo(
    () => Object.values(ws.pages).filter((p) => listable(p) && !p.folderId && !p.parentId).length,
    [ws.pages],
  );

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = Object.values(ws.pages).filter((p) => {
      if (!listable(p)) return false;
      if (scope === 'unfiled' && (p.folderId || p.parentId)) return false;
      if (!q) return true;
      return (p.title || 'Untitled').toLowerCase().includes(q)
        || p.tags.some((t) => t.name.toLowerCase().includes(q));
    });
    const byTitle = (a: Page, b: Page) => (a.title || 'Untitled').localeCompare(b.title || 'Untitled');
    if (sort === 'title') return all.sort(byTitle);
    if (sort === 'folder') {
      return all.sort((a, b) => {
        const fa = a.folderId ? ws.folders[a.folderId]?.name ?? '' : '';
        const fb = b.folderId ? ws.folders[b.folderId]?.name ?? '' : '';
        // Unfiled last rather than first: this sort is for reading the
        // shelves, and the pile on the floor is not one of them.
        if (!fa !== !fb) return fa ? -1 : 1;
        return fa.localeCompare(fb) || byTitle(a, b);
      });
    }
    return all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [ws.pages, ws.folders, query, sort, scope]);

  const scroller = useRef<HTMLDivElement>(null);
  const paged = usePaged(rows, `${query}|${sort}|${scope}`);

  return (
    <div ref={scroller} className="scrollarea h-full overflow-y-auto bg-canvas">
      <div className="mx-auto max-w-[1100px] px-6 py-8 md:px-10">
        <header className="mb-5">
          <h1 className="font-display text-2xl font-semibold leading-7 tracking-[-0.03em] text-ink md:text-3xl">
            All documents
          </h1>
          <p className="mt-0.5 text-sm text-muted">
            {rows.length} of {total}
            {unfiled > 0 && <> · {unfiled} not filed anywhere</>}
          </p>
        </header>

        <div className="mb-4 flex flex-wrap items-center gap-2">
          <label className="relative min-w-[200px] flex-1">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter by name or tag…"
              aria-label="Filter documents"
              className="h-8 w-full rounded-md bg-surface pl-8 pr-2.5 text-sm text-ink outline-none ring-1 ring-inset ring-line placeholder:text-faint focus:ring-2 focus:ring-accent"
            />
          </label>
          <SegmentedControl
            aria-label="Which documents"
            value={scope}
            onChange={(v) => setScope(v as 'all' | 'unfiled')}
            segments={[{ value: 'all', label: 'All' }, { value: 'unfiled', label: 'Unfiled' }]}
          />
          <SegmentedControl
            aria-label="Sort"
            value={sort}
            onChange={(v) => setSort(v as Sort)}
            segments={[
              { value: 'updated', label: 'Recent' },
              { value: 'title', label: 'Name' },
              { value: 'folder', label: 'Folder' },
            ]}
          />
        </div>

        {rows.length === 0 ? (
          <EmptyState
            icon={FileText}
            title={query ? 'Nothing matches' : scope === 'unfiled' ? 'Everything is filed' : 'No documents yet'}
            hint={
              query ? 'Try a shorter word, or a tag.'
                : scope === 'unfiled' ? 'Every page lives in a folder or under another page.'
                : 'Create your first page to start writing.'
            }
          />
        ) : (
          <div className="rounded-lg border border-line">
            {paged.shown.map((p) => <DocRow key={p.id} page={p} />)}
          </div>
        )}

        <Pager paged={paged} onPage={() => scroller.current?.scrollTo({ top: 0 })} />
      </div>
    </div>
  );
}

function DocRow({ page }: { page: Page }) {
  const ws = useWorkspace();
  const menu = useDocMenu(page.id);
  const path = page.folderId
    ? folderChain(ws.folders, page.folderId).map((f) => f.name).join(' / ')
    : '';

  return (
    <div className="group/row relative flex items-center border-b border-line last:border-0">
      <button
        type="button"
        onClick={() => ws.select(page.id)}
        className="flex min-w-0 flex-1 items-center gap-2.5 px-3 py-2.5 pr-9 text-left transition-colors duration-120 hover:bg-hover"
      >
        <PageIcon icon={page.icon} size={16} />
        <span className="min-w-0 flex-1 truncate text-sm text-ink">{page.title || 'Untitled'}</span>
        {page.tags.slice(0, 3).map((t) => (
          <span key={t.id} className={cn('hidden shrink-0 rounded px-1.5 py-0.5 text-2xs sm:inline', swatch(t.color).chip)}>
            {t.name}
          </span>
        ))}
        <span className="hidden w-40 shrink-0 items-center gap-1 truncate text-2xs text-faint md:flex">
          {path
            ? <><FolderOpen size={12} className="shrink-0" /><span className="truncate">{path}</span></>
            : <span className="italic">Unfiled</span>}
        </span>
        <span className="w-20 shrink-0 text-right text-2xs tabular-nums text-faint">{relativeTime(page.updatedAt)}</span>
      </button>
      <span className="absolute right-1.5 opacity-0 transition-opacity duration-120 focus-within:opacity-100 group-hover/row:opacity-100">
        <Menu
          align="end"
          items={menu}
          trigger={<span><IconButton icon={<MoreHorizontal size={16} />} label={`Actions for ${page.title || 'Untitled'}`} /></span>}
        />
      </span>
    </div>
  );
}
