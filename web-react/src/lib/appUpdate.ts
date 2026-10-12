// Picking up a new build.
//
// The service worker precaches the whole app, which is what makes it open
// offline — and also what kept people on an old build long after a deploy.
// The worker only looked for a new build when a page was navigated to, and
// when it found one and took over, nothing told the page: a pinned tab or an
// installed PWA kept running the code it had started with. A fix that had
// shipped (several reviewers on a task) looked like it hadn't.
//
// So: look for a new build whenever the tab comes back and every half hour.
// When a new worker takes over, a tab nobody is looking at reloads at once; a
// tab in use offers a Reload, and reloads by itself the next time it is put
// away — nobody loses a half-typed comment to it.
//
// Each check also asks the server which build it is on. A phone that is still
// behind a minute later, because its worker never finished installing the new
// one, drops the worker and its caches and reloads from the network.
import { toast } from './toast';

const CHECK_EVERY = 30 * 60 * 1000;
// How long the worker gets to bring the new build in by itself.
const FORCE_AFTER = 60 * 1000;

let staleTimer: ReturnType<typeof setTimeout> | null = null;
let pending = false;

/** Whether the server is on a newer build than this page. /version.json is
 *  rewritten by every deploy and never cached, by the worker or the browser. */
async function behind() {
  try {
    const r = await fetch('/version.json', { cache: 'no-store' });
    if (!r.ok) return false;
    const { build } = await r.json();
    return typeof build === 'string' && build !== __BUILD__;
  } catch {
    return false;
  }
}

/** The worker had its chance and this page is still behind: an install that
 *  never finished (a big precache over a weak phone connection) left the old
 *  worker serving the old files. Drop the worker and its caches, so the next
 *  load comes from the network, then reload the way a new build always does. */
async function force(registration: ServiceWorkerRegistration) {
  staleTimer = null;
  if (pending || !(await behind())) return;
  await registration.unregister().catch(() => {});
  const keys = await caches.keys().catch(() => [] as string[]);
  // `mn-api` is the offline copy of the sidebar; it is refetched on load.
  await Promise.all(keys.map((k) => caches.delete(k).catch(() => {})));
  readyToReload();
}

function readyToReload() {
  if (pending) return;
  pending = true;
  if (document.visibilityState === 'hidden') { location.reload(); return; }
  toast('A new version of Metanoia is ready.', { label: 'Reload', onSelect: () => location.reload() });
}

export function installAppUpdates() {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
  const sw = navigator.serviceWorker;

  void sw.ready.then((registration) => {
    const check = () => {
      if (!navigator.onLine) return;
      registration.update().catch(() => {});
      void behind().then((stale) => { if (stale) staleTimer ??= setTimeout(() => void force(registration), FORCE_AFTER); });
    };
    // At once as well: a page the worker served from an old precache is
    // exactly the one that needs to find out.
    check();
    setInterval(check, CHECK_EVERY);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') check();
    });
  }).catch(() => {});

  // A first install also fires controllerchange; that is not a new build.
  const hadController = !!sw.controller;
  sw.addEventListener('controllerchange', () => {
    if (hadController) readyToReload();
  });
  document.addEventListener('visibilitychange', () => {
    if (pending && document.visibilityState === 'hidden') location.reload();
  });
}
