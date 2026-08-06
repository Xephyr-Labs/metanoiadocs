import { Loader2, RotateCcw, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { docsApi } from '../../lib/docsApi';
import { relativeTime } from '../../lib/time';
import { useWorkspace } from '../../store/workspace';
import { DocIcon } from '../ui/DocIcon';
import { EmptyState } from '../ui/EmptyState';
import { Modal, ModalBody } from '../ui/Modal';

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
    <Modal
      open={ws.trashOpen}
      onOpenChange={ws.setTrashOpen}
      width={480}
      className="max-h-[70vh]"
      title={<><Trash2 size={16} className="text-muted" /> Trash</>}
    >
      <ModalBody>
        {items === null ? (
          <div className="flex justify-center py-10"><Loader2 size={18} className="animate-spin text-faint" /></div>
        ) : items.length === 0 ? (
          <EmptyState icon={Trash2} title="Trash is empty" hint="Deleted pages show up here and can be restored." />
        ) : (
          items.map((d) => (
            <div key={d.id} className="flex items-center gap-2.5 rounded-md px-2 py-2 hover:bg-hover">
              <DocIcon size={16} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink">{d.title || 'Untitled'}</p>
                <p className="truncate text-2xs text-faint">Deleted {relativeTime(d.deleted_at)}</p>
              </div>
              <button
                onClick={() => restore(d.id)}
                disabled={restoring === d.id}
                className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-muted transition-colors hover:bg-selected hover:text-ink"
              >
                {restoring === d.id ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />} Restore
              </button>
            </div>
          ))
        )}
      </ModalBody>
    </Modal>
  );
}
