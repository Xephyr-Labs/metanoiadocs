// The Android app (mobile/): this web app, running inside a Capacitor WebView
// pointed at the server the person picked on first launch.
//
// Nothing here is bundled from Capacitor. The native side injects
// `window.Capacitor` with a proxy per installed plugin, so the page talks to
// them through that global — and in a browser, where it is absent, every
// function below is a no-op. The web build carries no native code.

type Listener = { remove: () => Promise<void> };
type PluginProxy = Record<string, (...args: any[]) => Promise<any>> & {
  addListener: (event: string, fn: (data: any) => void) => Promise<Listener>;
};
type CapacitorGlobal = {
  isNativePlatform?: () => boolean;
  Plugins?: Record<string, PluginProxy | undefined>;
};

const cap = (): CapacitorGlobal | undefined => (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;
const plugin = (name: string) => cap()?.Plugins?.[name];

export const isNativeApp = () => !!cap()?.isNativePlatform?.();

const TOKEN_KEY = 'mn-fcm-token';

async function sendToken(method: 'POST' | 'DELETE', token: string) {
  await fetch('/api/push/fcm', {
    method,
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token }),
  });
}

/**
 * Ask for notification permission once signed in, and hand this install's FCM
 * token to the server so mentions reach the phone with the app closed. A tap
 * on a notification opens what it was about.
 */
export async function startPush(open: (path: string) => void): Promise<() => void> {
  const push = plugin('PushNotifications');
  if (!isNativeApp() || !push) return () => {};
  // Registering in a build without Firebase crashes the app, so ask first —
  // and don't ask the person for a permission that could never be used.
  const available = await plugin('Server')?.pushAvailable?.().then((r: { available: boolean }) => r.available).catch(() => false);
  if (!available) return () => {};
  const subs = await Promise.all([
    push.addListener('registration', ({ value }: { value: string }) => {
      try { localStorage.setItem(TOKEN_KEY, value); } catch { /* private mode */ }
      sendToken('POST', value).catch(() => {});
    }),
    push.addListener('registrationError', (err: unknown) => console.warn('[push] registration failed', err)),
    push.addListener('pushNotificationActionPerformed', ({ notification }: { notification: { data?: { url?: string } } }) => {
      const url = notification?.data?.url;
      // Paths on this server only; anything else is not ours to follow.
      if (url && url.startsWith('/') && !url.startsWith('//')) open(url);
    }),
  ]);
  try {
    let { receive } = await push.checkPermissions();
    if (receive === 'prompt' || receive === 'prompt-with-rationale') ({ receive } = await push.requestPermissions());
    if (receive === 'granted') await push.register();
  } catch (err) {
    console.warn('[push] not available', err);
  }
  return () => { subs.forEach((s) => s.remove()); };
}

/** Before signing out: this phone stops receiving the person's alerts. */
export async function stopPush() {
  if (!isNativeApp()) return;
  let token: string | null = null;
  try { token = localStorage.getItem(TOKEN_KEY); localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
  if (token) await sendToken('DELETE', token).catch(() => {});
}

/**
 * The Android back button, in the order a person expects: close what is open
 * on top (a sheet, the menu), then go back a screen, then leave the app —
 * instead of the WebView's default of quitting from anywhere.
 */
export async function onBackButton(handler: (canGoBack: boolean) => void): Promise<() => void> {
  const app = plugin('App');
  if (!isNativeApp() || !app) return () => {};
  const sub = await app.addListener('backButton', ({ canGoBack }: { canGoBack: boolean }) => handler(canGoBack));
  return () => { sub.remove(); };
}

export const minimizeApp = () => plugin('App')?.minimizeApp?.();

/** Match the system status bar to the app's own top bar, per theme. */
export function syncStatusBar(dark: boolean) {
  const bar = plugin('StatusBar');
  if (!isNativeApp() || !bar) return;
  const color = getComputedStyle(document.documentElement).getPropertyValue('--canvas').trim() || (dark ? '#191919' : '#ffffff');
  bar.setBackgroundColor({ color }).catch(() => {});
  // DARK is light text on a dark bar.
  bar.setStyle({ style: dark ? 'DARK' : 'LIGHT' }).catch(() => {});
}

/** The server this app is pointed at, and a way back to the picker. */
export const serverHost = () => location.host;
export const changeServer = () => plugin('Server')?.clear?.();
