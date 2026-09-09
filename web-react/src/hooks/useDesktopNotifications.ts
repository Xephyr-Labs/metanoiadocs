import { useEffect } from 'react';
import { docsApi } from '../lib/docsApi';
import { nextSeen, notifyEnabled, notifyText, readSeen, unseen, writeSeen } from '../lib/desktopNotify';
import { useWorkspace } from '../store/workspace';

/** How often the inbox is re-read while the app is open. */
const POLL_MS = 60_000;

/**
 * Raise a browser notification when something lands in the inbox — a mention, a
 * comment on your page, or a task assigned to you.
 *
 * This is the foreground half only: it works while a tab is open, which is what
 * the Notification API alone can do. Notifications with the app closed need a
 * service worker and Web Push, which is a bigger piece of work and a server-side
 * subscription store.
 *
 * The poll runs whether or not the tab is focused — a notification is least
 * useful when you are already looking at the page.
 */
export function useDesktopNotifications(): void {
  const ws = useWorkspace();
  const { refreshUnread } = ws;

  useEffect(() => {
    if (typeof Notification === 'undefined') return;
    let alive = true;

    const tick = async () => {
      if (!notifyEnabled() || Notification.permission !== 'granted') return;
      const rows = await docsApi.inbox().catch(() => null);
      if (!alive || !rows) return;

      const seen = readSeen();

      for (const row of unseen(rows, seen)) {
        const { title, body } = notifyText(row);
        const note = new Notification(title, { body, tag: row.id, icon: '/favicon.svg' });
        note.onclick = () => {
          window.focus();
          if (row.kind === 'assigned') {
            if (row.project_id) ws.openProject(row.project_id);
          } else if (row.doc_id) {
            ws.select(row.doc_id);
          }
          note.close();
        };
      }

      writeSeen(nextSeen(rows, seen));
      // The badge is otherwise only read at boot, so this keeps it honest too.
      refreshUnread();
    };

    tick();
    const timer = setInterval(tick, POLL_MS);
    return () => { alive = false; clearInterval(timer); };
    // ws is rebuilt on every store change; the handlers it carries are stable
    // enough for a click, and re-subscribing each render would reset the timer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshUnread]);
}
