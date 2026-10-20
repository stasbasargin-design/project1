(function(root) {
  'use strict';
  let config = null, preparing = null, workerPrepared = false;
  const ios = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = () => navigator.standalone === true || Boolean(root.matchMedia?.('(display-mode: standalone)').matches);
  function reason() {
    if (ios() && !standalone()) return 'На iPhone: Safari → Поделиться → На экран «Домой». Откройте I-MAX с новой иконки и подключите Push.';
    if (!root.isSecureContext) return 'Для Push требуется защищённый адрес HTTPS.';
    if (!('Notification' in root) || !('PushManager' in root) || !('serviceWorker' in navigator)) return 'Этот браузер или версия iOS не поддерживает Web Push. На iPhone требуется iOS 16.4 или новее и запуск с экрана «Домой».';
    if (!config) return 'Настройки Web Push ещё не загружены. Нажмите «Подключить Push» для повторной проверки.';
    if (!config.enabled) return 'Web Push ещё не настроен на сервере.';
    if (root.Notification.permission === 'denied') return 'Уведомления запрещены. Разрешите их в настройках сайта/устройства и повторите подключение.';
    return '';
  }
  async function prepare() {
    if (preparing) return preparing;
    preparing = (async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);
      let response;
      try { response = await fetch(new URL('./api/push/web/config', document.baseURI), {cache:'no-store', signal:controller.signal}); }
      finally { clearTimeout(timer); }
      if (!response.ok) throw new Error('Не удалось получить настройки Web Push');
      const value = await response.json();
      if (typeof value.data?.publicKey !== 'string') throw new Error('Некорректные настройки Web Push');
      config = value.data;
      if (!reason()) {
        await navigator.serviceWorker.register(new URL('./notification-sw.js', document.baseURI), {scope:new URL('./', document.baseURI).pathname});
        workerPrepared = true;
      }
      return config;
    })();
    try { return await preparing; } finally { preparing = null; }
  }
  function keyBytes(value) {
    const raw = atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4-value.length%4)%4));
    return Uint8Array.from(raw, char => char.charCodeAt(0));
  }
  async function subscribe() {
    // Permission must be invoked directly in the user's click turn (no fetch/await first).
    const problem = reason();
    if (problem) throw new Error(problem);
    if (!workerPrepared) { await prepare(); throw new Error('Настройки загружены. Нажмите «Подключить Push» ещё раз.'); }
    const permissionPromise = root.Notification.requestPermission();
    const permission = await permissionPromise;
    if (permission !== 'granted') throw new Error('Разрешение на Push-уведомления не получено');
    const registration = await navigator.serviceWorker.ready;
    const key = keyBytes(config.publicKey);
    let subscription = await registration.pushManager.getSubscription();
    const previousKey = subscription?.options?.applicationServerKey;
    if (subscription && previousKey && (new Uint8Array(previousKey).length !== key.length || !key.every((byte,index) => byte === new Uint8Array(previousKey)[index]))) {
      await subscription.unsubscribe(); subscription = null;
    }
    return subscription || registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key});
  }
  async function existing() {
    await prepare();
    if (reason() || root.Notification.permission !== 'granted') return null;
    const registration = await navigator.serviceWorker.ready;
    return registration.pushManager.getSubscription();
  }
  root.ITUS_WEB_PUSH = {prepare, subscribe, existing, reason, ready:()=>!reason()};
})(window);
