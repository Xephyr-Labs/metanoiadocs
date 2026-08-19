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
import { FloatingToc } from './FloatingToc';
import { PageHeader } from './PageHeader';
import { SlidesRail } from './SlidesRail';

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

  // Bumped when the server says this document was restored: BlockSuite builds
  // its block models at mount, so a wholesale rewrite of the document needs the
  // editor rebuilt — the Yjs state has already converged underneath it.
  const [rewriteKey, setRewriteKey] = useState(0);
  const onRestored = useCallback(() => { setRewriteKey((k) => k + 1); ws.refresh(); }, [ws]);

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

  // A design IS the canvas — there is no page view of one, so the stored mode
  // does not apply to it and cannot drift out of step with what is rendered.
  const mode = page.kind === 'design' && ws.mode === 'page' ? 'edgeless' : ws.mode;
  // Slides render the same canvas as edgeless, with the deck rail beside it.
  const canvas = mode !== 'page';
  const slides = mode === 'slides';

  return (
    <div className="relative flex h-full flex-col bg-canvas">
      {/* Formatting + mode, one row. Hidden on phones, where the on-screen
          keyboard's own toolbar covers formatting and the row would eat a
          tenth of the viewport. */}
      <div className="hidden shrink-0 border-b border-line md:block">
        <EditorBar
          editor={editorEl}
          mode={mode}
          design={page.kind === 'design'}
          onMode={(m) => ws.setMode(m)}
          fullWidth={ws.fullWidth}
          onFullWidth={ws.setFullWidth}
        />
      </div>

      <div className="relative min-h-0 flex-1">
        {canvas ? (
          <div className="absolute inset-0 flex">
            {slides && <SlidesRail editor={editorEl} />}
            {/* The pane the deck goes fullscreen with — everything outside it
                (sidebar, rail, top bar) is excluded while presenting. */}
            <div data-slides-pane className="relative min-w-0 flex-1 bg-canvas">
            <LazyEditor
              key={`${page.id}:${rewriteKey}`}
              docId={page.id}
              title={page.title}
              mode={mode}
              userName={auth.user?.name ?? 'You'}
              onTitle={(t) => ws.applyTitleFromEditor(page.id, t)}
              onSaved={bumpSoon}
              pages={linkTargets}
              createPage={createLinkedPage}
              onOpenDoc={(id) => ws.select(id)}
              onRemoteRewrite={onRestored}
              // The deck rail drives this editor (add/focus/present), so it
              // needs the mounted element here too, not only in page mode.
              onEditor={setEditorEl}
            />
            </div>
          </div>
        ) : (
          <div className="absolute inset-0 flex">
            {/* Outside the scroll area on purpose: the ToC stays put while the
                document moves under it. */}
            <FloatingToc editor={editorEl} />
            <div className="scrollarea flex-1 overflow-y-auto">
              <motion.div
                key={page.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              >
                <PageHeader page={page} fullWidth={ws.fullWidth} suggested={intel.data?.suggestedTags ?? []} />
                <div className="relative pb-40">
                  <LazyEditor
                    key={`${page.id}:${rewriteKey}`}
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
                    onRemoteRewrite={onRestored}
                    onEditor={setEditorEl}
                  />
                  {/* After the editor in DOM order: the layer is absolutely
                      positioned either way, and rendering it first put every
                      comment pip ahead of the document in the tab order. */}
                  <CommentMarkers container={markerHost} fullWidth={ws.fullWidth} />
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
