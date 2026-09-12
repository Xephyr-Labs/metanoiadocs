import { useEffect } from 'react';
import { docsApi, type InboxRow } from '../lib/docsApi';
import { nextSeen, notifyEnabled, notifyText, readSeen, unseen, writeSeen } from '../lib/desktopNotify';
import { subscribePush } from '../lib/push';
import { useAuth } from '../store/auth';
import { useWorkspace } from '../store/workspace';

/** How often the inbox is re-read while the app is open. */
const POLL_MS = 60_000;

/**
 * Raise the alert for one inbox row.
 *
 * Two ways to do this and both are needed. `new Notification()` is the one that
 * can carry a click handler back into this tab, so it stays the first choice —
 * but Android Chrome forbids the constructor outright (it throws "Illegal
 * constructor"), and there only the service worker may show anything. Falling
 * back to the registration means a phone gets the alert, minus the click route.
 */
function raise(row: InboxRow, selfId: string | null, onOpen: () => void): void {
  const { title, body } = notifyText(row, selfId);
  const options = { body, tag: row.id, icon: '/favicon.svg' };
  try {
    const note = new Notification(title, options);
    note.onclick = () => {
      window.focus();
      onOpen();
      note.close();
    };
  } catch {
    navigator.serviceWorker?.ready
      .then((reg) => reg.showNotification(title, options))
      .catch(() => {
        /* no service worker, or notifications refused after the permission check */
      });
  }
}

/**
 * Keep the inbox badge honest, and raise a browser notification when something
 * lands in it — a mention, a comment on your page, or a task assigned to you.
 *
 * The poll is deliberately outside the notification switch. Turning desktop
 * alerts off used to turn off this whole loop, which meant the sidebar's unread
 * count was read once at boot and never again: nothing arrived on screen until
 * the next reload. The badge is the quiet half of the same feature and everyone
 * gets it; the notification on top is opt-in.
 *
 * This is still the foreground half only — it works while a tab is open, which
 * is what the Notification API alone can do. Alerts with the app closed need
 * Web Push: a service-worker push handler, VAPID keys, and a subscription store
 * on the server.
 */
export function useDesktopNotifications(): void {
  const ws = useWorkspace();
  const auth = useAuth();
  const selfId = auth.user?.id ?? null;
  const { refreshUnread } = ws;

  useEffect(() => {
    let alive = true;

    const tick = async () => {
      const rows = await docsApi.inbox().catch(() => null);
      if (!alive || !rows) return;
      refreshUnread();

      const canNotify =
        typeof Notification !== 'undefined' &&
        notifyEnabled() &&
        Notification.permission === 'granted';
      if (!canNotify) return;

      const seen = readSeen();
      for (const row of unseen(rows, seen)) {
        raise(row, selfId, () => {
          if (row.kind === 'assigned') {
            if (row.project_id) ws.openProject(row.project_id);
          } else if (row.doc_id) {
            ws.select(row.doc_id);
          }
        });
      }
      writeSeen(nextSeen(rows, seen));
    };

    // Anyone who already had alerts on predates push, and a device the server
    // has no subscription for is a device that stays silent while the app is
    // closed. Re-offering the switch would be the wrong way to fix that — they
    // already said yes. This also heals a subscription the server lost.
    if (notifyEnabled() && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      subscribePush().catch(() => {});
    }

    tick();
    const timer = setInterval(tick, POLL_MS);
    // Coming back to the tab is the moment someone most wants the badge to be
    // right — waiting out the rest of a 60s interval to find out they were
    // mentioned is the complaint this whole hook exists to answer.
    const onVisible = () => { if (document.visibilityState === 'visible') tick(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
    // ws is rebuilt on every store change; the handlers it carries are stable
    // enough for a click, and re-subscribing each render would reset the timer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshUnread, selfId]);
}
