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
 * Why this browser holds no push subscription.
 *
 * Every one of these used to be the same thing to the caller — a rejected
 * promise that `enableAlerts` swallowed — so a device that could never receive
 * a background alert reported the switch as on. Naming the reason is the whole
 * point: `blocked` is a browser whose push service refused (Brave ships with
 * Google's push messaging off, and it is not alone), which is not the same
 * problem as a missing service worker or a server with no VAPID pair.
 */
export type PushFailure =
  | 'unsupported'
  | 'denied'
  | 'no-key'
  | 'no-worker'
  | 'blocked'
  | 'timeout';

export type PushResult = { ok: true } | { ok: false; reason: PushFailure; detail?: string };

/** A push service that does not answer at all. Long enough to cross a slow
 *  network, short enough that the switch always settles. */
const SUBSCRIBE_MS = 15_000;

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
 * What a rejected `subscribe()` means.
 *
 * Chromium answers a missing push service with `AbortError: Registration
 * failed - push service error`, which reads like a transient fault and is not:
 * on a browser with push messaging switched off it is permanent until the
 * person changes a browser setting. Only an explicit permission error is worth
 * telling apart, because that one is fixed in site settings instead.
 */
export function classifySubscribeError(err: unknown): { reason: PushFailure; detail?: string } {
  const name = (err as { name?: string })?.name ?? '';
  const message = (err as { message?: string })?.message ?? String(err ?? '');
  if (name === 'NotAllowedError') return { reason: 'denied', detail: message };
  return { reason: 'blocked', detail: message || name || undefined };
}

/** One line a person can act on, for each way this can fail. */
export function pushFailureText(reason: PushFailure): string {
  switch (reason) {
    case 'unsupported':
      return 'this browser cannot receive push messages';
    case 'denied':
      return 'notifications are blocked for this site';
    case 'no-key':
      return 'the server did not hand out a push key';
    case 'no-worker':
      return 'no service worker is running — reload the page';
    case 'timeout':
      return 'this browser’s push service did not answer';
    case 'blocked':
    default:
      return 'this browser’s push service refused the subscription (in Brave, turn on Settings → Privacy and security → Use Google services for push messaging)';
  }
}

/**
 * What the Settings row says under the switch. Pure so every state can be read
 * in a test rather than by toggling a browser permission by hand.
 */
export function alertsDescription(state: {
  denied: boolean;
  on: boolean;
  push: PushResult | null;
  supported: boolean;
}): string {
  if (state.denied) {
    return 'Blocked for this site — allow notifications in your browser settings first.';
  }
  if (!state.on) {
    return state.supported
      ? 'Get a browser notification when you are mentioned or a task is assigned to you, whether or not Metanoia is open.'
      : 'Get a browser notification when you are mentioned or a task is assigned to you. This browser can only show them while Metanoia is open in a tab.';
  }
  if (state.push?.ok) {
    return 'On for this device, including while Metanoia is closed.';
  }
  if (state.push && !state.push.ok) {
    return `On, but only while a tab is open — ${pushFailureText(state.push.reason)}.`;
  }
  return 'On for this device.';
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
 * That makes this safe to call on every visit to Settings, which is how the
 * row under the switch knows what it is talking about.
 */
export async function subscribePush(): Promise<PushResult> {
  if (!pushSupported()) return { ok: false, reason: 'unsupported' };
  if (Notification.permission !== 'granted') return { ok: false, reason: 'denied' };

  const res = await fetch('/api/push/key', { credentials: 'include' });
  if (!res.ok) return { ok: false, reason: 'no-key', detail: `HTTP ${res.status}` };
  const { key } = (await res.json()) as { key?: string };
  if (!key) return { ok: false, reason: 'no-key' };

  const reg = await workerReady();
  if (!reg) return { ok: false, reason: 'no-worker' };

  const existing = await reg.pushManager.getSubscription();
  // A subscription taken against a different VAPID key is dead weight — the
  // server can no longer sign for it — so drop it and take a fresh one.
  const wanted = urlBase64ToUint8Array(key);
  if (existing && !sameKey(existing.options.applicationServerKey, wanted)) {
    await existing.unsubscribe().catch(() => {});
  }

  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    // A push service that is switched off rejects; one that is unreachable can
    // leave this pending forever, and an unbounded await here is what left the
    // switch spinning with no way out.
    const taken = await Promise.race([
      reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: wanted }).then(
        (s) => ({ sub: s }),
        (err: unknown) => ({ err }),
      ),
      new Promise<{ timeout: true }>((resolve) =>
        setTimeout(() => resolve({ timeout: true }), SUBSCRIBE_MS),
      ),
    ]);
    if ('timeout' in taken) return { ok: false, reason: 'timeout' };
    if ('err' in taken) return { ok: false, ...classifySubscribeError(taken.err) };
    sub = taken.sub;
  }

  await post('/push/subscribe', sub.toJSON());
  return { ok: true };
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

/** Ask the server to push to every device this account has registered. */
export async function sendTestPush(): Promise<{ devices: number }> {
  const res = await fetch('/api/push/test', { method: 'POST', credentials: 'include' });
  if (!res.ok) return { devices: 0 };
  return (await res.json()) as { devices: number };
}

/**
 * Turn alerts on for this device: the browser's permission, the local pref the
 * foreground poll reads, and a push subscription for when no tab is open.
 *
 * One function because there are two places that offer the switch — Settings
 * and the inbox — and a device that got the permission but not the subscription
 * is the quiet failure this whole feature exists to remove. The push result
 * comes back with the permission rather than being swallowed, because "alerts
 * are on" and "alerts arrive when you are not looking" are different promises
 * and this is the only place that knows which one was kept.
 */
export async function enableAlerts(): Promise<{
  permission: NotificationPermission;
  push: PushResult | null;
}> {
  const permission =
    Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  const on = permission === 'granted';
  setNotifyEnabled(on);
  if (!on) return { permission, push: null };
  // A browser without push still gets the foreground alerts; the switch is not
  // worth failing over the half it cannot do — but the caller is told.
  const push = await subscribePush().catch(
    (err): PushResult => ({ ok: false, ...classifySubscribeError(err) }),
  );
  return { permission, push };
}

export async function disableAlerts(): Promise<void> {
  setNotifyEnabled(false);
  await unsubscribePush().catch(() => {});
}
