(function (root) {
  'use strict';
  const plugin = () => root.Capacitor?.Plugins?.PushNotifications;
  const isNative = () => Boolean(root.Capacitor?.isNativePlatform?.() || root.Capacitor?.getPlatform?.() === 'android');
  let configured = false;
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
  async function start({onToken,onNotification,onAction,onError} = {}) {
    if (!supported() || configured) return supported();
    configured = true;
    const push = plugin();
    push.addListener('registration', token => onToken?.(String(token?.value || '')));
    push.addListener('registrationError', error => onError?.(error));
    push.addListener('pushNotificationReceived', notification => onNotification?.(notification));
    push.addListener('pushNotificationActionPerformed', action => onAction?.(action.notification?.data || action));
    const granted = await requestPermission();
    if (granted !== 'granted') { configured = false; throw new Error('Разрешение на уведомления Android не получено'); }
    await push.createChannel?.({id:'i-max-events',name:'I-MAX',description:'Сообщения и назначения',importance:4,visibility:1,sound:'default'});
    await push.register();
    return true;
  }
  async function unregister() { if (supported()) await plugin().unregister(); configured=false; }
  root.ITUS_NATIVE_PUSH = {supported,start,unregister,permission:()=>permission,checkPermissions,requestPermission};
})(window);
