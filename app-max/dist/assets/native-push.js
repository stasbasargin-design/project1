(function (root) {
  'use strict';
  const plugin = () => root.Capacitor?.Plugins?.PushNotifications;
  const isNative = () => Boolean(root.Capacitor?.isNativePlatform?.() || root.Capacitor?.getPlatform?.() === 'android');
  let listening = false;
  let registered = false;
  let handlers = {};
  let permission = 'unknown';
  function supported() { return Boolean(isNative() && plugin()); }
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
    push.addListener('registration', token => handlers.onToken?.(String(token?.value || '')));
    push.addListener('registrationError', error => handlers.onError?.(error));
    push.addListener('pushNotificationReceived', notification => handlers.onNotification?.(notification));
    push.addListener('pushNotificationActionPerformed', action => handlers.onAction?.(action.notification?.data || action));
    return true;
  }
  async function start(nextHandlers = {}) {
    if (!listen(nextHandlers) || registered) return supported();
    const granted = await requestPermission();
    if (granted !== 'granted') throw new Error('Разрешение на уведомления Android не получено'); }
    const push = plugin();
    await push.createChannel?.({id:'i-max-events',name:'I-MAX',description:'Сообщения и назначения',importance:4,visibility:1,sound:'default'});
    await push.register(); registered = true;
    return true;
  }
  async function unregister() { if (supported()) await plugin().unregister(); registered=false; }
  root.ITUS_NATIVE_PUSH = {supported,listen,start,unregister,permission:()=>permission,checkPermissions,requestPermission};
})(window);
