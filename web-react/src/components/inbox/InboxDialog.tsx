import { Inbox, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { docsApi, type InboxRow } from '../../lib/docsApi';
import { avatarFor } from '../../lib/avatar';
import { relativeTime } from '../../lib/time';
import { useWorkspace } from '../../store/workspace';
import { EmptyState } from '../ui/EmptyState';
import { Modal, ModalBody } from '../ui/Modal';

export function InboxDialog() {
  const ws = useWorkspace();
  const [items, setItems] = useState<InboxRow[] | null>(null);

  useEffect(() => {
    if (!ws.inboxOpen) return;
    setItems(null);
    // Load the feed (its read_at snapshot drives the unread dots), then mark
    // everything read so the sidebar badge clears.
    docsApi.inbox().then((rows) => { setItems(rows); ws.markInboxRead(); }).catch(() => setItems([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws.inboxOpen]);

  const open = (docId: string) => {
    ws.select(docId);
    ws.setInboxOpen(false);
    ws.setRightPanel('comments');
  };

  return (
    <Modal
      open={ws.inboxOpen}
      onOpenChange={ws.setInboxOpen}
      placement="top"
      className="max-h-[70vh]"
      title={<><Inbox size={16} className="text-muted" /> Inbox</>}
    >
      <ModalBody>
        {items === null ? (
          <div className="flex justify-center py-10"><Loader2 size={18} className="animate-spin text-faint" /></div>
        ) : items.length === 0 ? (
          <EmptyState icon={Inbox} title="You're all caught up" hint="@-mentions and comments on your pages show up here." />
        ) : (
          items.map((it) => {
            const a = avatarFor(it.actor_name);
            const unread = !it.read_at;
            return (
              <button key={it.id} onClick={() => open(it.doc_id)} className="flex w-full items-start gap-2.5 rounded-md px-2 py-2.5 text-left transition-colors hover:bg-hover">
                <span className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-2xs font-semibold text-white" style={{ background: a.color }}>
                  {a.initials}
                  {unread && <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-canvas bg-accent" />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm leading-snug text-ink">
                    <span className="font-medium">{it.actor_name}</span>
                    <span className="text-muted">{it.kind === 'mention' ? ' mentioned you in ' : ' commented on '}</span>
                    <span className="font-medium">{it.doc_icon} {it.doc_title || 'Untitled'}</span>
                  </p>
                  <p className="mt-0.5 truncate text-xs text-muted">“{it.body}”</p>
                  <p className="mt-0.5 text-2xs text-faint">{relativeTime(it.created_at)}</p>
                </div>
              </button>
            );
          })
        )}
      </ModalBody>
    </Modal>
  );
}
