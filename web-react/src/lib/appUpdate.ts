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
import { toast } from './toast';

const CHECK_EVERY = 30 * 60 * 1000;

export function installAppUpdates() {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
  const sw = navigator.serviceWorker;

  void sw.ready.then((registration) => {
    const check = () => { if (navigator.onLine) registration.update().catch(() => {}); };
    setInterval(check, CHECK_EVERY);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') check();
    });
  }).catch(() => {});

  // A first install also fires controllerchange; that is not a new build.
  const hadController = !!sw.controller;
  let pending = false;
  const reload = () => location.reload();
  sw.addEventListener('controllerchange', () => {
    if (!hadController || pending) return;
    pending = true;
    if (document.visibilityState === 'hidden') { reload(); return; }
    toast('A new version of Metanoia is ready.', { label: 'Reload', onSelect: reload });
  });
  document.addEventListener('visibilitychange', () => {
    if (pending && document.visibilityState === 'hidden') reload();
  });
}
