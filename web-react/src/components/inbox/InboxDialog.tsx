import { Bell, Inbox, Loader2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { docsApi, type InboxRow } from '../../lib/docsApi';
import { avatarFor } from '../../lib/avatar';
import { relativeTime } from '../../lib/time';
import { notifyEnabled, setNotifyEnabled } from '../../lib/desktopNotify';
import { useAuth } from '../../store/auth';
import { useWorkspace } from '../../store/workspace';
import { EmptyState } from '../ui/EmptyState';
import { Modal, ModalBody } from '../ui/Modal';

/** Per-browser, like the switch it offers: dismissing it here is not a decision
 *  worth syncing to an account. */
const DISMISSED = 'mn-notify-nudge-dismissed';

/**
 * The offer to turn browser alerts on, where the alerts would be about.
 *
 * The switch itself lives in Settings and always has — which is the problem:
 * nobody looking at an inbox goes to Settings to ask why it never interrupted
 * them, so for most people the feature simply did not exist. One line, above
 * the feed, dismissable, and gone for good once alerts are on.
 */
function NotifyNudge() {
  const [show, setShow] = useState(() => {
    if (typeof Notification === 'undefined') return false;
    // Nothing to offer once it is already working, and never re-ask a browser
    // that has refused: only site settings can undo a denial.
    if (Notification.permission === 'denied') return false;
    if (Notification.permission === 'granted' && notifyEnabled()) return false;
    try {
      return localStorage.getItem(DISMISSED) !== 'yes';
    } catch {
      return true;
    }
  });
  const [busy, setBusy] = useState(false);

  if (!show) return null;

  const turnOn = async () => {
    setBusy(true);
    const permission = Notification.permission === 'granted'
      ? 'granted'
      : await Notification.requestPermission();
    setNotifyEnabled(permission === 'granted');
    setBusy(false);
    // A refusal closes the offer too — asking again is the browser's job now.
    setShow(false);
  };

  const dismiss = () => {
    setShow(false);
    try {
      localStorage.setItem(DISMISSED, 'yes');
    } catch {
      /* private mode — it will be offered again next session */
    }
  };

  return (
    <div className="mb-1.5 flex flex-wrap items-center gap-2 rounded-md bg-accent-soft px-2.5 py-2">
      <Bell size={14} className="shrink-0 text-accent" />
      <p className="min-w-0 flex-1 text-xs text-ink">
        Get told the moment something lands here, without watching the tab.
      </p>
      <button
        type="button"
        onClick={turnOn}
        disabled={busy}
        className="h-6 shrink-0 rounded bg-accent px-2 text-2xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
      >
        {busy ? 'Asking…' : 'Turn on alerts'}
      </button>
      <button
        type="button"
        aria-label="Not now"
        onClick={dismiss}
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-faint transition-colors hover:bg-hover hover:text-ink"
      >
        <X size={12} />
      </button>
    </div>
  );
}

export function InboxDialog() {
  const ws = useWorkspace();
  const auth = useAuth();
  const [items, setItems] = useState<InboxRow[] | null>(null);

  useEffect(() => {
    if (!ws.inboxOpen) return;
    setItems(null);
    // Load the feed (its read_at snapshot drives the unread dots), then mark
    // everything read so the sidebar badge clears.
    docsApi.inbox().then((rows) => { setItems(rows); ws.markInboxRead(); }).catch(() => setItems([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws.inboxOpen]);

  // A mention or comment lands on a document with a thread to read; an
  // assignment lands on a task, whose page may not exist yet, so it opens the
  // project it lives in instead.
  const open = (it: InboxRow) => {
    ws.setInboxOpen(false);
    if (it.kind === 'assigned') {
      if (it.project_id) ws.openProject(it.project_id);
      return;
    }
    if (!it.doc_id) return;
    ws.select(it.doc_id);
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
        <NotifyNudge />
        {items === null ? (
          <div className="flex justify-center py-10"><Loader2 size={18} className="animate-spin text-faint" /></div>
        ) : items.length === 0 ? (
          <EmptyState icon={Inbox} title="You're all caught up" hint="@-mentions, comments on your pages and tasks assigned to you show up here." />
        ) : (
          items.map((it) => {
            const a = avatarFor(it.actor_name);
            const unread = !it.read_at;
            // Tagging yourself is a reminder you left yourself; naming yourself
            // in the third person to do it reads like a stranger wrote it.
            const self = !!it.actor_id && it.actor_id === auth.user?.id;
            return (
              <button key={it.id} onClick={() => open(it)} className="flex w-full items-start gap-2.5 rounded-md px-2 py-2.5 text-left transition-colors hover:bg-hover">
                <span className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-2xs font-semibold text-white" style={{ background: a.color }}>
                  {a.initials}
                  {unread && <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-canvas bg-accent" />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm leading-snug text-ink">
                    <span className="font-medium">{self ? 'You' : it.actor_name}</span>
                    <span className="text-muted">
                      {it.kind === 'assigned'
                        ? (self ? ' took on ' : ' assigned you ')
                        : it.kind === 'mention'
                          ? (self ? ' tagged yourself in ' : ' mentioned you in ')
                          : ' commented on '}
                    </span>
                    <span className="font-medium">
                      {it.kind === 'assigned'
                        ? (it.task_title || it.body || 'a task')
                        : <>{it.doc_icon} {it.doc_title || 'Untitled'}</>}
                    </span>
                  </p>
                  {it.kind !== 'assigned' && (
                    <p className="mt-0.5 truncate text-xs text-muted">“{it.body}”</p>
                  )}
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
