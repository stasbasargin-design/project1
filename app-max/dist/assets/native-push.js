(function (root) {
  'use strict';
  const plugin = () => root.Capacitor?.Plugins?.PushNotifications;
  let configured = false;
  function supported() { return Boolean(root.Capacitor?.isNativePlatform?.() && plugin()); }
  async function start({onToken,onNotification,onAction,onError} = {}) {
    if (!supported() || configured) return supported();
    configured = true;
    const push = plugin();
    push.addListener('registration', token => onToken?.(String(token?.value || '')));
    push.addListener('registrationError', error => onError?.(error));
    push.addListener('pushNotificationReceived', notification => onNotification?.(notification));
    push.addListener('pushNotificationActionPerformed', action => onAction?.(action.notification?.data || action));
    let permission = await push.checkPermissions();
    if (permission.receive === 'prompt') permission = await push.requestPermissions();
    if (permission.receive !== 'granted') throw new Error('Разрешение на уведомления Android не получено');
    await push.createChannel?.({id:'i-max-events',name:'I-MAX',description:'Сообщения и назначения',importance:4,visibility:1,sound:'default'});
    await push.register();
    return true;
  }
  async function unregister() { if (supported()) await plugin().unregister(); configured=false; }
  root.ITUS_NATIVE_PUSH = {supported,start,unregister};
})(window);
