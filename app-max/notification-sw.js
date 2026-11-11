/* I-MAX Web Push: no offline cache, no external navigation. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

async function activePushEnvironment(){
  if(!self.indexedDB)return null;
  return new Promise(resolve=>{
    const request=self.indexedDB.open('itus-push-environment',1);
    request.onupgradeneeded=()=>request.result.createObjectStore('state');
    request.onerror=()=>resolve({enabled:false});
    request.onsuccess=()=>{const db=request.result,tx=db.transaction('state','readonly'),read=tx.objectStore('state').get('active');read.onsuccess=()=>resolve(read.result||null);read.onerror=()=>resolve({enabled:false});tx.oncomplete=()=>db.close();};
  });
}
function matchesEnvironment(state,data){
  if(!state)return !data?.activationId;
  return state.enabled===true&&state.environment===data?.environment&&state.activationId===data?.activationId;
}

function targetUrl(data) {
  const target = new URL('./', self.registration.scope);
  target.searchParams.set('push', '1');
  for (const key of ['type', 'eventId', 'topicRef', 'topicId', 'orderRef', 'orderId','environment','activationId']) {
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
  event.waitUntil((async () => {
    if(!matchesEnvironment(await activePushEnvironment(),data))return;
    await Promise.all([
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windows => {
        for (const client of windows) client.postMessage({type:'itus-push',data});
      }).catch(() => {}),
      self.registration.showNotification(title, {
        body: typeof payload.body === 'string' ? payload.body : 'Новое уведомление',
        tag: typeof data.eventId === 'string' ? `imax:${data.eventId}` : undefined,
        renotify: false,
        data: { url: targetUrl(data),environment:data.environment,activationId:data.activationId },
        icon: new URL('./assets/itus-logo.png', self.registration.scope).href
      })
    ]);
    if(!matchesEnvironment(await activePushEnvironment(),data)){
      const tag=typeof data.eventId==='string'?'imax:'+data.eventId:undefined;
      for(const notification of await self.registration.getNotifications(tag?{tag}:{})){
        if(notification.data?.activationId===data.activationId)notification.close();
      }
    }
  })());
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
    if(!matchesEnvironment(await activePushEnvironment(),event.notification.data))return;
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      const current = new URL(client.url), scope = new URL(self.registration.scope);
      if (current.origin !== scope.origin || !current.pathname.startsWith(scope.pathname)) continue;
      try { const navigated = await client.navigate(target); if (navigated) { await navigated.focus(); return; } } catch {}
    }
    if (self.clients.openWindow) await self.clients.openWindow(target);
  })());
});
