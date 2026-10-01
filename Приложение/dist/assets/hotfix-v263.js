(() => {
  'use strict';

  const PREFIX = '[ITUS v2.6.3]';
  const BOT_KEY = 'itus.max.botIds.v263';
  const LAST_UNREAD_KEY = 'itus.max.lastUnread.v263';
  const SW_URL = './notification-sw.js';

  const log = (...a) => console.info(PREFIX, ...a);
  const text = el => String(el?.textContent || '').replace(/\s+/g, ' ').trim();

  function walkForKey(value, key, seen = new WeakSet()) {
    if (!value || typeof value !== 'object') return { found: false, value: '' };
    if (seen.has(value)) return { found: false, value: '' };
    seen.add(value);
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      return { found: true, value: value[key] == null ? '' : String(value[key]) };
    }
    for (const v of Array.isArray(value) ? value : Object.values(value)) {
      const hit = walkForKey(v, key, seen);
      if (hit.found) return hit;
    }
    return { found: false, value: '' };
  }

  function saveBotIdsFromPayload(payload) {
    const c = walkForKey(payload, 'clientBotId');
    const s = walkForKey(payload, 'serviceBotId');
    if (!c.found && !s.found) return false;

    const ids = {
      clientBotId: c.found ? c.value.trim() : '',
      serviceBotId: s.found ? s.value.trim() : ''
    };

    sessionStorage.setItem(BOT_KEY, JSON.stringify(ids));
    window.dispatchEvent(new CustomEvent('itus:bot-ids-updated', { detail: ids }));
    return true;
  }

  function getBotIds() {
    try { return JSON.parse(sessionStorage.getItem(BOT_KEY) || '{}'); }
    catch { return {}; }
  }

  const originalFetch = window.fetch.bind(window);
  window.fetch = async function(input, init) {
    const requestInit = init ? { ...init } : {};
    const method = String(
      requestInit.method || (input instanceof Request ? input.method : 'GET')
    ).toUpperCase();

    if (method !== 'GET' && method !== 'HEAD') {
      const ids = getBotIds();
      const hasIds = Object.prototype.hasOwnProperty.call(ids, 'clientBotId') ||
                     Object.prototype.hasOwnProperty.call(ids, 'serviceBotId');

      if (hasIds && typeof requestInit.body === 'string') {
        const ct = new Headers(
          requestInit.headers || (input instanceof Request ? input.headers : undefined)
        ).get('content-type') || '';

        if (ct.includes('application/json') || /^[\s]*[\{\[]/.test(requestInit.body)) {
          try {
            const body = JSON.parse(requestInit.body);
            if (body && !Array.isArray(body) && typeof body === 'object') {
              body.clientBotId = String(ids.clientBotId || '');
              body.serviceBotId = String(ids.serviceBotId || '');
              requestInit.body = JSON.stringify(body);
            }
          } catch (_) {}
        }
      }
    }

    const response = await originalFetch(input, requestInit);

    try {
      const clone = response.clone();
      const ct = clone.headers.get('content-type') || '';

      if (ct.includes('application/json')) {
        clone.json().then(saveBotIdsFromPayload).catch(() => {});
      } else {
        clone.text().then(raw => {
          const t = String(raw || '').trim();
          if (t.startsWith('{') || t.startsWith('[')) {
            try { saveBotIdsFromPayload(JSON.parse(t)); } catch (_) {}
          }
        }).catch(() => {});
      }
    } catch (_) {}

    return response;
  };

  // Notification delivery and read counters are owned by app.js / messenger.js.
  // The former MutationObserver and permission-on-every-click handler duplicated notifications.
  const start = () => document.getElementById('userPanel')?.classList.add('itus-sticky-user-header');
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',start,{once:true});
  else start();
  log('bot ID compatibility and sticky header loaded');
})();
