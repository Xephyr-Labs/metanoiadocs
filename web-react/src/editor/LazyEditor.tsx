import { lazy, Suspense, useEffect } from 'react';
import { PageSkeleton } from '../components/ui/Skeleton';
import type { EditorProps } from './BlockSuiteEditor';

// BlockSuite is by far the heaviest dependency. Loading it in a lazy chunk keeps
// it out of the initial bundle — the app shell (login, sidebar, dialogs) paints
// fast, and the editor's ~MBs stream in only when a doc is first opened.
const load = () => import('./BlockSuiteEditor');
const BlockSuiteEditor = lazy(() => load().then((m) => ({ default: m.BlockSuiteEditor })));

/**
 * Fetch the editor chunk while the browser is idle, so the first document open
 * is a mount rather than a download. Anyone who signs in is going to open a
 * page; making them wait for 1.6 MB at the moment they click is the difference
 * between "instant" and "sluggish", and the shell has nothing else to do by
 * then. Idempotent — the module cache serves every later call.
 */
export function usePrefetchEditor() {
  useEffect(() => {
    // requestIdleCallback is missing on older Safari; a timeout is the same
    // promise with worse timing.
    const idle = 'requestIdleCallback' in window;
    const handle = idle
      ? window.requestIdleCallback(() => { void load(); }, { timeout: 4000 })
      : window.setTimeout(() => { void load(); }, 1500);
    return () => {
      if (idle) window.cancelIdleCallback(handle as number);
      else window.clearTimeout(handle as number);
    };
  }, []);
}

export function LazyEditor(props: EditorProps) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <BlockSuiteEditor {...props} />
    </Suspense>
  );
}
