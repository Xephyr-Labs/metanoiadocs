import { lazy, Suspense } from 'react';
import { PageSkeleton } from '../components/ui/Skeleton';
import type { EditorProps } from './BlockSuiteEditor';

// BlockSuite is by far the heaviest dependency. Loading it in a lazy chunk keeps
// it out of the initial bundle — the app shell (login, sidebar, dialogs) paints
// fast, and the editor's ~MBs stream in only when a doc is first opened.
const BlockSuiteEditor = lazy(() =>
  import('./BlockSuiteEditor').then((m) => ({ default: m.BlockSuiteEditor })),
);

export function LazyEditor(props: EditorProps) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <BlockSuiteEditor {...props} />
    </Suspense>
  );
}
