import { useEffect, useRef, useState } from 'react';
import type { EditorMode } from '../lib/types';
import { cn } from '../lib/cn';
import { PageSkeleton } from '../components/ui/Skeleton';
import { mountEditor } from './mountEditor';

export interface EditorProps {
  docId: string;
  title: string;
  mode: EditorMode;
  userName: string;
  share?: string;
  fullWidth?: boolean;
  onTitle?: (title: string) => void;
  onSaved?: () => void;
}

/**
 * React boundary around the imperative BlockSuite editor. Remounts per doc,
 * flips mode in place. Content persists + syncs via Hocuspocus inside mountEditor.
 */
export function BlockSuiteEditor({ docId, title, mode, userName, share, fullWidth, onTitle, onSaved }: EditorProps) {
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
    })
      .then((inst) => {
        if (!alive) { inst.destroy(); return; }
        instRef.current = inst;
        inst.setMode(mode);
        setLoading(false);
      })
      .catch((err) => {
        console.error('[BlockSuite] mount failed', err);
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
      instRef.current?.destroy();
      instRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId, userName, share]);

  useEffect(() => {
    instRef.current?.setMode(mode);
  }, [mode]);

  const edgeless = mode === 'edgeless';
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
