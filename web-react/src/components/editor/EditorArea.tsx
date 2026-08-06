import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { FileText, Plus } from 'lucide-react';
import { docsApi } from '../../lib/docsApi';
import { emitDocSaved } from '../../lib/docSignal';
import { useAuth } from '../../store/auth';
import { useWorkspace } from '../../store/workspace';
import { LazyEditor } from '../../editor/LazyEditor';
import { useIntelligence } from '../../hooks/useIntelligence';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/EmptyState';
import { Backlinks } from './Backlinks';
import { CommentMarkers } from './CommentMarkers';
import { EditorBar } from './EditorBar';
import { PageHeader } from './PageHeader';

export function EditorArea() {
  const ws = useWorkspace();
  const auth = useAuth();
  const page = ws.currentPage;

  // "@" linking. `pages` is read lazily on each keystroke so a page created a
  // moment ago is already offerable. Creating from the menu must not navigate,
  // so it goes straight to the API rather than through ws.createPage.
  const pagesRef = useRef(ws.pages);
  pagesRef.current = ws.pages;
  const linkTargets = useCallback(
    () => Object.values(pagesRef.current).map((p) => ({ id: p.id, title: p.title, icon: p.icon })),
    [],
  );
  const createLinkedPage = useCallback(
    async (title: string) => {
      const row = await docsApi.create({ title }).catch(() => null);
      if (row) ws.refresh();
      return row?.id ?? null;
    },
    [ws],
  );

  const [refreshKey, setRefreshKey] = useState(0);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Intelligence and backlinks both key off a save, but neither should refetch
  // on every keystroke — hold for two seconds after the editor goes quiet.
  const bumpSoon = () => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => { setRefreshKey((k) => k + 1); emitDocSaved(); }, 2000);
  };
  useEffect(() => () => { if (refreshTimer.current) clearTimeout(refreshTimer.current); }, []);

  // Tag suggestions live in the page header, so they are fetched here even
  // though the rest of the intelligence payload now renders in the right panel.
  const intel = useIntelligence(page?.id ?? null, refreshKey);

  // The formatting bar sits outside the editor but drives it, so it needs the
  // mounted element to reach BlockSuite's command chain. The same element is
  // the coordinate space the gutter markers measure against.
  const [editorEl, setEditorEl] = useState<Element | null>(null);
  const markerHost = editorEl as HTMLElement | null;

  if (!page) {
    return (
      <div className="flex h-full items-center justify-center bg-canvas">
        <EmptyState
          icon={FileText}
          title="No page open"
          hint="Create your first page to start writing."
          action={
            <Button variant="primary" leftIcon={<Plus size={16} />} onClick={() => ws.createPage(null)}>
              New page
            </Button>
          }
        />
      </div>
    );
  }

  const edgeless = ws.mode === 'edgeless';

  return (
    <div className="relative flex h-full flex-col bg-canvas">
      {/* Formatting + mode, one row. Hidden on phones, where the on-screen
          keyboard's own toolbar covers formatting and the row would eat a
          tenth of the viewport. */}
      <div className="hidden shrink-0 border-b border-line md:block">
        <EditorBar
          editor={editorEl}
          mode={ws.mode}
          onMode={(m) => ws.setMode(m)}
          fullWidth={ws.fullWidth}
          onFullWidth={ws.setFullWidth}
        />
      </div>

      <div className="relative min-h-0 flex-1">
        {edgeless ? (
          <div className="absolute inset-0">
            <LazyEditor
              key={page.id}
              docId={page.id}
              title={page.title}
              mode="edgeless"
              userName={auth.user?.name ?? 'You'}
              onTitle={(t) => ws.applyTitleFromEditor(page.id, t)}
              onSaved={bumpSoon}
              pages={linkTargets}
              createPage={createLinkedPage}
              onOpenDoc={(id) => ws.select(id)}
            />
          </div>
        ) : (
          <div className="absolute inset-0 flex">
            <div className="scrollarea flex-1 overflow-y-auto">
              <motion.div
                key={page.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              >
                <PageHeader page={page} fullWidth={ws.fullWidth} suggested={intel.data?.suggestedTags ?? []} />
                <div className="relative pb-40">
                  <CommentMarkers container={markerHost} fullWidth={ws.fullWidth} />
                  <LazyEditor
                    docId={page.id}
                    title={page.title}
                    mode="page"
                    userName={auth.user?.name ?? 'You'}
                    fullWidth={ws.fullWidth}
                    onTitle={(t) => ws.applyTitleFromEditor(page.id, t)}
                    onSaved={bumpSoon}
                    pages={linkTargets}
                    createPage={createLinkedPage}
                    onOpenDoc={(id) => ws.select(id)}
                    onEditor={setEditorEl}
                  />
                  <Backlinks docId={page.id} refreshKey={refreshKey} fullWidth={ws.fullWidth} onOpen={(id) => ws.select(id)} />
                </div>
              </motion.div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
