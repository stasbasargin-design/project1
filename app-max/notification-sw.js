/* ITUS MAX notification service worker v2.6.3 */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

self.addEventListener('push', event => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; }
  catch (_) { payload = { body: event.data ? event.data.text() : '' }; }

  const title = payload.title || 'I-MAX';
  const options = {
    body: payload.body || 'Новое уведомление',
    tag: payload.tag || 'itus-max-push',
    data: payload.data || { url: './' },
    icon: payload.icon,
    badge: payload.badge
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || './', self.registration.scope).href;

  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });

    for (const client of windows) {
      if ('navigate' in client) {
        try { await client.navigate(target); } catch (_) {}
      }
      if ('focus' in client) {
        await client.focus();
        return;
      }
    }

    if (self.clients.openWindow) await self.clients.openWindow(target);
  })());
});
