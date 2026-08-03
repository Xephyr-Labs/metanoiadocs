import * as Dialog from '@radix-ui/react-dialog';
import { AnimatePresence, motion } from 'framer-motion';
import { Loader2, RotateCcw, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { docsApi } from '../../lib/docsApi';
import { relativeTime } from '../../lib/time';
import { useWorkspace } from '../../store/workspace';
import { DocIcon } from '../ui/DocIcon';
import { EmptyState } from '../ui/EmptyState';
import { IconButton } from '../ui/IconButton';

interface TrashDoc {
  id: string;
  title: string;
  icon: string;
  deleted_at: string;
}

export function TrashDialog() {
  const ws = useWorkspace();
  const [items, setItems] = useState<TrashDoc[] | null>(null);
  const [restoring, setRestoring] = useState<string | null>(null);

  useEffect(() => {
    if (!ws.trashOpen) return;
    setItems(null);
    docsApi.trash().then(setItems).catch(() => setItems([]));
  }, [ws.trashOpen]);

  const restore = async (id: string) => {
    setRestoring(id);
    await ws.restorePage(id);
    setItems((cur) => (cur ? cur.filter((d) => d.id !== id) : cur));
    setRestoring(null);
    ws.setTrashOpen(false);
  };

  return (
    <Dialog.Root open={ws.trashOpen} onOpenChange={ws.setTrashOpen}>
      <AnimatePresence>
        {ws.trashOpen && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild>
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }} className="fixed inset-0 z-50 bg-overlay backdrop-blur-[2px]" />
            </Dialog.Overlay>
            <Dialog.Content asChild aria-describedby={undefined}>
              <div onClick={(e) => e.target === e.currentTarget && ws.setTrashOpen(false)} className="fixed inset-0 z-50 flex items-center justify-center p-4">
                <motion.div
                  initial={{ opacity: 0, scale: 0.97, y: 6 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.97, y: 6 }}
                  transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                  className="pointer-events-auto flex max-h-[70vh] w-[min(92vw,480px)] flex-col overflow-hidden rounded-xl border border-line bg-canvas shadow-modal"
                >
                  <div className="flex items-center justify-between border-b border-line px-4 py-3">
                    <Dialog.Title className="flex items-center gap-2 text-[15px] font-semibold text-ink">
                      <Trash2 size={16} className="text-muted" /> Trash
                    </Dialog.Title>
                    <IconButton icon={<X size={16} />} label="Close" onClick={() => ws.setTrashOpen(false)} />
                  </div>
                  <div className="scrollarea min-h-0 flex-1 overflow-y-auto p-2">
                    {items === null ? (
                      <div className="flex justify-center py-10"><Loader2 size={18} className="animate-spin text-faint" /></div>
                    ) : items.length === 0 ? (
                      <EmptyState icon={Trash2} title="Trash is empty" hint="Deleted pages show up here and can be restored." />
                    ) : (
                      items.map((d) => (
                        <div key={d.id} className="flex items-center gap-2.5 rounded-md px-2 py-2 hover:bg-hover">
                          <DocIcon size={16} />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[13px] font-medium text-ink">{d.title || 'Untitled'}</p>
                            <p className="truncate text-2xs text-faint">Deleted {relativeTime(d.deleted_at)}</p>
                          </div>
                          <button
                            onClick={() => restore(d.id)}
                            disabled={restoring === d.id}
                            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[12.5px] font-medium text-muted transition-colors hover:bg-line-strong/40 hover:text-ink"
                          >
                            {restoring === d.id ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />} Restore
                          </button>
                        </div>
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
