import * as Dialog from '@radix-ui/react-dialog';
import { AnimatePresence, motion } from 'framer-motion';
import { Tag as TagIcon, X } from 'lucide-react';
import { swatch } from '../../lib/tagColors';
import { relativeTime } from '../../lib/time';
import { useWorkspace } from '../../store/workspace';
import { DocIcon } from '../ui/DocIcon';
import { EmptyState } from '../ui/EmptyState';
import { IconButton } from '../ui/IconButton';

/** Docs carrying the currently-filtered tag. Opened from the sidebar Tags list. */
export function TagView() {
  const ws = useWorkspace();
  const open = ws.tagFilter !== null;
  const tag = ws.allTags.find((t) => t.id === ws.tagFilter);
  const docs = Object.values(ws.pages)
    .filter((p) => p.tags.some((t) => t.id === ws.tagFilter))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  const pick = (id: string) => {
    ws.select(id);
    ws.setTagFilter(null);
  };

  return (
    <Dialog.Root open={open} onOpenChange={(v) => !v && ws.setTagFilter(null)}>
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild>
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }} className="fixed inset-0 z-50 bg-overlay backdrop-blur-[2px]" />
            </Dialog.Overlay>
            <Dialog.Content asChild aria-describedby={undefined}>
              <div className="pointer-events-none fixed inset-0 z-50 flex items-start justify-center p-4 pt-[12vh]">
                <motion.div
                  initial={{ opacity: 0, scale: 0.98, y: -6 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.98, y: -6 }}
                  transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                  className="pointer-events-auto flex max-h-[70vh] w-[min(92vw,460px)] flex-col overflow-hidden rounded-xl border border-line bg-canvas shadow-modal"
                >
                  <div className="flex items-center justify-between border-b border-line px-4 py-3">
                    <Dialog.Title className="flex items-center gap-2 text-[15px] font-semibold text-ink">
                      {tag ? <span className={`h-3 w-3 rounded-full ${swatch(tag.color).dot}`} /> : <TagIcon size={16} className="text-muted" />}
                      {tag?.name ?? 'Tag'}
                      <span className="text-[13px] font-normal text-faint">{docs.length}</span>
                    </Dialog.Title>
                    <IconButton icon={<X size={16} />} label="Close" onClick={() => ws.setTagFilter(null)} />
                  </div>
                  <div className="scrollarea min-h-0 flex-1 overflow-y-auto p-2">
                    {docs.length === 0 ? (
                      <EmptyState icon={TagIcon} title="No pages" hint="No pages carry this tag yet." />
                    ) : (
                      docs.map((p) => (
                        <button key={p.id} onClick={() => pick(p.id)} className="flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left transition-colors hover:bg-hover">
                          <DocIcon hasChildren={p.children.length > 0} size={16} />
                          <span className="min-w-0 flex-1 truncate text-[13.5px] text-ink">{p.title || 'Untitled'}</span>
                          <span className="shrink-0 text-2xs text-faint">{relativeTime(p.updatedAt)}</span>
                        </button>
                      ))
                    )}
                  </div>
                </motion.div>
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}
