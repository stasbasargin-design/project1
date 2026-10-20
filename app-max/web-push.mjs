import webpush from 'web-push';

const defaultHosts = ['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com', 'push.yandex.ru'];
export function webPushConfig(env = process.env) {
  const publicKey = String(env.WEB_PUSH_VAPID_PUBLIC_KEY || '').trim();
  const privateKey = String(env.WEB_PUSH_VAPID_PRIVATE_KEY || '').trim();
  const subject = String(env.WEB_PUSH_VAPID_SUBJECT || '').trim();
  let enabled = false;
  if (publicKey && privateKey && /^(mailto:|https:\/\/)/.test(subject)) {
    try { webpush.getVapidHeaders('https://web.push.apple.com', subject, publicKey, privateKey, 'aes128gcm'); enabled = true; }
    catch { /* Invalid configuration is unavailable; never disclose key material. */ }
  }
  return { publicKey, privateKey, subject, enabled };
}

export function validateSubscription(value, extraHosts = '') {
  if (!value || typeof value !== 'object') throw new Error('INVALID_SUBSCRIPTION');
  const endpoint = new URL(value.endpoint);
  const hosts = [...defaultHosts, ...String(extraHosts).split(',').map(host => host.trim().toLowerCase()).filter(Boolean)];
  const allowed = hosts.includes(endpoint.hostname) || endpoint.hostname.endsWith('.push.apple.com');
  if (endpoint.protocol !== 'https:' || endpoint.port || endpoint.username || endpoint.password || endpoint.hash || !allowed || endpoint.href.length > 4096) throw new Error('INVALID_SUBSCRIPTION');
  const p256dh = String(value.keys?.p256dh || ''), auth = String(value.keys?.auth || '');
  if (!/^[\w-]+={0,2}$/.test(p256dh) || !/^[\w-]+={0,2}$/.test(auth)
      || Buffer.from(p256dh, 'base64url').length !== 65 || Buffer.from(p256dh, 'base64url')[0] !== 4
      || Buffer.from(auth, 'base64url').length !== 16) throw new Error('INVALID_SUBSCRIPTION');
  return { endpoint: endpoint.href, keys: { p256dh, auth } };
}

export async function deliverWebPush(subscriptions, notification, { env = process.env, send = webpush.sendNotification.bind(webpush) } = {}) {
  const config = webPushConfig(env);
  if (!config.enabled) throw Object.assign(new Error('WEB_PUSH_NOT_CONFIGURED'), { status: 503 });
  if (!Array.isArray(subscriptions) || !subscriptions.length || subscriptions.length > 50) throw Object.assign(new Error('INVALID_SUBSCRIPTIONS'), { status: 400 });
  let checked;
  try { checked = subscriptions.map(value => validateSubscription(value, env.WEB_PUSH_ALLOWED_HOSTS)); }
  catch { throw Object.assign(new Error('INVALID_SUBSCRIPTION'), { status: 400 }); }
  if (new Set(checked.map(value => value.endpoint)).size !== checked.length) throw Object.assign(new Error('DUPLICATE_SUBSCRIPTION'), { status: 400 });
  const payload = JSON.stringify(notification);
  if (Buffer.byteLength(payload, 'utf8') > 3500) throw Object.assign(new Error('PAYLOAD_TOO_LARGE'), { status: 400 });
  const results = [];
  // Bound connections and total recipients. Never include endpoints or provider bodies in results/logs.
  for (let offset = 0; offset < checked.length; offset += 5) {
    results.push(...await Promise.all(checked.slice(offset, offset + 5).map(async (subscription, slot) => {
      const index = offset + slot;
      try {
        await send(subscription, payload, { vapidDetails: { subject: config.subject, publicKey: config.publicKey, privateKey: config.privateKey }, TTL: 3600, urgency: 'high', timeout: 5000, contentEncoding: 'aes128gcm' });
        return { index, sent: true };
      } catch (error) {
        const status = Number(error?.statusCode) || 0;
        return { index, sent: false, status, invalid: status === 404 || status === 410, retryable: !status || status === 429 || status >= 500 };
      }
    })));
  }
  return {
    sent: results.filter(item => item.sent).length,
    failed: results.filter(item => !item.sent).length,
    invalidSubscriptionIndexes: results.filter(item => item.invalid).map(item => item.index),
    retryableSubscriptionIndexes: results.filter(item => item.retryable).map(item => item.index),
    errors: results.filter(item => !item.sent).map(({ index, status }) => ({ index, status }))
  };
}
