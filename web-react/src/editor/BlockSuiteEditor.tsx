import { useEffect, useRef, useState } from 'react';
import type { EditorMode } from '../lib/types';
import { cn } from '../lib/cn';
import { readRoute, revealBlock } from '../lib/route';
import { PageSkeleton } from '../components/ui/Skeleton';
import { mountEditor } from './mountEditor';
import { keepGrammarlyOut } from './noGrammarly';
import type { CommentRows } from './comments';
import type { LinkTarget } from './pageLinks';

export interface EditorProps {
  docId: string;
  title: string;
  mode: EditorMode;
  userName: string;
  share?: string;
  /** A public link that allows comments: loads the page's threads for the
   *  comment layer. Read once, at mount — the link's setting cannot change
   *  under an open page without a reload. */
  guestComments?: () => Promise<CommentRows>;
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
  /** The viewer's role on the page; below editor opens it read-only. */
  role?: string;
  /** Suggesting mode: edit this draft (its sync name) instead of the page. */
  draft?: string;
}

/**
 * React boundary around the imperative BlockSuite editor. Remounts per doc,
 * flips mode in place. Content persists + syncs via Hocuspocus inside mountEditor.
 */
export function BlockSuiteEditor({
  docId, title, mode, userName, share, guestComments, snapshot, fullWidth,
  onTitle, onSaved, pages, createPage, onOpenDoc, onRemoteRewrite, onEditor, role, draft,
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
    // Before the first block renders, so no editable is ever briefly unmarked.
    const releaseGrammarly = keepGrammarlyOut(host);
    mountEditor(host, {
      docId,
      title: titleRef.current,
      mode: 'page',
      userName,
      share,
      guestComments,
      snapshot,
      role,
      draft,
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
      releaseGrammarly();
      onEditorRef.current?.(null);
      instRef.current?.destroy();
      instRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId, userName, share, snapshot, role, draft]);

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
  //
  // Also on `hashchange`: a block link to the page that is already open (pasted
  // into this tab's address bar, or clicked inside the document) changes only
  // the fragment, which never remounts anything — so the effect alone left the
  // reader exactly where they were and the link looked broken.
  useEffect(() => {
    if (loading || snapshot || draft) return;
    let cancel: (() => void) | undefined;
    const reveal = () => {
      const { docId: routedDoc, blockId } = readRoute();
      if (!blockId || routedDoc !== docId) return;
      history.replaceState(history.state, '', location.pathname);
      cancel?.();
      cancel = revealBlock(blockId, instRef.current?.editor ?? document);
    };
    reveal();
    window.addEventListener('hashchange', reveal);
    return () => {
      window.removeEventListener('hashchange', reveal);
      cancel?.();
    };
  }, [loading, docId, snapshot, draft]);

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
