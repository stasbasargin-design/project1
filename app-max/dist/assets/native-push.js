(function (root) {
  'use strict';
  let pushPlugin = null;
  // In the static Capacitor build the native Android class is packaged, but
  // it is not added to Capacitor.Plugins until its JS proxy is registered.
  // Register it lazily so the app never falls back to Web Push in the APK.
  function plugin() {
    if (pushPlugin) return pushPlugin;
    const capacitor = root.Capacitor;
    pushPlugin = capacitor?.Plugins?.PushNotifications || capacitor?.registerPlugin?.('PushNotifications') || null;
    return pushPlugin;
  }
  const isNative = () => Boolean(root.Capacitor?.isNativePlatform?.() || root.Capacitor?.getPlatform?.() === 'android');
  let listening = false;
  let registered = false;
  let cachedToken = '', confirmedToken = '', lastRegistrationError = '';
  let confirming = null, starting = null, generation = 0;
  let handlers = {};
  let permission = 'unknown';
  function supported() { return Boolean(isNative() && plugin()); }
  async function confirmToken() {
    if (!cachedToken || typeof handlers.onToken !== 'function') return false;
    if (confirming) return confirming;
    const token = cachedToken, session = generation, onToken = handlers.onToken;
    confirming = (async () => {
      try {
        await onToken(token);
        if (session !== generation || token !== cachedToken) return false;
        confirmedToken = token; lastRegistrationError = '';
        return true;
      } catch (error) {
        if (session === generation) {
          confirmedToken = ''; lastRegistrationError = String(error?.message || 'Регистрация Push в 1С не подтверждена');
          handlers.onError?.(error);
        }
        throw error;
      }
    })();
    const active = confirming;
    try { return await active; } finally { if (confirming === active) confirming = null; }
  }
  async function checkPermissions() {
    if (!supported()) return 'unsupported';
    permission = String((await plugin().checkPermissions()).receive || 'prompt');
    return permission;
  }
  async function requestPermission() {
    if (!supported()) return 'unsupported';
    let current = await checkPermissions();
    if (current === 'prompt') {
      current = String((await plugin().requestPermissions()).receive || 'denied');
      permission = current;
    }
    return current;
  }
  function listen(nextHandlers = {}) {
    handlers = {...handlers,...nextHandlers};
    if (!supported() || listening) return supported();
    listening = true;
    const push = plugin();
    push.addListener('registration', token => {
      const previous = confirming, session = generation;
      cachedToken = String(token?.value || ''); confirmedToken = '';
      const received = cachedToken;
      if (previous) return previous.catch(() => false).then(() => {
        if (session !== generation || received !== cachedToken) return false;
        return confirmedToken === cachedToken || confirmToken().catch(() => false);
      });
      return confirmToken().catch(() => false);
    });
    push.addListener('registrationError', error => {
      registered = false; confirmedToken = ''; lastRegistrationError = String(error?.message || 'Не удалось получить токен Push');
      handlers.onError?.(error);
    });
    push.addListener('pushNotificationReceived', notification => handlers.onNotification?.(notification));
    push.addListener('pushNotificationActionPerformed', action => handlers.onAction?.(action.notification?.data || action));
    return true;
  }
  async function start(nextHandlers = {}) {
    if (!listen(nextHandlers)) return false;
    // Receiving an FCM token and saving its installation in 1C are separate
    // operations. Retry the latter with the same token after a network failure.
    if (cachedToken) return confirmedToken === cachedToken || confirmToken();
    if (starting) return starting;
    if (registered) return true;
    const session = generation;
    starting = (async () => {
      const granted = await requestPermission();
      if (granted !== 'granted') throw new Error('Разрешение на уведомления Android не получено');
      if (session !== generation) return false;
      const push = plugin();
      await push.createChannel?.({id:'i-max-events',name:'I-MAX',description:'Сообщения и назначения',importance:4,visibility:1,sound:'default'});
      if (session !== generation) return false;
      await push.register();
      if (session !== generation) return false;
      registered = true;
      return confirming ? confirming : true;
    })();
    const active = starting;
    try { return await active; } finally { if (starting === active) starting = null; }
  }
  async function unregister() {
    generation++; registered = false; cachedToken = ''; confirmedToken = ''; confirming = null; starting = null; lastRegistrationError = '';
    if (supported()) await plugin().unregister();
  }
  root.ITUS_NATIVE_PUSH = {supported,listen,start,unregister,permission:()=>permission,checkPermissions,requestPermission,
    isRegistered:()=>Boolean(cachedToken && confirmedToken === cachedToken), registrationError:()=>lastRegistrationError};
})(window);
