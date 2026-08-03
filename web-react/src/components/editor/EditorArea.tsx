import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { FileText, Maximize2, Minimize2, PencilRuler, Plus } from 'lucide-react';
import { useAuth } from '../../store/auth';
import { useWorkspace } from '../../store/workspace';
import { LazyEditor } from '../../editor/LazyEditor';
import { useIntelligence } from '../../hooks/useIntelligence';
import { IntelligenceRail } from '../intelligence/IntelligenceRail';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/EmptyState';
import { IconButton } from '../ui/IconButton';
import { SegmentedControl } from '../ui/SegmentedControl';
import { PageHeader } from './PageHeader';

export function EditorArea() {
  const ws = useWorkspace();
  const auth = useAuth();
  const page = ws.currentPage;

  const [refreshKey, setRefreshKey] = useState(0);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bumpSoon = () => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => setRefreshKey((k) => k + 1), 2000);
  };
  useEffect(() => () => { if (refreshTimer.current) clearTimeout(refreshTimer.current); }, []);

  // The rail is hidden below md, so skip fetching intelligence data for it there.
  const showRail = typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches;
  const intel = useIntelligence(showRail ? (page?.id ?? null) : null, refreshKey);

  if (!page) {
    return (
      <div className="flex h-full items-center justify-center bg-canvas">
        <EmptyState
          icon={FileText}
          title="No page open"
          hint="Create your first page to start writing."
          action={
            <Button variant="primary" leftIcon={<Plus size={15} />} onClick={() => ws.createPage(null)}>
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
      {/* Edgeless (canvas) needs a pointer and full-width is moot on a phone —
          hide this whole row on mobile. */}
      <div className="hidden h-9 shrink-0 items-center justify-between px-4 md:flex">
        <SegmentedControl
          aria-label="Editor mode"
          value={ws.mode}
          onChange={(m) => ws.setMode(m as 'page' | 'edgeless')}
          segments={[
            { value: 'page', label: 'Page', icon: <FileText size={14} /> },
            { value: 'edgeless', label: 'Edgeless', icon: <PencilRuler size={14} /> },
          ]}
        />
        {!edgeless && (
          <IconButton
            icon={ws.fullWidth ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            label={ws.fullWidth ? 'Narrow width' : 'Full width'}
            onClick={() => ws.setFullWidth(!ws.fullWidth)}
          />
        )}
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
                <div className="pb-40">
                  <LazyEditor
                    docId={page.id}
                    title={page.title}
                    mode="page"
                    userName={auth.user?.name ?? 'You'}
                    fullWidth={ws.fullWidth}
                    onTitle={(t) => ws.applyTitleFromEditor(page.id, t)}
                    onSaved={bumpSoon}
                  />
                </div>
              </motion.div>
            </div>
            <div className="hidden shrink-0 md:block">
              <IntelligenceRail data={intel.data} loading={intel.loading} error={intel.error} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
