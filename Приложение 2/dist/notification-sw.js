// No caching of authenticated requests or customer data.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || './', self.registration.scope);
  if (url.origin !== self.location.origin) return;
  event.waitUntil(self.clients.matchAll({type:'window'}).then(async windows => {
    const current = windows.find(client => client.url.startsWith(self.registration.scope));
    if (current) return current.focus();
    return self.clients.openWindow(url.href);
  }));
});
