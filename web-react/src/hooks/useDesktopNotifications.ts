import { useEffect } from 'react';
import { docsApi, type InboxRow } from '../lib/docsApi';
import { nextSeen, notifyEnabled, notifyText, readSeen, unseen, writeSeen } from '../lib/desktopNotify';
import { subscribePush } from '../lib/push';
import { useAuth } from '../store/auth';
import { useWorkspace } from '../store/workspace';

/** How often the inbox is re-read while the app is open. */
const POLL_MS = 60_000;

/** Inbox rows the service worker has already shown from a push, this session. */
const pushed = new Set<string>();

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
  return (await navigator.serviceWorker.getRegistration().catch(() => undefined)) ?? null;
}

/**
 * Whether this alert is already on screen or was already shown.
 *
 * A pushed alert and the poll's own both carry the row id as their tag. When
 * the push got there first, raising it again either stacks a second alert (if
 * the first was dismissed) or silently replaces the first — and on Windows a
 * replaced toast is pulled off the screen, so the alert someone was about to
 * read vanishes. The poll is the fallback for a device push cannot reach; it
 * should never compete with a push that worked.
 */
async function alreadyShown(rowId: string, reg: ServiceWorkerRegistration | null): Promise<boolean> {
  if (pushed.has(rowId)) return true;
  if (!reg?.getNotifications) return false;
  const showing = await reg.getNotifications({ tag: rowId }).catch(() => []);
  return showing.length > 0;
}

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
  // The same icon the service worker uses, so a foreground alert and a pushed
  // one look alike. `/favicon.svg` was neither in `public/` nor in the build,
  // so this drew with no icon at all.
  const options = { body, tag: row.id, icon: '/pwa-192.png' };
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
    // The first read of this page session. Anything already in the inbox then
    // arrived while no tab was open: a device with a push subscription was
    // shown it at the time, and replaying the lot the moment the app opens is
    // what made alerts look like they "only arrive when I open the app".
    let first = true;

    const onMessage = (e: MessageEvent) => {
      const d = e.data as { type?: string; tag?: string } | null;
      if (d?.type === 'mn-push-shown' && d.tag) pushed.add(d.tag);
    };
    navigator.serviceWorker?.addEventListener('message', onMessage);

    // One read at a time: the interval and a tab coming back into view can
    // land together, and two passes over the same unseen rows raise each twice.
    let running = false;
    const tick = async () => {
      if (running) return;
      running = true;
      try {
        await read();
      } finally {
        running = false;
      }
    };

    const read = async () => {
      const rows = await docsApi.inbox().catch(() => null);
      if (!alive || !rows) return;
      refreshUnread();

      const canNotify =
        typeof Notification !== 'undefined' &&
        notifyEnabled() &&
        Notification.permission === 'granted';
      if (!canNotify) return;

      const seen = readSeen();
      const reg = await registration();
      const backlog = first && !!(await reg?.pushManager?.getSubscription().catch(() => null));
      first = false;
      if (!alive) return;
      for (const row of backlog ? [] : unseen(rows, seen)) {
        if (await alreadyShown(row.id, reg)) continue;
        raise(row, selfId, () => {
          if (row.kind === 'digest') {
            ws.openTasks();
          } else if (row.kind === 'assigned') {
            if (row.project_id) ws.openProject(row.project_id);
          } else if (row.task_id) {
            // A reminder names one task, so it opens that one.
            if (row.project_id) ws.openProject(row.project_id, row.task_id);
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
      navigator.serviceWorker?.removeEventListener('message', onMessage);
    };
    // ws is rebuilt on every store change; the handlers it carries are stable
    // enough for a click, and re-subscribing each render would reset the timer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshUnread, selfId]);
}
