import { useEffect, useRef, useState } from 'react';
import type { EditorMode } from '../lib/types';
import { cn } from '../lib/cn';
import { readRoute, revealBlock } from '../lib/route';
import { PageSkeleton } from '../components/ui/Skeleton';
import { mountEditor } from './mountEditor';
import type { LinkTarget } from './pageLinks';

export interface EditorProps {
  docId: string;
  title: string;
  mode: EditorMode;
  userName: string;
  share?: string;
  /** Render this archived Yjs state read-only instead of connecting to the live
   *  document (version history). Changing it remounts the editor. */
  snapshot?: Uint8Array;
  fullWidth?: boolean;
  onTitle?: (title: string) => void;
  onSaved?: () => void;
  /** Page index for "@" linking. Omit for public viewers. */
  pages?: () => LinkTarget[];
  createPage?: (title: string) => Promise<string | null>;
  onOpenDoc?: (docId: string) => void;
  /** Someone restored a version of this document — remount to render it. */
  onRemoteRewrite?: () => void;
  /** The mounted `affine-editor-container`, or null on unmount. Lets chrome
   *  outside the editor (the formatting bar) drive it through BlockSuite's
   *  command chain. */
  onEditor?: (el: Element | null) => void;
}

/**
 * React boundary around the imperative BlockSuite editor. Remounts per doc,
 * flips mode in place. Content persists + syncs via Hocuspocus inside mountEditor.
 */
export function BlockSuiteEditor({
  docId, title, mode, userName, share, snapshot, fullWidth,
  onTitle, onSaved, pages, createPage, onOpenDoc, onRemoteRewrite, onEditor,
}: EditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const instRef = useRef<Awaited<ReturnType<typeof mountEditor>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState<string | null>(null);
  // Keep the latest title/callback without forcing a remount on every keystroke.
  const titleRef = useRef(title);
  titleRef.current = title;
  const onTitleRef = useRef(onTitle);
  onTitleRef.current = onTitle;
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;
  // Same for the link callbacks: the page index changes on every refresh, and
  // remounting the editor for that would drop the user's cursor.
  const pagesRef = useRef(pages);
  pagesRef.current = pages;
  const createPageRef = useRef(createPage);
  createPageRef.current = createPage;
  const onOpenDocRef = useRef(onOpenDoc);
  onOpenDocRef.current = onOpenDoc;
  const onEditorRef = useRef(onEditor);
  onEditorRef.current = onEditor;
  const onRemoteRewriteRef = useRef(onRemoteRewrite);
  onRemoteRewriteRef.current = onRemoteRewrite;

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setFailed(null);
    const host = hostRef.current;
    if (!host) return;
    mountEditor(host, {
      docId,
      title: titleRef.current,
      mode: 'page',
      userName,
      share,
      snapshot,
      onTitle: (t) => onTitleRef.current?.(t),
      onSaved: () => onSavedRef.current?.(),
      pages: pagesRef.current ? () => pagesRef.current?.() ?? [] : undefined,
      createPage: createPageRef.current ? (t) => createPageRef.current!(t) : undefined,
      onOpenDoc: onOpenDocRef.current ? (id) => onOpenDocRef.current?.(id) : undefined,
      onRemoteRewrite: () => onRemoteRewriteRef.current?.(),
    })
      .then((inst) => {
        if (!alive) { inst.destroy(); return; }
        instRef.current = inst;
        // Slides ARE edgeless — the deck chrome lives outside the editor.
        inst.setMode(mode === 'page' ? 'page' : 'edgeless');
        setLoading(false);
        onEditorRef.current?.(inst.editor);
      })
      .catch((err) => {
        console.error('[BlockSuite] mount failed', err);
        // A blank page is the one thing this must never render: it reads as an
        // empty document, and someone will type into it.
        if (alive) { setLoading(false); setFailed(err instanceof Error ? err.message : 'This document could not be loaded.'); }
      });
    return () => {
      alive = false;
      onEditorRef.current?.(null);
      instRef.current?.destroy();
      instRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId, userName, share, snapshot]);

  useEffect(() => {
    instRef.current?.setMode(mode === 'page' ? 'page' : 'edgeless');
  }, [mode]);

  // Arrived on a block link (/d/<doc>#<block>). Kept out of the mount promise
  // so an unrelated failure in there can't quietly swallow it, and waits for
  // `loading` so there is something rendered to scroll to.
  //
  // The fragment is consumed rather than left in the address: it describes how
  // this page was opened, not where it is, and leaving it would re-scroll on
  // every remount.
  useEffect(() => {
    if (loading) return;
    const { docId: routedDoc, blockId } = readRoute();
    if (snapshot || !blockId || routedDoc !== docId) return;
    history.replaceState(history.state, '', location.pathname);
    return revealBlock(blockId, instRef.current?.editor ?? document);
  }, [loading, docId, snapshot]);

  const edgeless = mode !== 'page';
  return (
    <div className={cn(edgeless ? 'bs-fill relative h-full' : 'relative min-h-[70vh]', !edgeless && fullWidth && 'bs-fullwidth')}>
      {loading && (
        <div className="absolute inset-0 z-10 bg-canvas">
          <PageSkeleton />
        </div>
      )}
      {failed && (
        <div className="absolute inset-0 z-10 flex items-start justify-center bg-canvas pt-24">
          <div className="max-w-md rounded-lg border border-line bg-surface-2 p-5 text-center">
            <p className="text-base font-medium text-ink">{failed}</p>
            <p className="mt-1 text-sm text-muted">Nothing has been changed. Your content is safe on the server.</p>
            <button
              type="button"
              onClick={() => location.reload()}
              className="mt-4 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white transition-opacity duration-120 hover:opacity-90"
            >
              Try again
            </button>
          </div>
        </div>
      )}
      <div ref={hostRef} className={edgeless ? 'h-full' : ''} />
    </div>
  );
}
