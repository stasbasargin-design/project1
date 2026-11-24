(() => {
  'use strict';

  const CONFIG = Object.assign({
    schemaVersion: '1.0', applicationId: 'alfa-auto-service-workplace', applicationVersion: '11.0.0',
    mode: 'demo', endpoint: '/hs/alfa_auto_web/v1/exchange', credentials: 'same-origin', authToken: '',
    timeoutMs: 15000, retryCount: 2, retryDelayMs: 900, autosaveDelayMs: 700,
    pollIntervalMs: 15000, maxOutboxItems: 100, sendFullSnapshot: true, locale: 'ru-RU'
  }, window.ALFA_AUTO_CONFIG || {});

  const STORAGE = {
    outbox: 'aa61_json_outbox_v1',
    cursor: 'aa61_json_event_cursor_v1',
    lastRemoteState: 'aa61_last_remote_state_v1'
  };

  const listeners = new Set();
  let saveTimer = null;
  let pollTimer = null;
  let flushing = false;
  let lastExchange = null;
  let status = CONFIG.mode === 'http' ? 'connecting' : 'demo';

  function readJson(key, fallback) {
    try { const parsed = JSON.parse(localStorage.getItem(key)); return parsed == null ? fallback : parsed; }
    catch (_) { return fallback; }
  }

  function writeJson(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function uuid() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    return `web-${Date.now()}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`;
  }

  function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

  function publicConfig() {
    return {
      schemaVersion: CONFIG.schemaVersion,
      applicationId: CONFIG.applicationId,
      applicationVersion: CONFIG.applicationVersion,
      mode: CONFIG.mode,
      endpoint: CONFIG.endpoint,
      credentials: CONFIG.credentials,
      timeoutMs: CONFIG.timeoutMs,
      retryCount: CONFIG.retryCount,
      pollIntervalMs: CONFIG.pollIntervalMs,
      tokenConfigured: Boolean(CONFIG.authToken)
    };
  }

  function outbox() {
    const items = readJson(STORAGE.outbox, []);
    return Array.isArray(items) ? items : [];
  }

  function setStatus(next, detail = {}) {
    status = next;
    const event = Object.assign({ status, pending: outbox().length, at: new Date().toISOString() }, detail);
    listeners.forEach((listener) => {
      try { listener(event); } catch (_) { /* consumer error must not stop exchange */ }
    });
    window.dispatchEvent(new CustomEvent('alfaauto:integration-status', { detail: event }));
  }

  function createEnvelope(action, payload, requestId = uuid()) {
    return {
      schemaVersion: CONFIG.schemaVersion,
      requestId,
      action,
      sentAt: new Date().toISOString(),
      client: {
        id: CONFIG.applicationId,
        version: CONFIG.applicationVersion,
        locale: CONFIG.locale,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
      },
      context: readJson('aa61_user_context_v1', { userId: '', employeeRef: '', organizationRef: '', branchRef: '', roles: [] }),
      payload: payload == null ? {} : payload
    };
  }

  function normalizeResponse(raw, envelope, httpStatus) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw exchangeError('INVALID_JSON', '1С вернула JSON неверной структуры.', httpStatus, false);
    if (raw.ok !== true) {
      const source = raw.error || {};
      throw exchangeError(source.code || 'ONEC_ERROR', source.message || '1С отклонила запрос.', httpStatus, source.retryable === true, source.details || null);
    }
    if (raw.requestId && raw.requestId !== envelope.requestId) throw exchangeError('REQUEST_ID_MISMATCH', 'Идентификатор ответа не совпадает с запросом.', httpStatus, false);
    return raw;
  }

  function exchangeError(code, message, httpStatus = 0, retryable = false, details = null) {
    const error = new Error(message);
    error.code = code;
    error.httpStatus = httpStatus;
    error.retryable = retryable;
    error.details = details;
    return error;
  }

  async function sendEnvelope(envelope) {
    if (CONFIG.mode !== 'http') {
      lastExchange = { direction: 'demo', action: envelope.action, requestId: envelope.requestId, at: new Date().toISOString(), httpStatus: 200 };
      return { schemaVersion: CONFIG.schemaVersion, requestId: envelope.requestId, ok: true, serverTime: new Date().toISOString(), data: { demo: true } };
    }

    let attempt = 0;
    let lastError;
    while (attempt <= Number(CONFIG.retryCount || 0)) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), Number(CONFIG.timeoutMs || 15000));
      try {
        const headers = { 'Accept': 'application/json', 'Content-Type': 'application/json; charset=utf-8', 'X-Request-ID': envelope.requestId };
        if (CONFIG.authToken) headers.Authorization = `Bearer ${CONFIG.authToken}`;
        const response = await fetch(CONFIG.endpoint, {
          method: 'POST', headers, credentials: CONFIG.credentials || 'same-origin',
          body: JSON.stringify(envelope), signal: controller.signal
        });
        const text = (await response.text()).replace(/^\uFEFF/, '').trim();
        if (!text || /^[<!]/.test(text)) throw exchangeError('NON_JSON_RESPONSE', 'Сервис 1С вернул пустой ответ или HTML вместо JSON.', response.status, response.status >= 500);
        let parsed;
        try { parsed = JSON.parse(text); }
        catch (_) { throw exchangeError('JSON_PARSE_ERROR', 'Ответ 1С не является корректным JSON.', response.status, response.status >= 500); }
        if (!response.ok && parsed.ok !== false) throw exchangeError(`HTTP_${response.status}`, `HTTP-сервис 1С вернул код ${response.status}.`, response.status, response.status >= 500);
        const normalized = normalizeResponse(parsed, envelope, response.status);
        lastExchange = { direction: 'response', action: envelope.action, requestId: envelope.requestId, at: new Date().toISOString(), httpStatus: response.status };
        setStatus('online', { lastAction: envelope.action });
        return normalized;
      } catch (error) {
        const normalized = error.name === 'AbortError' ? exchangeError('TIMEOUT', 'Превышено время ожидания ответа 1С.', 0, true) : error;
        lastError = normalized;
        const retryable = normalized.retryable === true || normalized instanceof TypeError;
        if (!retryable || attempt >= Number(CONFIG.retryCount || 0)) break;
        await delay(Number(CONFIG.retryDelayMs || 900) * (attempt + 1));
      } finally {
        clearTimeout(timeout);
      }
      attempt += 1;
    }
    lastExchange = { direction: 'error', action: envelope.action, requestId: envelope.requestId, at: new Date().toISOString(), code: lastError && lastError.code, message: lastError && lastError.message };
    setStatus('offline', { error: lastError && lastError.message });
    throw lastError;
  }

  async function call(action, payload, options = {}) {
    const envelope = createEnvelope(action, payload, options.requestId);
    return sendEnvelope(envelope);
  }

  function enqueue(action, payload, options = {}) {
    const envelope = createEnvelope(action, payload, options.requestId);
    if (CONFIG.mode !== 'http') {
      lastExchange = { direction: 'demo', action, requestId: envelope.requestId, at: new Date().toISOString(), httpStatus: 200 };
      setStatus('demo', { lastAction: action });
      return envelope.requestId;
    }
    const items = outbox();
    if (options.replaceKey) {
      const index = items.findIndex((item) => item.replaceKey === options.replaceKey);
      const queued = { envelope, replaceKey: options.replaceKey, attempts: 0, queuedAt: new Date().toISOString() };
      if (index >= 0) items[index] = queued;
      else items.push(queued);
    } else {
      items.push({ envelope, replaceKey: '', attempts: 0, queuedAt: new Date().toISOString() });
    }
    const limit = Math.max(Number(CONFIG.maxOutboxItems || 100), 10);
    writeJson(STORAGE.outbox, items.slice(-limit));
    setStatus(CONFIG.mode === 'http' ? status : 'demo');
    if (CONFIG.mode === 'http') void flush();
    return envelope.requestId;
  }

  async function flush() {
    if (flushing || CONFIG.mode !== 'http') return { sent: 0, pending: outbox().length };
    flushing = true;
    let sent = 0;
    try {
      let items = outbox();
      while (items.length) {
        const current = items[0];
        try {
          const response = await sendEnvelope(current.envelope);
          items.shift();
          writeJson(STORAGE.outbox, items);
          sent += 1;
          if (response.data && response.data.state) {
            writeJson(STORAGE.lastRemoteState, response.data.state);
            window.dispatchEvent(new CustomEvent('alfaauto:remote-state', { detail: response.data.state }));
          }
        } catch (error) {
          current.attempts = Number(current.attempts || 0) + 1;
          current.lastError = { code: error.code || 'NETWORK_ERROR', message: error.message, at: new Date().toISOString() };
          items[0] = current;
          writeJson(STORAGE.outbox, items);
          break;
        }
      }
      return { sent, pending: items.length };
    } finally {
      flushing = false;
      setStatus(CONFIG.mode === 'http' ? (outbox().length ? 'offline' : 'online') : 'demo');
    }
  }

  function scheduleSnapshot(state, reason = 'state.changed') {
    if (!CONFIG.sendFullSnapshot) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      enqueue('state.save', { reason, revision: state.revision || 0, state }, { replaceKey: 'state.save' });
    }, Number(CONFIG.autosaveDelayMs || 700));
  }

  function command(commandName, payload = {}, snapshot = null) {
    return enqueue('workflow.execute', { command: commandName, payload, state: snapshot }, {});
  }

  async function bootstrap(localState) {
    if (CONFIG.mode !== 'http') {
      setStatus('demo');
      return { ok: true, data: { mode: 'demo', state: localState } };
    }
    setStatus('connecting');
    try {
      const response = await call('session.bootstrap', { localRevision: localState && localState.revision || 0, capabilities: ['state.v1', 'workflow.v1', 'events.v1', 'print.v1'] });
      if (response.data && response.data.userContext) writeJson('aa61_user_context_v1', response.data.userContext);
      if (response.data && response.data.state) writeJson(STORAGE.lastRemoteState, response.data.state);
      void flush();
      return response;
    } catch (error) {
      return { ok: false, error: { code: error.code || 'OFFLINE', message: error.message }, data: { state: localState, offline: true } };
    }
  }

  async function pollEvents() {
    if (CONFIG.mode !== 'http' || document.hidden) return;
    try {
      const cursor = localStorage.getItem(STORAGE.cursor) || '';
      const response = await call('events.pull', { cursor, limit: 100 });
      const data = response.data || {};
      if (data.nextCursor != null) localStorage.setItem(STORAGE.cursor, String(data.nextCursor));
      if (Array.isArray(data.events) && data.events.length) window.dispatchEvent(new CustomEvent('alfaauto:events', { detail: data.events }));
    } catch (_) { /* status is already updated by call */ }
  }

  function startPolling() {
    stopPolling();
    if (CONFIG.mode !== 'http') return;
    pollTimer = setInterval(pollEvents, Math.max(Number(CONFIG.pollIntervalMs || 15000), 5000));
  }

  function stopPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  }

  function subscribe(listener) {
    listeners.add(listener);
    listener({ status, pending: outbox().length, at: new Date().toISOString() });
    return () => listeners.delete(listener);
  }

  function diagnostics() {
    return { config: publicConfig(), status, pending: outbox().length, lastExchange, cursor: localStorage.getItem(STORAGE.cursor) || '', outbox: outbox().map((item) => ({ action: item.envelope.action, requestId: item.envelope.requestId, queuedAt: item.queuedAt, attempts: item.attempts, lastError: item.lastError || null })) };
  }

  window.AlfaAutoGateway = Object.freeze({
    config: publicConfig(), call, enqueue, flush, scheduleSnapshot, command, bootstrap,
    startPolling, stopPolling, subscribe, diagnostics,
    clearOutbox() { writeJson(STORAGE.outbox, []); setStatus(CONFIG.mode === 'http' ? 'online' : 'demo'); }
  });
})();
