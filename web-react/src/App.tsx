import { AnimatePresence, motion } from 'framer-motion';
import { useEffect } from 'react';
import { CommandPalette } from './components/palette/CommandPalette';
import { EditorArea } from './components/editor/EditorArea';
import { RightPanel } from './components/panel/RightPanel';
import { SettingsDialog } from './components/settings/SettingsDialog';
import { ShareDialog } from './components/share/ShareDialog';
import { TrashDialog } from './components/trash/TrashDialog';
import { InboxDialog } from './components/inbox/InboxDialog';
import { TagView } from './components/tags/TagView';
import { Sidebar } from './components/sidebar/Sidebar';
import { TopBar } from './components/topbar/TopBar';
import { TooltipProvider } from './components/ui/Tooltip';
import { useGlobalHotkeys } from './hooks/useGlobalHotkeys';
import { useMediaQuery } from './hooks/useMediaQuery';
import { useWorkspace } from './store/workspace';

export default function App() {
  useGlobalHotkeys();
  const ws = useWorkspace();
  const isMobile = useMediaQuery('(max-width: 767px)');

  // Collapse the sidebar into a drawer on small screens automatically.
  useEffect(() => {
    if (isMobile) ws.setSidebarCollapsed(true);
  }, [isMobile]); // eslint-disable-line react-hooks/exhaustive-deps

  const showInlineSidebar = !isMobile && !ws.sidebarCollapsed;

  return (
    <TooltipProvider delayDuration={280} skipDelayDuration={200}>
      <div className="flex h-screen w-screen overflow-hidden bg-canvas text-ink">
        {/* inline sidebar (desktop) */}
        <AnimatePresence initial={false}>
          {showInlineSidebar && (
            <motion.div
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: ws.sidebarWidth, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              className="h-full shrink-0 overflow-hidden"
            >
              <Sidebar />
            </motion.div>
          )}
        </AnimatePresence>

        {/* main column */}
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar />
          <main className="min-h-0 flex-1">
            <EditorArea />
          </main>
        </div>

        <RightPanel />

        {/* mobile drawer */}
        <AnimatePresence>
          {isMobile && ws.mobileDrawerOpen && (
            <>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => ws.setMobileDrawer(false)}
                className="fixed inset-0 z-40 bg-overlay backdrop-blur-[1px]"
              />
              <motion.div
                initial={{ x: '-100%' }}
                animate={{ x: 0 }}
                exit={{ x: '-100%' }}
                transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
                className="fixed left-0 top-0 z-50 h-full w-[280px] shadow-modal"
              >
                <Sidebar />
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </div>

      <CommandPalette />
      <ShareDialog />
      <SettingsDialog />
      <TrashDialog />
      <InboxDialog />
      <TagView />
    </TooltipProvider>
  );
}
