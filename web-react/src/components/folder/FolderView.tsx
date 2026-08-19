/* Hallmark · component: folder page · genre: modern-minimal
 * theme: project tokens (index.css) · states: default · hover · focus-visible ·
 * active · disabled (n/a) · loading (workspace boot) · error (folder gone) ·
 * success (link copied) · empty (nothing filed here yet)
 */
import { motion } from 'framer-motion';
import { AlertCircle, Check, ChevronRight, Folder, FolderOpen, FolderPlus, Link2, Plus, Upload } from 'lucide-react';
import { useEffect, useState } from 'react';
import { folderChain } from '../../lib/folderPath';
import { folderTint } from '../../lib/tagColors';
import { pickMarkdownFiles } from '../../lib/docFiles';
import { folderUrl } from '../../lib/route';
import { copyText } from '../../lib/clipboard';
import { relativeTime } from '../../lib/time';
import { cn } from '../../lib/cn';
import { useWorkspace } from '../../store/workspace';
import { Button } from '../ui/Button';
import { DocIcon } from '../ui/DocIcon';
import { EmptyState } from '../ui/EmptyState';

/** "4 folders · 12 pages", with the halves that are zero left out entirely. */
function countLine(folders: number, pages: number): string {
  const parts: string[] = [];
  if (folders) parts.push(`${folders} ${folders === 1 ? 'folder' : 'folders'}`);
  if (pages) parts.push(`${pages} ${pages === 1 ? 'page' : 'pages'}`);
  return parts.join(' · ') || 'Empty';
}

function Row({ icon, name, meta, onOpen }: { icon: React.ReactNode; name: string; meta: string; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left transition-colors duration-120 hover:bg-hover"
    >
      {icon}
      <span className="min-w-0 flex-1 truncate text-base text-ink">{name}</span>
      <span className="shrink-0 text-2xs text-faint">{meta}</span>
      <ChevronRight size={14} className="shrink-0 text-faint opacity-0 transition-opacity duration-120 group-hover:opacity-100" />
    </button>
  );
}

/**
 * What a folder link opens.
 *
 * Everything here is already in the workspace store — folders are workspace-wide
 * and the document list is loaded once — so this view costs no request of its
 * own. It exists so a copied folder link lands somewhere a reader can act on,
 * rather than merely scrolling the sidebar.
 */
export function FolderView() {
  const ws = useWorkspace();
  const id = ws.activeFolderId;
  const folder = id ? ws.folders[id] : null;
  const [copied, setCopied] = useState<'yes' | 'failed' | null>(null);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(null), 2200);
    return () => clearTimeout(t);
  }, [copied]);

  // The store is still loading, or the folder was deleted in another tab. Both
  // are honest states — an empty page pretending to be the folder is not.
  if (!folder) {
    return (
      <div className="flex h-full items-center justify-center bg-canvas">
        <EmptyState
          icon={Folder}
          title={ws.loading ? 'Loading…' : 'This folder is gone'}
          hint={ws.loading ? undefined : 'It may have been deleted, or the link points somewhere else.'}
          action={ws.loading ? undefined : <Button onClick={ws.openHome}>Go home</Button>}
        />
      </div>
    );
  }

  const chain = folderChain(ws.folders, folder.id);
  const subfolders = folder.children.map((cid) => ws.folders[cid]).filter(Boolean);
  const pages = folder.documentIds.map((pid) => ws.pages[pid]).filter(Boolean);

  // A browser can refuse the clipboard (permission, or a non-secure origin);
  // `copyText` falls back to the legacy path first and reports what happened.
  const copyLink = async () => {
    setCopied((await copyText(folderUrl(folder.id))) ? 'yes' : 'failed');
  };

  return (
    <div className="scrollarea h-full overflow-y-auto bg-canvas">
      <motion.div
        key={folder.id}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
        className="mx-auto w-full max-w-[var(--reading-w)] px-6 pb-24 pt-9"
      >
        {chain.length > 1 && (
          <nav aria-label="Breadcrumb" className="mb-2 flex flex-wrap items-center gap-0.5 text-2xs text-faint">
            {chain.slice(0, -1).map((f) => (
              <span key={f.id} className="flex items-center gap-0.5">
                <button
                  type="button"
                  onClick={() => ws.openFolder(f.id)}
                  className="rounded px-1 py-0.5 transition-colors duration-120 hover:bg-hover hover:text-ink"
                >
                  {f.name}
                </button>
                <ChevronRight size={12} className="shrink-0" />
              </span>
            ))}
          </nav>
        )}

        <div className="flex items-start gap-3">
          <FolderOpen size={28} className={cn('mt-1 shrink-0', folderTint(folder.color))} />
          <div className="min-w-0 flex-1">
            <h1 className="truncate font-display text-4xl font-semibold text-ink">{folder.name}</h1>
            <p className="mt-0.5 text-sm text-muted">{countLine(subfolders.length, pages.length)}</p>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-1.5">
          <Button variant="primary" size="sm" leftIcon={<Plus size={14} />} onClick={() => ws.createPage(folder.id)}>
            New page
          </Button>
          <Button size="sm" leftIcon={<FolderPlus size={14} />} onClick={() => ws.createFolder(folder.id)}>
            New subfolder
          </Button>
          <Button
            size="sm"
            leftIcon={<Upload size={14} />}
            onClick={() => { pickMarkdownFiles().then((f) => { if (f.length) ws.importMarkdown(f, folder.id); }); }}
          >
            Import
          </Button>
          {/* The whole point of the page: a link a teammate can open. */}
          <Button
            size="sm"
            onClick={copyLink}
            leftIcon={
              copied === 'yes' ? <Check size={14} className="text-accent" />
              : copied === 'failed' ? <AlertCircle size={14} className="text-danger" />
              : <Link2 size={14} />
            }
          >
            {copied === 'yes' ? 'Link copied' : copied === 'failed' ? 'Copy failed' : 'Copy link'}
          </Button>
        </div>

        <div className="mt-7 space-y-px border-t border-line pt-3">
          {subfolders.length === 0 && pages.length === 0 ? (
            <EmptyState
              icon={Folder}
              title="Nothing filed here yet"
              hint="Add a page, or drag one into this folder in the sidebar."
              action={
                <Button variant="primary" leftIcon={<Plus size={16} />} onClick={() => ws.createPage(folder.id)}>
                  New page
                </Button>
              }
            />
          ) : (
            <>
              {subfolders.map((f) => (
                <Row
                  key={f.id}
                  icon={<Folder size={16} className={cn('shrink-0', folderTint(f.color))} />}
                  name={f.name}
                  meta={countLine(f.children.length, f.documentIds.length)}
                  onOpen={() => ws.openFolder(f.id)}
                />
              ))}
              {pages.map((p) => (
                <Row
                  key={p.id}
                  icon={<DocIcon hasChildren={p.children.length > 0} size={16} />}
                  name={p.title || 'Untitled'}
                  meta={relativeTime(p.updatedAt)}
                  onOpen={() => ws.select(p.id)}
                />
              ))}
            </>
          )}
        </div>
      </motion.div>
    </div>
  );
}
