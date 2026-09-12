// Push handlers, imported into the Workbox service worker (vite.config.ts).
//
// They live in their own file rather than in a custom service worker because
// the precaching one is generated: `injectManifest` would mean owning that
// whole file to add fifteen lines to it.

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    // A push with no readable payload still means something arrived — say so
    // rather than raising a notification with no text in it at all.
  }

  const title = data.title || 'MetanoiaDocs';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || (data.title ? '' : 'Something new landed in your inbox.'),
      // The id of the notification row it came from. The open tab's own poll
      // uses the same one, so a push and a poll that both catch the same
      // mention replace each other instead of stacking up two alerts. The
      // fallback is a fixed string for the same reason: without a tag, every
      // unreadable push would pile up its own alert.
      tag: data.tag || 'metanoia',
      icon: '/pwa-192.png',
      badge: '/pwa-192.png',
      data: { url: data.url || '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    (async () => {
      const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      // Reuse a tab that is already on this workspace rather than opening a
      // second one: the app holds live documents, and two copies of it is the
      // thing people complain about after a week of notifications.
      for (const client of open) {
        if (new URL(client.url).origin !== self.location.origin) continue;
        await client.focus();
        if ('navigate' in client) await client.navigate(url).catch(() => {});
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});
