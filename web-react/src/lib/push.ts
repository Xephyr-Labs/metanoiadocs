// Subscribing this browser to Web Push, which is what makes an alert arrive
// with Metanoia closed. The in-page Notification API needs a live tab; this
// hands a subscription to the browser's push service, and the service worker
// wakes on the other end (public/push-sw.js).

import { setNotifyEnabled } from './desktopNotify';

/** Push needs all three, and Safari before 16.4 has none of them. */
export function pushSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    typeof window !== 'undefined' &&
    'PushManager' in window &&
    typeof Notification !== 'undefined'
  );
}

/**
 * The VAPID key travels as base64url text and `pushManager.subscribe` wants
 * bytes. Getting this wrong does not throw anywhere useful — the subscription
 * is accepted and simply never delivers — so it is worth its own test.
 */
export function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4))
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const raw = atob(padded);
  // Backed by a real ArrayBuffer, not the generic ArrayBufferLike a bare
  // `new Uint8Array(n)` is typed as — subscribe() takes a BufferSource.
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

/**
 * The registered worker, or null if none turns up.
 *
 * `navigator.serviceWorker.ready` is a promise that simply never settles when
 * nothing is registered — which is every `npm run dev` session, since the PWA
 * plugin only emits a worker for a build. Awaiting it bare would leave the
 * Settings switch spinning forever on a developer's machine.
 */
async function workerReady(ms = 5000): Promise<ServiceWorkerRegistration | null> {
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

async function post(path: string, body: unknown): Promise<void> {
  await fetch(`/api${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/**
 * Subscribe this browser and register the endpoint with the server.
 *
 * Re-subscribing is deliberately cheap and repeatable: the server upserts on
 * the endpoint, so sending an existing subscription again costs one row write
 * and fixes the case where the server forgot a device the browser still has.
 */
export async function subscribePush(): Promise<boolean> {
  if (!pushSupported() || Notification.permission !== 'granted') return false;
  const res = await fetch('/api/push/key', { credentials: 'include' });
  if (!res.ok) return false;
  const { key } = (await res.json()) as { key?: string };
  if (!key) return false;

  const reg = await workerReady();
  if (!reg) return false;
  const existing = await reg.pushManager.getSubscription();
  // A subscription taken against a different VAPID key is dead weight — the
  // server can no longer sign for it — so drop it and take a fresh one.
  const wanted = urlBase64ToUint8Array(key);
  if (existing && !sameKey(existing.options.applicationServerKey, wanted)) {
    await existing.unsubscribe().catch(() => {});
  }
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: wanted }));

  await post('/push/subscribe', sub.toJSON());
  return true;
}

function sameKey(have: ArrayBuffer | null, want: Uint8Array): boolean {
  if (!have) return false;
  const a = new Uint8Array(have);
  return a.length === want.length && a.every((b, i) => b === want[i]);
}

/** Stop this browser receiving pushes, on both ends. */
export async function unsubscribePush(): Promise<void> {
  if (!pushSupported()) return;
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await post('/push/unsubscribe', { endpoint: sub.endpoint });
  await sub.unsubscribe().catch(() => {});
}

/**
 * Turn alerts on for this device: the browser's permission, the local pref the
 * foreground poll reads, and a push subscription for when no tab is open.
 *
 * One function because there are two places that offer the switch — Settings
 * and the inbox — and a device that got the permission but not the subscription
 * is the quiet failure this whole feature exists to remove.
 */
export async function enableAlerts(): Promise<NotificationPermission> {
  const permission =
    Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  const on = permission === 'granted';
  setNotifyEnabled(on);
  if (on) {
    // A browser without push still gets the foreground alerts; the switch is
    // not worth failing over the half it cannot do.
    await subscribePush().catch(() => false);
  }
  return permission;
}

export async function disableAlerts(): Promise<void> {
  setNotifyEnabled(false);
  await unsubscribePush().catch(() => {});
}
