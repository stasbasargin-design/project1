/* I-MAX Web Push: no offline cache, no external navigation. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

function targetUrl(data) {
  const target = new URL('./', self.registration.scope);
  target.searchParams.set('push', '1');
  for (const key of ['type', 'eventId', 'topicRef', 'topicId', 'orderRef', 'orderId']) {
    if (typeof data?.[key] === 'string' && data[key].length <= 256) target.searchParams.set(key, data[key]);
  }
  return target.href;
}

self.addEventListener('push', event => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; }
  catch (_) { payload = { body: event.data ? event.data.text() : '' }; }
  if (!payload || typeof payload !== 'object') payload = {};
  const data = payload.data && typeof payload.data === 'object' ? payload.data : {};
  const title = typeof payload.title === 'string' ? payload.title : 'I-MAX';
  event.waitUntil(self.registration.showNotification(title, {
    body: typeof payload.body === 'string' ? payload.body : 'Новое уведомление',
    tag: typeof data.eventId === 'string' ? `imax:${data.eventId}` : undefined,
    renotify: false,
    data: { url: targetUrl(data) },
    icon: new URL('./assets/itus-logo.png', self.registration.scope).href
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  let target = new URL('./', self.registration.scope).href;
  try {
    const candidate = new URL(event.notification.data?.url || './', self.registration.scope);
    const scope = new URL(self.registration.scope);
    if (candidate.origin === scope.origin && candidate.pathname.startsWith(scope.pathname)) target = candidate.href;
  } catch {}
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      const current = new URL(client.url), scope = new URL(self.registration.scope);
      if (current.origin !== scope.origin || !current.pathname.startsWith(scope.pathname)) continue;
      try { const navigated = await client.navigate(target); if (navigated) { await navigated.focus(); return; } } catch {}
    }
    if (self.clients.openWindow) await self.clients.openWindow(target);
  })());
});
