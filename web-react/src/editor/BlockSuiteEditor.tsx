import { useEffect, useRef, useState } from 'react';
import type { EditorMode } from '../lib/types';
import { cn } from '../lib/cn';
import { PageSkeleton } from '../components/ui/Skeleton';
import { mountEditor } from './mountEditor';
import type { LinkTarget } from './pageLinks';

export interface EditorProps {
  docId: string;
  title: string;
  mode: EditorMode;
  userName: string;
  share?: string;
  fullWidth?: boolean;
  onTitle?: (title: string) => void;
  onSaved?: () => void;
  /** Page index for "@" linking. Omit for public viewers. */
  pages?: () => LinkTarget[];
  createPage?: (title: string) => Promise<string | null>;
  onOpenDoc?: (docId: string) => void;
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
  docId, title, mode, userName, share, fullWidth,
  onTitle, onSaved, pages, createPage, onOpenDoc, onEditor,
}: EditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const instRef = useRef<Awaited<ReturnType<typeof mountEditor>> | null>(null);
  const [loading, setLoading] = useState(true);
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

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const host = hostRef.current;
    if (!host) return;
    mountEditor(host, {
      docId,
      title: titleRef.current,
      mode: 'page',
      userName,
      share,
      onTitle: (t) => onTitleRef.current?.(t),
      onSaved: () => onSavedRef.current?.(),
      pages: pagesRef.current ? () => pagesRef.current?.() ?? [] : undefined,
      createPage: createPageRef.current ? (t) => createPageRef.current!(t) : undefined,
      onOpenDoc: onOpenDocRef.current ? (id) => onOpenDocRef.current?.(id) : undefined,
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
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
      onEditorRef.current?.(null);
      instRef.current?.destroy();
      instRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId, userName, share]);

  useEffect(() => {
    instRef.current?.setMode(mode === 'page' ? 'page' : 'edgeless');
  }, [mode]);

  const edgeless = mode !== 'page';
  return (
    <div className={cn(edgeless ? 'bs-fill relative h-full' : 'relative min-h-[70vh]', !edgeless && fullWidth && 'bs-fullwidth')}>
      {loading && (
        <div className="absolute inset-0 z-10 bg-canvas">
          <PageSkeleton />
        </div>
      )}
      <div ref={hostRef} className={edgeless ? 'h-full' : ''} />
    </div>
  );
}
