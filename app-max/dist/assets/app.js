(function () {
  'use strict';

  window.WebApp?.ready?.();
  window.WebApp?.expand?.();

  const API = window.ITUS_API;
  const FEATURES = window.ITUS_FEATURES;
  const AUTH_STORAGE = window.ITUS_REVIEW_MODE ? 'itus.review.maxUserId' : 'itus.maxUserId';
  const $ = id => document.getElementById(id);
  const CONFIG = {
    apiBase: window.ITUS_CONFIG?.ONE_C_API_BASE_URL || '/api/1c',
    publicBase: window.ITUS_CONFIG?.ONE_C_PUBLIC_BASE_URL || '',
    token: window.ITUS_CONFIG?.ONE_C_TOKEN || '',
    serviceBotId: window.ITUS_CONFIG?.MAX_SERVICE_BOT_ID || '',
    clientBotId: window.ITUS_CONFIG?.MAX_CLIENT_BOT_ID || '',
    miniAppId: window.ITUS_CONFIG?.MAX_MINI_APP_ID || '',
    timeoutMs: Number(window.ITUS_CONFIG?.REQUEST_TIMEOUT_MS || 35000),
    pollMs: Number(window.ITUS_CONFIG?.POLL_INTERVAL_MS || 60000),
    webPushPublicKey: String(window.ITUS_CONFIG?.WEB_PUSH_VAPID_PUBLIC_KEY || '').trim(),
    maxPhotoBytes: Number(window.ITUS_CONFIG?.MAX_PHOTO_UPLOAD_BYTES || window.ITUS_CONFIG?.MAX_UPLOAD_BYTES || 15 * 1024 * 1024),
    maxVideoBytes: Number(window.ITUS_CONFIG?.MAX_VIDEO_UPLOAD_BYTES || window.ITUS_CONFIG?.MAX_UPLOAD_BYTES || 15 * 1024 * 1024),
    maxDocumentBytes: Number(window.ITUS_CONFIG?.MAX_DOCUMENT_UPLOAD_BYTES || window.ITUS_CONFIG?.MAX_UPLOAD_BYTES || 15 * 1024 * 1024),
    enforceTabs: window.ITUS_CONFIG?.ENFORCE_SERVER_TABS === true,
    pingFallback: window.ITUS_CONFIG?.PING_FALLBACK_TO_AUTH !== false,
    version: 'i-max-2.7.13'
  };
  let buildCommit = '';
  async function loadBuildInfo() {
    if (!document.baseURI) return;
    try {
      const response = await fetch(new URL('./build-info.json',document.baseURI),{cache:'no-store'});
      if (!response.ok) return;
      const info = await response.json();
      if (/^[a-f0-9]{40}$/i.test(String(info.commit || ''))) buildCommit=info.commit;
    } catch {} // Metadata must never block login or queued work.
  }

  const ALL_VIEWS = {
    orders: 'ЗН', mp: 'МП', executor: 'Исп.', tech: 'ТЕХ',
    clients: 'B2B', chat: 'Чат'
  };
  const VIEW_TITLES = {
    orders: 'Заказ-наряды', mp: 'Мастер-приёмщик', executor: 'Исполнитель',
    tech: 'Технолог', clients: 'B2B: общение с клиентами', chat: 'Чат между отделами'
  };
  const NAV_ICONS = {
    orders: './assets/nav-icons/orders.svg', mp: './assets/nav-icons/mp.svg',
    executor: './assets/nav-icons/executor.svg', tech: './assets/nav-icons/tech.svg',
    chat: './assets/nav-icons/chat.svg'
  };

  const state = {
    view: 'orders', views: { ...ALL_VIEWS }, orders: [], selectedOrderId: '',
    user: null, userId: '', authMode: '', serviceBotId: '', clientBotId: '', loading: false, error: '', busy: false,
    unreadMessages:null, unreadRevision:0, lastUnreadMessages:null, seenEvents:new Set(), polling:false, notifications: [], notificationCursor: '', clientTopics: [], selectedClientTopic: '',
    clientMessages: {}, chatGroups: [], selectedChatGroup: '', chatMessages: {},
    search: '', pollTimer: null, initialized: false, failedOperationId: '', failedOperationReport: '', completionKey: '', completionStatus: null, queuedOperations: []
  };
  let pendingPushTarget = null;
  const handledPushTargets = new Set();
  const activeCompletions = new Map();
  const pendingActionButtons = new WeakSet();
  const pendingActions = new Set();
  const sessionRequests = new Set();
  let sessionGeneration = 0;
  let loggingOut = false;
  let queueResumeTimer = null;
  let queueResumeAt = 0;
  let queueResumeJob = null;
  let orderQrScanner = null;
  let activeOrderQrSearch = null;
  let lastOrderQrValue = '';
  const longRunningActions = new Set([
    'login', 'logout', 'submit-auth-qr', 'enable-system-notifications', 'enable-web-push', 'test-1c', 'retry-init', 'retry-failed-operation', 'open-operation-report', 'show-operation-queue',
    'refresh-orders', 'search-orders', 'select-order', 'load-order', 'submit-order-qr',
    'start-acceptance', 'complete-acceptance', 'choose-post', 'set-post', 'assign-executor', 'assign-other-executor', 'set-executor',
    'start-executor-work', 'complete-checklist', 'package-create', 'package-select', 'worktime-submit', 'package-start', 'package-pause', 'package-close',
    'start-quality', 'request-quality', 'complete-quality', 'service-history', 'open-defect-chat', 'send-defect-text', 'complete-defect-sheet',
    'load-client-topics', 'select-client-topic', 'refresh-client-messages', 'send-client-message',
    'load-chat-groups', 'select-chat-topic', 'refresh-chat-messages', 'send-chat-message',
    'msg-new-chat', 'msg-source', 'msg-section', 'msg-open', 'msg-refresh', 'msg-refresh-messages', 'msg-send', 'msg-media', 'msg-poll-send', 'msg-poll-vote', 'msg-outbox-show', 'msg-outbox-report', 'msg-outbox-retry'
  ]);
  let mediaPicker = null;

  const messenger = window.ITUS_MESSENGER?.create({
    api:API,call:call1C,user:()=>state.user,cacheOwner:()=>state.userId,
    allowed:()=>[...(state.views.clients?['clients']:[]),...(state.views.chat?['staff']:[])],
    toast,pickFile:configureFilePicker,photo:choosePhoto,media:openMediaPicker,filePayload:fileToPayload,
    closeSheet,sheet:showSheet,settings:showNotificationSettings,onRead:messagesRead,
    outbox: {
      scope: () => queueScope(),
      prepareBatch: async definitions => {
        const session = sessionSnapshot(); assertSession(session, session.scope);
        const operations = await operationQueue.prepareBatch(definitions.map(item => ({...item,scope:session.scope,kind:'chat'})));
        assertSession(session, session.scope); await refreshQueuedOperations(); return operations;
      },
      list: async () => { const session=sessionSnapshot(); const items=await operationQueue.list(session.scope); assertSession(session,session.scope); return items.filter(item=>item.kind==='chat'); },
      run: async (id, options) => { const session=sessionSnapshot(); try { return await operationQueue.run(id,options); } finally { if(sessionCurrent(session)) await refreshQueuedOperations(); } },
      report: openOperationReport
    }
  });

  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const escAttr = esc;
  const nowIso = () => new Date().toISOString();
  const requestId = () => crypto.randomUUID ? crypto.randomUUID() : `itus-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const currentOrder = () => state.orders.find(o => o.id === state.selectedOrderId) || state.orders[0] || null;
  const statusClass = value => /разреш|готов|заверш|закрыт|выполн/i.test(value) ? 'ok' : (/отклон|ошиб|нельзя/i.test(value) ? 'bad' : (/контрол|ожид|прием|приём|перерыв/i.test(value) ? 'warn' : ''));

  function toast(message, error = false) {
    const element = $('toast');
    element.textContent = message;
    element.classList.toggle('error', error);
    element.classList.remove('hidden');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => element.classList.add('hidden'), 3200);
  }

  function showSheet(title, hint, html) {
    $('sheetTitle').textContent = title;
    $('sheetHint').textContent = hint || '';
    $('sheetBody').innerHTML = html;
    $('overlay').classList.remove('hidden');
  }

  function closeSheet() {
    if (mediaPicker?.dismiss?.() === false) return false;
    orderQrScanner?.stop?.();
    orderQrScanner = null;
    state.cameraStream?.getTracks().forEach(track => track.stop());
    state.cameraStream = null;
    $('overlay').classList.add('hidden');
    $('sheetBody').innerHTML = '';
    return true;
  }

  function readAuthFromContext() {
    const params = new URLSearchParams(location.search);
    const max = window.WebApp || {};
    const telegram = window.Telegram?.WebApp || {};
    const user = max.initDataUnsafe?.user || telegram.initDataUnsafe?.user || max.user || {};
    return String(user.id || params.get('max_user_id') || params.get('maxUserId') || params.get('userId') || params.get('id') || localStorage.getItem(AUTH_STORAGE) || '').trim();
  }

  function setAuth(id, mode) {
    sessionGeneration++;
    for (const controller of sessionRequests) controller.abort();
    sessionRequests.clear();
    clearTimeout(queueResumeTimer); queueResumeTimer = null; queueResumeAt = 0;
    activeCompletions.clear();
    state.failedOperationId = ''; state.failedOperationReport = '';
    state.completionKey = ''; state.completionStatus = null; state.queuedOperations = [];
    state.userId = /^\d+$/.test(String(id || '').trim()) ? String(id).trim() : '';
    state.authMode = mode || 'max';
    // Bot IDs belong to the authenticated session; never carry them across logins.
    state.clientBotId = '';
    state.serviceBotId = '';
    if (state.userId) localStorage.setItem(AUTH_STORAGE, state.userId);
    else localStorage.removeItem(AUTH_STORAGE);
  }

  function sessionSnapshot() {
    return { generation:sessionGeneration, userId:state.userId, scope:[String(CONFIG.apiBase || ''), String(CONFIG.publicBase || ''), String(state.userId || '')].join('|') };
  }
  function sessionCurrent(session) {
    return session?.generation === sessionGeneration && session.userId === state.userId;
  }
  function sessionError() {
    return Object.assign(new Error('Отправка приостановлена до входа владельца пакета'), {code:'SESSION_CHANGED', queuePaused:true});
  }
  function assertSession(session, scope = '') {
    if (!sessionCurrent(session) || (scope && (loggingOut || !state.userId || scope !== session.scope))) throw sessionError();
  }

  function authPayload() {
    return { userId: state.userId, maxUserId: state.userId, authId: state.userId, authMode: state.authMode || 'max', source: 'ITUS_MAX' };
  }

  function maxContext() {
    return {
      webAppData: window.WebApp?.initData || '', platform: window.WebApp?.platform || 'web',
      serviceBotId: state.serviceBotId, clientBotId: state.clientBotId,
      miniAppId: CONFIG.miniAppId, userId: state.userId, maxUserId: state.userId,
      authMode: state.authMode || 'max'
    };
  }

  function orderPayloadFor(order, extra = {}) {
    if (!order) throw new Error('Сначала выберите заказ-наряд');
    return {
      orderRef: order.orderRef || order.id, orderId: order.orderRef || order.id,
      orderNumber: order.num, vehicleRef: order.vehicleRef || '', vehiclePlate: order.plate,
      clientRef: order.clientRef || '', counterpartyName: order.client, ...extra
    };
  }
  function orderPayload(extra = {}) { return orderPayloadFor(currentOrder(), extra); }

  function connectionStatus(status, message) {
    const el = $('connectionStatus');
    if (!el) return;
    el.textContent = message;
    el.dataset.status = status;
  }

  function apiErrorMessage(value) {
    if (!value) return '';
    if (typeof value === 'string') return value.trim();
    if (Array.isArray(value)) {
      for (const item of value) {
        const message = apiErrorMessage(item);
        if (message) return message;
      }
      return '';
    }
    if (typeof value === 'object') {
      const direct = String(value.message || value.description || value.detail || '').trim();
      if (direct) return direct;
      for (const item of Object.values(value)) {
        const message = apiErrorMessage(item);
        if (message) return message;
      }
    }
    return '';
  }

  function diagnosticToken(value) {
    return String(value || '').trim().replace(/[^a-zA-Z0-9._:-]/g, '').slice(0, 160);
  }

  function safeDiagnosticMessage(error, status) {
    if (status === 422) return '1С отклонила данные операции.';
    if (status) return `1С вернула HTTP ${status}.`;
    if (error?.code === 'TIMEOUT') return 'Истекло время ожидания ответа 1С.';
    return 'Не удалось подтвердить результат операции.';
  }

  function errorDiagnostic(error, {route = '', requestId: request = '', clientEntryId = '', attempt = 0, operationKind = '', attachmentType = ''} = {}) {
    const inherited = error?.diagnostic || {};
    const status = Number(inherited.status || error?.status || 0);
    const code = diagnosticToken(inherited.code || error?.code || 'ONE_C_ERROR') || 'ONE_C_ERROR';
    return {
      status, route: String(inherited.route || route || '').startsWith('/') ? String(inherited.route || route) : '',
      requestId: diagnosticToken(inherited.requestId || request), clientEntryId: diagnosticToken(clientEntryId),
      time: String(inherited.time || nowIso()), attempt: Number(attempt || 0), code,
      operationKind: diagnosticToken(inherited.operationKind || operationKind),
      attachmentType: diagnosticToken(inherited.attachmentType || attachmentType),
      message: safeDiagnosticMessage(error, status)
    };
  }

  function diagnosticReport(diagnostic) {
    return [
      'I-MAX: отчёт об ошибке отправки',
      `Версия: ${CONFIG.version}`,
      `Сборка: ${buildCommit || 'не определена'}`,
      `HTTP status: ${diagnostic.status || 'нет ответа'}`,
      `Маршрут: ${diagnostic.route || 'не определён'}`,
      `requestId: ${diagnostic.requestId || 'не определён'}`,
      `clientEntryId: ${diagnostic.clientEntryId || 'не определён'}`,
      `Время: ${diagnostic.time}`,
      `Попытка: ${diagnostic.attempt || 'не определена'}`,
      `Код: ${diagnostic.code}`,
      `Операция: ${diagnostic.operationKind || 'не определена'}`,
      `Тип вложения: ${diagnostic.attachmentType || 'нет'}`,
      `Результат в 1С: не подтверждён клиентом; требуется сверка по requestId`,
      `Сообщение: ${diagnostic.message}`
    ].join('\n');
  }

  async function call1C(method, payload = {}, options = {}) {
    const session = options.session || sessionSnapshot();
    assertSession(session);
    window.ITUS_WORKTIME?.validateRequest(method, payload);
    const base = String(CONFIG.apiBase || '').replace(/\/+$/, '');
    if (!base) throw new Error('Не заполнен ONE_C_API_BASE_URL');
    const controller = new AbortController();
    sessionRequests.add(controller);
    const timer = setTimeout(() => controller.abort(), CONFIG.timeoutMs);
    const headers = { 'Content-Type': 'application/json; charset=utf-8', 'X-ITUS-Request-Id': options.requestId || requestId() };
    if (CONFIG.token) headers['X-ITUS-Token'] = CONFIG.token;
    const envelope = {
      requestId: headers['X-ITUS-Request-Id'], timestamp: options.timestamp || nowIso(), ...authPayload(), ...payload,
      max: maxContext(), miniApp: 'ITUS', version: CONFIG.version
    };
    try {
      window.ITUS_WORKTIME?.record(method, payload);
      const response = await fetch(base + method, { method: 'POST', headers, body: JSON.stringify(envelope), signal: controller.signal });
      const raw = (await response.text()).replace(/^\uFEFF/, '');
      assertSession(session);
      let data;
      try { data = raw ? JSON.parse(raw) : {}; }
      catch { throw Object.assign(new Error(response.status === 404 ? `Метод ${method} не найден на сервере 1С (404). Файл не отправлен.` : '1С вернула не JSON'), { code: 'BAD_JSON', status: response.status }); }
      if (!response.ok || data.success === false) {
        const err = data.error || {};
        const message = apiErrorMessage(err) || apiErrorMessage(data.message)
          || (response.status === 404 ? `Метод ${method} не найден в 1С (404)` : `HTTP ${response.status}`);
        const code = typeof err === 'object' && !Array.isArray(err) ? err.code : '';
        throw Object.assign(new Error(message), { code: code || 'ONE_C_ERROR', status: response.status, details: err?.details });
      }
      connectionStatus('ok', window.ITUS_REVIEW_MODE ? 'Проверочный режим · без соединения с 1С' : `1С доступна · ${new Date().toLocaleTimeString('ru-RU', {hour:'2-digit', minute:'2-digit'})}`);
      return data;
    } catch (error) {
      if (!sessionCurrent(session)) throw sessionError();
      if (error.name === 'AbortError') error = Object.assign(new Error('Истекло время ожидания ответа 1С'), { code: 'TIMEOUT' });
      error.diagnostic = errorDiagnostic(error, { route:method, requestId:headers['X-ITUS-Request-Id'] });
      connectionStatus('error', navigator.onLine === false ? 'Нет подключения к интернету' : 'Последний запрос к 1С не выполнен');
      if (!options.silent) toast(`1С: ${error.message}`, true);
      throw error;
    } finally {
      clearTimeout(timer);
      sessionRequests.delete(controller);
    }
  }

  function mergeOrder(mapped) {
    const index = state.orders.findIndex(o => o.id === mapped.id || o.orderRef === mapped.orderRef);
    if (index < 0) state.orders.push(mapped);
    else {
      const local = state.orders[index];
      state.orders[index] = { ...local, ...mapped,
        _acceptance: local._acceptance, _checklist: local._checklist,
        _defectSheet: local._defectSheet, _quality: local._quality };
    }
  }

  async function initialize() {
    if (!state.userId) return render();
    const session = sessionSnapshot();
    state.loading = true; state.error = ''; render();
    try {
      const auth = await call1C('/auth/max', authPayload(), { silent: true });
      assertSession(session);
      // Альфа-Авто может вернуть data как массив блоков: [{user:[...]},{availableTabs:[...]}].
      // Сначала объединяем эти блоки, чтобы имя, роль и вкладки не терялись.
      const authData = Array.isArray(auth.data)
        ? Object.assign({}, ...auth.data.filter(item => item && typeof item === 'object' && !Array.isArray(item)))
        : (auth.data || {});
      // Идентификаторы ботов являются частью авторизации и приходят из 1С.
      // Не используем константы приложения: новая авторизация всегда заменяет значения сессии.
      const botSources = [authData, auth, authData.max, auth.max].filter(item => item && typeof item === 'object');
      state.clientBotId = String(botSources.map(item => item.clientBotId).find(value => value != null) || '').trim();
      state.serviceBotId = String(botSources.map(item => item.serviceBotId).find(value => value != null) || '').trim();
      state.user = API.normalizeUser(auth.user || authData.user || authData.profile || authData.employee || auth.employee || authData || auth);
      const identity = [authData.user,auth.user,authData.profile,authData.employee,auth.employee,authData,auth]
        .map(API.normalizeUser).find(candidate => candidate?.name);
      if (identity?.name) state.user = {...state.user, name:identity.name};
      const tabs = auth.availableTabs || authData.availableTabs || auth.data?.find?.(item => Array.isArray(item?.availableTabs))?.availableTabs;
      const roleCode = String(state.user?.roleName || '').trim().toLowerCase();
      const roleLabel = String(state.user?.role || '').trim().toLowerCase();
      const isAdmin = roleCode === 'admin' || roleCode === 'administrator'
        || (!roleCode && ['admin','administrator','администратор'].includes(roleLabel));
      // 1C explicitly grants administrators every section and may return [] for tabs.
      if (isAdmin) state.views = { ...ALL_VIEWS };
      else if (CONFIG.enforceTabs) {
        state.views = Object.fromEntries(Object.entries(ALL_VIEWS).filter(([key]) => Array.isArray(tabs) && tabs.includes(key)));
      } else state.views = { ...ALL_VIEWS };
      if (!Object.keys(state.views).length) { state.initialized = true; return; }
      await loadOrders(false);
      await refreshQueuedOperations();
      assertSession(session);
      state.initialized = true;
      scheduleQueueResume();
      startPolling();
      void startNativePush();
      void syncExistingWebPush();
      await applyPendingPushTarget();
    } catch (error) {
      if (sessionCurrent(session)) state.error = `Не удалось подключиться к 1С: ${error.message}`;
    } finally {
      if (sessionCurrent(session)) { state.loading = false; render(); }
    }
  }

  async function loadOrders(notify = true) {
    const response = await call1C('/orders/list', { status: 'active' }, { silent: !notify });
    const old = state.orders;
    state.orders = API.extractOrders(response).map(API.mapOrder).filter(o => o.id);
    state.orders = state.orders.map(order => {
      const local = old.find(x => x.id === order.id || x.orderRef === order.orderRef);
      return local ? { ...local, ...order, _acceptance: local._acceptance, _checklist: local._checklist, _defectSheet: local._defectSheet, _quality: local._quality } : order;
    });
    if (!state.orders.some(o => o.id === state.selectedOrderId)) state.selectedOrderId = state.orders[0]?.id || '';
    if (notify) toast('Список заказ-нарядов обновлён');
  }

  async function loadSingleOrder(orderRef, {select = true} = {}) {
    const response = await call1C('/orders/get', { orderRef, orderId: orderRef }, { silent: true });
    const raw = response.order || response.data?.order || response.data || response;
    const mapped = API.mapOrder(raw);
    if (mapped.id) { mergeOrder(mapped); if (select) state.selectedOrderId = mapped.id; }
    return mapped;
  }

  function renderAuth() {
    if ($('botUnread')) $('botUnread').hidden = true;
    $('tabs').innerHTML = '';
    $('notifications').innerHTML = '';
    $('userPanel').innerHTML = '<div class="avatar">ID</div><div class="user-meta"><div class="user-name">Вход</div><div class="user-role">MAX ID или QR</div></div>';
    $('app').innerHTML = `<div class="card"><h2>Вход в I-MAX</h2><p class="muted">ID пользователя MAX передаётся в каждом JSON-запросе и используется 1С для проверки прав и записи автора действия.</p><label for="authUserId">ID пользователя MAX</label><input id="authUserId" inputmode="numeric" autocomplete="off" placeholder="Только цифры"><div class="grid two"><button class="primary" data-action="login">Войти по ID</button><button data-action="scan-auth-qr">Считать QR-код</button></div></div>`;
  }

  function renderUser() {
    const badge = $('botUnread');
    const unread = Number(state.unreadMessages);
    if (badge) {
      badge.hidden = !Number.isFinite(unread) || unread <= 0;
      badge.textContent = Number.isFinite(unread) ? String(unread) : '';
      badge.setAttribute('aria-label', 'Непрочитанные сообщения: ' + (Number.isFinite(unread) ? unread : 0));
    }
    // После успешной авторизации в шапке показываем имя из ответа 1С.
    // Идентификатор нужен только для обмена и не должен занимать место имени.
    const name = state.user?.name || 'Сотрудник';
    const roleLabels = {master:'Мастер-приёмщик',executor:'Исполнитель',tech:'Технолог',admin:'Администратор'};
    const roleCode = String(state.user?.roleName || '').toLowerCase();
    const role = (state.user?.role && !/^[a-z0-9_-]+$/i.test(String(state.user.role)))
      ? state.user.role
      : (roleLabels[roleCode] || state.user?.role || (state.loading ? 'Подключение к 1С' : 'Авторизованный пользователь'));
    $('userPanel').innerHTML = `<div class="avatar">${esc((name || 'И').slice(0,1).toUpperCase())}</div><div class="user-meta"><div class="user-name">${esc(name)}</div><div class="user-role">${esc(role)}</div></div>`;
  }

  function renderTabs() {
    const keys=Object.keys(state.views).filter(k=>k!=='clients'&&k!=='chat');
    if(state.views.clients||state.views.chat)keys.push('chat');
    $('tabs').innerHTML = keys.map(key => `<button class="tab ${state.view === key ? 'active' : ''}" data-action="view" data-view="${key}" title="${escAttr(VIEW_TITLES[key])}" aria-label="${escAttr(VIEW_TITLES[key])}"><img class="nav-icon" src="${NAV_ICONS[key]}" alt="" aria-hidden="true">${key === 'chat' ? `<span id="botUnread" class="chat-unread-dot" aria-label="Непрочитанные сообщения: ${Number(state.unreadMessages) || 0}" ${Number(state.unreadMessages) > 0 ? '' : 'hidden'}>${Number(state.unreadMessages) || ''}</span>` : ''}</button>`).join('');
  }

  function renderNotifications() {
    const events = state.notifications.filter(event => event.type !== 'new_messages');
    $('notifications').innerHTML = events.map(event => `<div class="notice" role="status"><strong>${esc(event.title)}</strong>${event.message ? `<div>${esc(event.message)}</div>` : ''}<div class="notice-actions"><button data-action="open-notification" data-event="${escAttr(event.eventId)}">Открыть</button><button class="secondary" data-action="dismiss-notification" data-event="${escAttr(event.eventId)}">Закрыть</button></div></div>`).join('');
  }

  function normalizedNotificationType(value) {
    const compact = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
    const aliases = {
      'executor_assigned': 'executor_assigned',
      'executorassigned': 'executor_assigned',
      'назначен_исполнитель': 'executor_assigned',
      'назначение_исполнителя': 'executor_assigned',
      'new_message': 'new_messages',
      'new_messages': 'new_messages',
      'new_message': 'new_messages',
      'executor_changed': 'executor_changed',
      'task_assigned': 'task_assigned',
      'quality_control_requested': 'quality_control_requested'
    };
    return aliases[compact] || compact;
  }

  function viewForCurrentUser() {
    const role = String(state.user?.roleName || state.user?.role || '').trim().toLowerCase();
    const candidates = role.includes('исполн') || role === 'executor' ? ['executor', 'orders']
      : role.includes('техн') || role === 'tech' ? ['tech', 'orders']
      : role.includes('мастер') || role.includes('прием') || role === 'master' || role === 'mp' ? ['mp', 'orders']
      : ['orders'];
    return candidates.find(view => state.views[view]) || 'orders';
  }

  function messagesRead({previousUnread, remainingUnread, totalUnread}) {
    state.unreadRevision++;
    if (typeof totalUnread === 'number' && Number.isFinite(totalUnread) && totalUnread >= 0) state.unreadMessages = totalUnread;
    else if (state.unreadMessages !== null) state.unreadMessages = Math.max(0, state.unreadMessages - Math.max(0, previousUnread - remainingUnread));
    state.notifications = state.notifications.filter(e => e.type !== 'new_messages');
    renderUser(); renderNotifications();
    // An older in-flight poll cannot restore the count from before this read receipt.
    if (!state.polling) void pollNotifications();
  }

  function render() {
    document.body?.classList.toggle('messenger-view', state.view === 'chat' && Boolean(state.userId));
    if (state.view !== 'chat') messenger?.leave();
    if (!state.userId) return renderAuth();
    renderUser(); renderTabs(); renderNotifications();
    if (state.loading) return $('app').innerHTML = '<div class="card loading"><span class="spinner"></span><div><h2>Подключение к 1С</h2><span class="tiny">Получаем пользователя и доступные заказ-наряды</span></div></div>';
    if (state.error) return $('app').innerHTML = `<div class="card"><h2>Нет подключения к 1С</h2><p class="muted">${esc(state.error)}</p><div class="grid two"><button data-action="retry-init">Повторить</button><button data-action="settings">Настройки</button></div></div>`;
    if (!Object.keys(state.views).length) return $('app').innerHTML = '<div class="card"><h2>Нет доступных разделов</h2><p>Обратитесь к администратору 1С для назначения прав.</p><button data-action="logout">Выйти</button></div>';
    if (state.view === 'chat' && messenger) { messenger.enter(); return; }
    const renderers = { orders: renderOrdersView, mp: renderMpView, executor: renderExecutorView, tech: renderTechView, clients: renderClientsView, chat: renderChatView };
    $('app').innerHTML = (renderers[state.view] || renderOrdersView)();
  }

  function orderCard(order) {
    return `<button class="order ${state.selectedOrderId === order.id ? 'active' : ''}" data-action="select-order" data-ref="${escAttr(order.orderRef || order.id)}"><div class="row"><b>ЗН ${esc(order.num)} · ${esc(order.plate)}</b><span class="badge ${statusClass(order.status)}">${esc(order.status)}</span></div><div class="tiny">${esc(order.car)} · ${esc(order.client)}</div><div class="tiny">Исполнитель: ${esc(order.executor)} · дефекты: ${Number(order.counters?.defects || order.defects?.length || 0)}</div></button>`;
  }

  const operationQueue = window.ITUS_OPERATION_QUEUE?.create({
    context: sessionSnapshot,
    guard: (operation, session) => assertSession(session, operation.scope),
    sender: (operation, session) => call1C(operation.method, operation.body, { silent:true, requestId:operation.requestId, timestamp:operation.createdAt, session })
  });
  const queueScope = () => [String(CONFIG.apiBase || ''), String(CONFIG.publicBase || ''), String(state.userId || '')].join('|');

  async function refreshQueuedOperations() {
    if (!operationQueue || !state.userId) return;
    const session = sessionSnapshot();
    try {
      const items = await operationQueue.list(session.scope);
      assertSession(session, session.scope);
      state.queuedOperations = items.map(operation => ({
        id:operation.id, kind:operation.kind, status:operation.status, documentKey:operation.documentKey,
        orderRef:String(operation.body?.orderRef || operation.body?.orderId || '')
      }));
      void messenger?.refreshOutbox?.();
    } catch { if (sessionCurrent(session)) state.queuedOperations = []; }
  }

  function queuedOperationsStatus(order) {
    const refs = new Set([order?.id, order?.orderRef].filter(Boolean).map(String));
    const operations = state.queuedOperations.filter(operation => refs.has(operation.orderRef));
    if (!operations.length) return '';
    const rejected = operations.find(operation => operation.status === 'invalid' || operation.status === 'failed');
    const attachments = operations.filter(operation => operation.kind === 'entry').length;
    const detail = rejected ? 'Ошибка отправки — откройте технический отчёт' : `Ожидание подтверждения 1С: вложений ${attachments}`;
    return `<div class="notice" role="status"><strong>Сохранённая очередь</strong><div>${esc(detail)}</div><button data-action="show-operation-queue">Открыть очередь</button></div>`;
  }

  async function showOperationQueue() {
    await refreshQueuedOperations();
    const items = state.queuedOperations;
    const rows = items.map(item => `<div class="entry"><strong>${item.kind==='complete' ? 'Завершение документа' : item.kind==='chat' ? 'Сообщение чата' : 'Запись или вложение'}</strong><div>${['failed','invalid'].includes(item.status) ? 'Требуется проверка' : 'Ожидает отправки'}</div>${['failed','invalid'].includes(item.status) ? `<button data-action="open-operation-report" data-operation-id="${escAttr(item.id)}">Отчёт и повтор</button>` : ''}</div>`).join('');
    showSheet('Неотправленные операции', `Сохранено на устройстве: ${items.length}`, rows || '<p>Все операции подтверждены.</p>');
    scheduleQueueResume();
  }

  async function openOperationReport(id) {
    const session=sessionSnapshot(), operation=await operationQueue.get(id);
    assertSession(session, operation?.scope);
    if (!operation || operation.scope!==session.scope) return toast('Сохранённый пакет не найден',true);
    showQueuedOperationError({operation,queueStatus:operation.status,code:operation.error,diagnostic:operation.diagnostic,status:operation.diagnostic?.status});
  }

  function showQueuedOperationError(error) {
    if (error?.queuePaused) return;
    if (error?.code === 'QUEUE_BUSY') { scheduleQueueResume(Math.max(1000, Number(error.leaseUntil || Date.now()+1000)-Date.now()+100)); return; }
    const operation = error?.operation;
    if (!operation) throw error;
    state.failedOperationId = operation.id;
    state.failedOperationReport = diagnosticReport(errorDiagnostic(error, {
      route:operation.method, requestId:operation.requestId, clientEntryId:operation.clientEntryId, attempt:operation.attempts,
      operationKind:operation.kind, attachmentType:operation.body?.entry?.type
    }));
    const report = `<details><summary>Технический отчёт без данных вложения</summary><pre>${esc(state.failedOperationReport)}</pre></details><button data-action="copy-operation-report">Скопировать отчёт</button>`;
    if (error.queueStatus === 'invalid') {
      showSheet('Проверьте данные', '1С отклонила пакет с кодом HTTP 422. Автоматический повтор остановлен.', `${report}<button class="primary" data-action="retry-failed-operation">Повторить после проверки данных</button>`);
      return;
    }
    showSheet('Не удалось подтвердить отправку', 'Пакет сохранён на устройстве. Автоматические попытки остановлены.', `${report}<button class="primary" data-action="retry-failed-operation">Повторить</button>`);
  }

  async function copyOperationReport() {
    if (!state.failedOperationReport) return toast('Отчёт об ошибке не найден', true);
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(state.failedOperationReport);
      else {
        const area = document.createElement('textarea'); area.value = state.failedOperationReport;
        area.setAttribute('readonly', ''); area.style.position = 'fixed'; area.style.opacity = '0'; document.body.append(area);
        area.select(); document.execCommand('copy'); area.remove();
      }
      toast('Отчёт скопирован');
    } catch { toast('Не удалось скопировать отчёт', true); }
  }

  async function sendQueuedOperation(definition, { manual = false } = {}) {
    if (!operationQueue) throw new Error('Очередь отправки недоступна');
    const operation = await operationQueue.prepare(definition);
    await refreshQueuedOperations();
    try { return await operationQueue.run(operation.id, { manual }); }
    catch (error) { showQueuedOperationError(error); throw error; }
    finally { await refreshQueuedOperations(); }
  }

  async function retryFailedOperation() {
    const session = sessionSnapshot();
    const id = state.failedOperationId;
    if (!id || !operationQueue) return toast('Сохранённый пакет не найден', true);
    try {
      const operation = await operationQueue.get(id); assertSession(session,operation?.scope);
      if (!operation || operation.scope!==session.scope) throw sessionError();
      if (operation.kind === 'complete') {
        if (!await runQueuedDocumentCompletion(operation.documentKey,operation,{manual:true})) return;
      } else {
        const response=await operationQueue.run(id, { manual:true }); assertSession(session,session.scope);
        if(operation.kind==='chat') await messenger?.confirmedOutbox?.(operation,response);
      }
      assertSession(session,session.scope);
      state.failedOperationId = ''; state.failedOperationReport = '';
      closeSheet();
      await resumeSavedOperations(); assertSession(session,session.scope);
      const orderRef=operation.body?.orderRef || operation.body?.orderId;
      if (orderRef) await loadSingleOrder(orderRef,{select:false});
      render(); toast('Отправка подтверждена');
    } catch (error) {
      showQueuedOperationError(error);
    }
  }

  async function resumeSavedOperations() {
    if (!operationQueue || !state.userId || loggingOut || navigator.onLine===false) return;
    const session=sessionSnapshot();
    if (queueResumeJob?.session.generation===session.generation) return queueResumeJob.promise;
    const promise = (async () => {
    const operations = await operationQueue.list(session.scope); assertSession(session,session.scope);
    const ordered = operations.slice().sort((a, b) => Number(a.kind === 'complete') - Number(b.kind === 'complete'));
    for (const operation of ordered) {
      assertSession(session,session.scope);
      if (!['entry','complete','chat'].includes(operation.kind) || !['pending','sending'].includes(operation.status)) continue;
      if (operation.kind === 'complete' && (await operationQueue.list(session.scope)).some(item => item.kind === 'entry' && item.documentKey === operation.documentKey)) continue;
      try {
        if (operation.kind==='complete') await runQueuedDocumentCompletion(operation.documentKey,operation);
        else {
          const response=await operationQueue.run(operation.id);
          assertSession(session,session.scope);
          if(operation.kind==='chat') await messenger?.confirmedOutbox?.(operation,response);
        }
        assertSession(session,session.scope);
      } catch (error) { if (error.queuePaused) throw error; if(error.code!=='QUEUE_NOT_FOUND') showQueuedOperationError(error); }
    }
    assertSession(session,session.scope);
    await refreshQueuedOperations();
    })().catch(error => {
      if(sessionCurrent(session)) {
        if(error.queuePaused) scheduleQueueResume(250);
        else console.warn('Queue resume:',error.code || 'QUEUE_ERROR');
      }
    }).finally(()=>{ if(queueResumeJob?.promise===promise) queueResumeJob=null; });
    queueResumeJob={session,promise}; return promise;
  }

  function scheduleQueueResume(delay=0) {
    if (!state.userId || loggingOut || navigator.onLine===false) return;
    const at=Date.now()+Math.max(0,delay);
    if(queueResumeTimer && queueResumeAt<=at) return;
    clearTimeout(queueResumeTimer); queueResumeAt=at;
    const session=sessionSnapshot();
    queueResumeTimer=setTimeout(()=>{queueResumeTimer=null;queueResumeAt=0;if(sessionCurrent(session)) void resumeSavedOperations();},Math.max(0,delay));
  }

  function orderSearchText(order) {
    return [order.num, order.plate, order.car, order.client, order.status].join(' ').toLowerCase();
  }

  function filterRenderedOrderList(value = state.search) {
    const query = String(value || '').toLowerCase().trim();
    const rows = document.querySelectorAll?.('[data-order-search-text]') || [];
    let matches = 0;
    rows.forEach(row => {
      const visible = !query || String(row.dataset.orderSearchText || '').includes(query);
      row.hidden = !visible;
      if (visible) matches += 1;
    });
    const empty = $('orderSearchEmpty');
    if (empty) empty.hidden = matches > 0;
  }

  function renderOrderList() {
    const query = state.search.toLowerCase().trim();
    const orders = state.orders;
    const matching = orders.filter(order => !query || orderSearchText(order).includes(query));
    const rows = orders.map(order => `<div data-order-search-text="${escAttr(orderSearchText(order))}"${!query || orderSearchText(order).includes(query) ? '' : ' hidden'}>${orderCard(order)}</div>`).join('');
    return `<div class="card"><label for="orderSearch">Поиск заказ-наряда</label><input id="orderSearch" value="${escAttr(state.search)}" placeholder="Номер ЗН, госномер или контрагент"><div class="grid two"><button data-action="search-orders">Найти в 1С</button><button data-action="scan-order-qr">Сканировать QR</button><button data-action="refresh-orders">Обновить из 1С</button></div></div>${orders.length ? `${rows}<div id="orderSearchEmpty" class="card empty"${matching.length ? ' hidden' : ''}>По указанному запросу заказ-наряды не найдены.</div>` : '<div class="card empty">1С не вернула доступные заказ-наряды.</div>'}`;
  }

  function renderSelectedCard() {
    const order = currentOrder();
    if (!order) return '<div class="card empty">Выберите заказ-наряд для продолжения.</div>';
    const defectRef = order.defectDocumentRef || order._defectSheet?.documentRef;
    const defectCell = defectRef
      ? `<button class="stat stat-button" data-action="open-defect-chat" title="Открыть историю дефектовки"><span class="tiny">Дефектовка</span><br><b>Создана</b><span class="tiny">Открыть историю</span></button>`
      : `<div class="stat"><span class="tiny">Дефектовка</span><br><b>Не создана</b></div>`;
    const packageLabel = order.packageNumber ? `${order.packageNumber} · ${order.packageStatus}` : order.packageStatus;
    const mileage = order.mileage ? ` · Пробег: ${esc(order.mileage)} км` : '';
    return `<div class="card"><div class="row"><h2>ЗН ${esc(order.num)}</h2><span class="badge ${statusClass(order.status)}">${esc(order.status)}</span></div><p><b>${esc(order.car)}</b> · ${esc(order.plate)}${mileage}</p><p class="tiny">${esc(order.client)}${order.contact ? ` / ${esc(order.contact)}` : ''}</p>${order.reason ? `<p class="reason"><b>Причина обращения:</b><br>${esc(order.reason)}</p>` : ''}<div class="summary"><div class="stat"><span class="tiny">Пост</span><br><b>${esc(order.post)}</b></div><div class="stat"><span class="tiny">Исполнитель</span><br><b>${esc(order.executor)}</b></div><button class="stat stat-button" data-action="package-select" title="Выбрать незакрытый пакет работ"><span class="tiny">Пакет УРВ</span><br><b>${esc(packageLabel)}</b><span class="tiny">Выбрать пакет</span></button>${defectCell}</div>${queuedOperationsStatus(order)}</div>`;
  }

  function renderOrdersView() {
    return renderOrderList() + renderSelectedCard() + (currentOrder() ? `<div class="card"><h2>Меню заказ-наряда</h2><div class="grid two"><button data-action="view" data-view="mp">Раздел МП</button><button data-action="view" data-view="executor">Исполнитель</button><button data-action="view" data-view="tech">Технолог</button><button data-action="view" data-view="clients">B2B с клиентом</button><button data-action="view" data-view="chat">Чат отделов</button><button data-action="load-order">Обновить карточку</button></div></div>` : '');
  }

  function acceptanceHasPhoto(order = currentOrder()) {
    const acceptanceEntries = order?._acceptance?.entries || [];
    return acceptanceEntries.some(entry => entry.type === 'photo' && entry.file);
  }

  function documentCompletionLocked(documentRef) {
    const ref=String(documentRef || '');
    if(!ref) return false;
    return state.queuedOperations.some(item=>item.kind==='complete' && item.documentKey===ref)
      || ['acceptance:'+ref,'defects:'+ref].includes(state.completionStatus?.key);
  }

  async function assertDocumentEditable(documentRef, session=sessionSnapshot()) {
    const operations=await operationQueue.list(session.scope); assertSession(session,session.scope);
    if(documentCompletionLocked(documentRef) || operations.some(item=>item.kind==='complete' && item.documentKey===String(documentRef))) {
      throw Object.assign(new Error('Завершение уже сохранено. Изменение документа недоступно; статус и отчёт находятся в очереди.'),{code:'DOCUMENT_COMPLETION_PENDING'});
    }
  }

  function processProgress(process, processKey) {
    if (processKey === '_acceptance') {
      const fields = (process.form?.fields || []).filter(field => field.required && /mileage|odometer|пробег/i.test(field.id));
      const questions = (process.survey?.questions || []).filter(question => question.required);
      const photoRequired = process.photo?.required !== false;
      const total = fields.length + questions.length + Number(photoRequired);
      const done = fields.filter(field => answered(process.values?.[field.id])).length
        + questions.filter(question => answered(process.answers?.[question.id])).length
        + Number(photoRequired && acceptanceHasPhoto());
      return { done, total, pct: total ? Math.round(done / total * 100) : 0 };
    }
    const fields = (process.form?.fields || []).filter(field => field.required);
    const questions = (process.survey?.questions || []).filter(question => question.required);
    const total = fields.length + questions.length;
    const fieldDone = fields.filter(field => answered(process.values?.[field.id])).length;
    const questionDone = questions.filter(question => answered(process.answers?.[question.id])).length;
    return { done: fieldDone + questionDone, total, pct: total ? Math.round((fieldDone + questionDone) / total * 100) : 0 };
  }

  function answered(value) {
    if (Array.isArray(value)) return value.length > 0;
    return value !== undefined && value !== null && String(value).trim() !== '';
  }

    function renderField(processKey, field, process) {
        const disabled=documentCompletionLocked(process.documentRef)?' disabled':'';
        const value = process.values?.[field.id] ?? field.value ?? '';

        const isEmpty =
            value == null ||
            value === false ||
            String(value).trim() === '';

        const error = Boolean(
            field.required && (isEmpty || process.errors?.has(`field:${field.id}`))
        );

        const label = `${esc(field.label)}${field.required ? ' <span class="required">*</span>' : ''}${field.unit ? `, ${esc(field.unit)}` : ''}`;

        if (field.type === 'select') {
            return `<label>${label}</label><select class="${error ? 'field-error' : ''}" data-process-input="${processKey}" data-field="${escAttr(field.id)}"${disabled}><option value="">Выберите значение</option>${(field.options || []).map(option => `<option value="${escAttr(option.value)}" ${String(value) === String(option.value) ? 'selected' : ''}>${esc(option.label)}</option>`).join('')}</select>${error ? '<div class="error-text">Поле обязательно</div>' : ''}`;
        }

        const tag = field.type === 'textarea' ? 'textarea' : 'input';
        const type = (field.type === 'textarea' ? '' : ` type="${field.type}"`) + disabled;
        const inputId = `field-${processKey}-${field.id}`;
        const textControl = tag === 'textarea'
            ? `<textarea id="${inputId}"${type} class="${error ? 'field-error' : ''}" data-process-input="${processKey}" data-field="${escAttr(field.id)}" placeholder="${escAttr(field.placeholder ?? '')}">${esc(String(value ?? ''))}</textarea>`
            : `<input id="${inputId}"${type} class="${error ? 'field-error' : ''}" data-process-input="${processKey}" data-field="${escAttr(field.id)}" placeholder="${escAttr(field.placeholder ?? '')}" value="${escAttr(String(value ?? ''))}">`;

        return `<label>${label}</label>${textControl}${error ? '<div class="error-text">Поле обязательно</div>' : ''}`;
    }

  function renderQuestion(processKey, question, process) {
    const disabled=documentCompletionLocked(process.documentRef)?' disabled':'';
    const value = process.answers?.[question.id];
    const done = answered(value);
    const error = process.errors?.has(`question:${question.id}`);
    const heading = `<div class="question-title">${esc(question.text)}${question.required ? ' <span class="required">*</span>' : ''}</div>${question.hint ? `<div class="tiny">${esc(question.hint)}</div>` : ''}`;
    if (['text','textarea','number'].includes(question.type)) {
      const tag = question.type === 'textarea' ? 'textarea' : 'input';
      const type = (question.type === 'textarea' ? '' : ` type="${question.type}"`) + disabled;
      const inputId = `question-${processKey}-${question.id}`;
      const textControl = tag === 'textarea'
        ? `<textarea id="${inputId}"${type} data-process-answer="${processKey}" data-question="${escAttr(question.id)}">${esc(value || '')}</textarea>`
        : `<input id="${inputId}"${type} data-process-answer="${processKey}" data-question="${escAttr(question.id)}" value="${escAttr(value || '')}">`;
      return `<div class="question ${done ? 'done' : ''} ${error ? 'field-error' : ''}">${heading}${textControl}${error ? '<div class="error-text">Ответ обязателен</div>' : ''}</div>`;
    }
    const options = question.type === 'boolean' && !question.options.length ? [{value:'true',label:'Да'},{value:'false',label:'Нет'}] : question.options;
    if (question.type === 'select') return `<div class="question ${done ? 'done' : ''} ${error ? 'field-error' : ''}">${heading}<select data-process-answer="${processKey}" data-question="${escAttr(question.id)}"${disabled}><option value="">Выберите ответ</option>${options.map(option => `<option value="${escAttr(option.value)}" ${String(value) === String(option.value) ? 'selected' : ''}>${esc(option.label)}</option>`).join('')}</select>${error ? '<div class="error-text">Ответ обязателен</div>' : ''}</div>`;
    return `<div class="question ${done ? 'done' : ''} ${error ? 'field-error' : ''}">${heading}<div class="answers">${options.map(option => { const selected = Array.isArray(value) ? value.includes(option.value) : String(value ?? '') === String(option.value); return `<button class="answer ${selected ? 'selected' : ''}" data-action="answer-option" data-process="${processKey}" data-question="${escAttr(question.id)}" data-value="${escAttr(option.value)}" data-type="${question.type}"${disabled}>${selected ? '✓ ' : ''}${esc(option.label)}</button>`; }).join('')}</div>${error ? '<div class="error-text">Ответ обязателен</div>' : ''}</div>`;
  }

  function renderProcess(processKey, process, completeAction, completeLabel) {
    if (!process?.active) return '';
    const progress = processProgress(process, processKey);
    const hasContent = (process.form?.fields?.length || 0) + (process.survey?.questions?.length || 0) > 0;
    const completionKey = processKey === '_acceptance' ? `acceptance:${process.documentRef || ''}` : '';
    const completing = Boolean(completionKey) && state.completionKey === completionKey;
    const savedCompletion=state.queuedOperations.find(item=>item.kind==='complete' && item.documentKey===String(process.documentRef));
    const completionStatus = state.completionStatus?.key === completionKey ? state.completionStatus : savedCompletion ? {key:completionKey,stage:['failed','invalid'].includes(savedCompletion.status)?'error':'waiting'} : null;
    const completionText = completionStatus?.stage === 'saving' ? 'Сохраняем завершение…'
      : completionStatus?.stage === 'sending' ? `Отправка ${completionStatus.sent}/${completionStatus.total}…`
      : completionStatus?.stage === 'waiting' ? 'Ожидание отправки файлов…'
      : completionStatus?.stage === 'completing' ? 'Завершение…'
      : completionStatus?.stage === 'error' ? 'Ошибка отправки — откройте отчёт'
      : completing ? 'Подтверждаем отправку…' : '';
    const completionBusy = Boolean(completionStatus) && completionStatus.stage !== 'error';
    const completion = processKey === '_quality'
      ? `<div class="grid two quality-decision-actions"><button class="success" data-action="complete-quality" data-result="passed" ${!hasContent || state.busy ? 'disabled' : ''}>Выезд разрешен</button><button class="danger" data-action="complete-quality" data-result="failed" ${!hasContent || state.busy ? 'disabled' : ''}>Выезд запрещен</button></div>`
      : `<button class="primary" data-action="${completeAction}" ${!hasContent || state.busy || completionStatus || documentCompletionLocked(process.documentRef) ? 'disabled' : ''} aria-busy="${completionBusy || completing}">${completionText ? `${completionBusy || completing ? '<span class="spinner"></span> ' : ''}${esc(completionText)}` : esc(completeLabel)}</button>`;
    return `<div class="card" data-process-card="${processKey}"><div class="section-title"><div><h2>${esc(process.survey?.title || process.form?.title || 'Форма из 1С')}</h2><div class="tiny">Документ 1С: ${esc(process.documentRef || 'ссылка не возвращена')}</div></div><span data-process-progress class="badge ${progress.done === progress.total && progress.total ? 'ok' : 'warn'}">${progress.done}/${progress.total}</span></div>${process.form?.hint ? `<p class="muted">${esc(process.form.hint)}</p>` : ''}${process.survey?.hint ? `<p class="muted">${esc(process.survey.hint)}</p>` : ''}<div class="progress"><span data-process-bar style="width:${progress.pct}%"></span></div>${hasContent ? (process.form.fields.map(field => renderField(processKey, field, process)).join('') + process.survey.questions.map(question => renderQuestion(processKey, question, process)).join('')) : '<div class="empty">1С создала документ, но не вернула схему полей и вопросов. Продолжение заблокировано.</div>'}${processKey === '_acceptance' ? renderAcceptancePhoto(process) : ''}${completion}</div>`;
  }

  function renderAcceptancePhoto(process) {
    const done = acceptanceHasPhoto();
    const required = process.photo?.required !== false;
    return `<div class="question ${done ? 'done' : ''} ${!done && process.errors?.has('photo') ? 'field-error' : ''}"><div class="question-title">Фотография автомобиля${required ? ' <span class="required">*</span>' : ''}</div><p class="tiny">${done ? 'Фотография отправлена в 1С' : 'Добавьте фотографию или видео.'}</p><button data-action="open-acceptance-photo"${documentCompletionLocked(process.documentRef)?' disabled':''}>Добавить фото/видео</button>${!done && process.errors?.has('photo') ? '<div class="error-text">Отправьте хотя бы одну фотографию</div>' : ''}</div>`;
  }

  function updateProcessProgress(processKey) {
    if (processKey !== '_acceptance') return;
    const process = currentOrder()?.[processKey];
    if (!process) return;
    const card = document.querySelector(`[data-process-card="${processKey}"]`);
    if (!card) return;
    const progress = processProgress(process, processKey);
    const badge = card.querySelector('[data-process-progress]');
    badge.textContent = `${progress.done}/${progress.total}`;
    badge.classList.toggle('ok', progress.total > 0 && progress.done === progress.total);
    badge.classList.toggle('warn', !progress.total || progress.done !== progress.total);
    card.querySelector('[data-process-bar]').style.width = `${progress.pct}%`;
  }

  function renderMpView() {
    const order = currentOrder();
    if (!order) return renderSelectedCard();
    return renderSelectedCard() + `<div class="card"><h2>Действия МП</h2><div class="grid two"><button data-action="start-acceptance">Приём автомобиля</button><button data-action="open-acceptance-photo"${documentCompletionLocked(order._acceptance?.documentRef)?' disabled':''}>Добавить фото/видео</button><button data-action="choose-post">Выбрать пост</button><button data-action="assign-executor">Назначить исполнителя</button><button data-action="request-quality">Запросить контроль качества</button></div></div>` + renderProcess('_acceptance', order._acceptance, 'complete-acceptance', 'Завершить приём');
  }

  function renderExecutorView() {
    const order = currentOrder();
    if (!order) return renderSelectedCard();
    const packageReady = Boolean(order.packageRef) && !/закрыт|closed/i.test(order.packageStatus);
    const packageRunning = /в работе|работает|started|running/i.test(order.packageStatus);
    return renderSelectedCard() + `<div class="card"><h2>Действия исполнителя</h2><div class="grid two"><button data-action="start-executor-work">Начать работу</button><button data-action="open-defect-chat">Добавить дефект</button><button data-action="package-create">Создать пакет УРВ</button><button data-action="package-start" ${!packageReady || packageRunning ? 'disabled' : ''}>Старт</button><button data-action="package-pause" ${!packageReady || !packageRunning ? 'disabled' : ''}>Пауза</button><button data-action="package-close" ${!packageReady ? 'disabled' : ''}>Закрыть</button><button data-action="production">Выработка</button></div></div>` + renderProcess('_checklist', order._checklist, 'complete-checklist', 'Завершить контрольный лист');
  }

  function renderTechView() {
    const order = currentOrder();
    if (!order) return renderSelectedCard();
    return renderSelectedCard() + `<div class="card"><h2>Действия технолога</h2><div class="grid"><button data-action="start-quality">Выходной контроль</button><button data-action="service-history">История обслуживания</button></div></div>` + renderProcess('_quality', order._quality, 'complete-quality', 'Завершить выходной контроль');
  }

  function topicButton(topic, selected, type) {
    return `<button class="topic ${selected === topic.ref ? 'active' : ''} ${topic.common ? 'common' : ''}" data-action="select-${type}-topic" data-ref="${escAttr(topic.ref)}"><div class="topic-title"><span>${esc(topic.title)}${topic.common ? '<span class="topic-common-badge">Общий чат</span>' : ''}</span>${topic.unread ? `<span class="badge bad">${topic.unread}</span>` : ''}</div><div class="topic-preview">${esc(topic.subtitle || topic.lastMessage || 'Нет сообщений')}</div>${topic.orderNumber || topic.vehiclePlate ? `<div class="topic-preview">ЗН ${esc(topic.orderNumber)} · ${esc(topic.vehiclePlate)}</div>` : ''}</button>`;
  }

  function attachmentImageSource(file) {
    if (!file || !/^image\//i.test(file.mimeType || '')) return '';
    if (file.previewUrl || file.downloadUrl) return file.previewUrl || file.downloadUrl;
    if (!file.contentBase64) return '';
    return String(file.contentBase64).startsWith('data:')
      ? file.contentBase64
      : `data:${file.mimeType};base64,${file.contentBase64}`;
  }

  function renderAttachment(file) {
    const source = attachmentImageSource(file);
    const preview = source ? `<img class="attachment-preview" src="${escAttr(source)}" alt="${escAttr(file.fileName)}" loading="lazy">` : '';
    return `<div class="attachment">${preview}<span>📎 ${esc(file.fileName)}</span></div>`;
  }

  function renderMessages(messages) {
    if (!messages?.length) return '<div class="empty">Сообщений пока нет.</div>';
    return `<div class="chat">${messages.map(message => `<div class="message ${message.side}"><span class="message-meta">${esc(message.author || 'Отправитель не указан')} · ${esc(FEATURES.dateTime(message.createdAt))}</span>${esc(message.text)}${message.attachments?.length ? `<div class="attachments">${message.attachments.map(renderAttachment).join('')}</div>` : ''}</div>`).join('')}</div>`;
  }

  function renderClientsView() {
    const topic = state.clientTopics.find(item => item.ref === state.selectedClientTopic);
    const messages = topic ? (state.clientMessages[topic.ref] || []) : [];
    return `<div class="card"><div class="section-title"><h2>B2B: клиенты</h2><button class="button" data-action="load-client-topics">Обновить</button></div><p class="muted">Все исходящие и входящие сообщения проходят через 1С.</p><div class="topic-list">${state.clientTopics.length ? state.clientTopics.map(item => topicButton(item, state.selectedClientTopic, 'client')).join('') : '<div class="empty">Темы не загружены или отсутствуют.</div>'}</div></div>${topic ? `<div class="card"><div class="section-title"><div><h2>${esc(topic.title)}</h2><div class="tiny">${esc(topic.subtitle)}</div></div><button class="button" data-action="refresh-client-messages">Обновить</button></div>${renderMessages(messages)}<label for="clientMessage">Сообщение клиенту</label><textarea id="clientMessage" placeholder="Введите сообщение"></textarea><button class="primary" data-action="send-client-message">Отправить через 1С</button><div class="grid two" style="margin-top:8px"><button data-action="client-photo">Фото и видео</button><button data-action="client-file">Файл</button></div></div>` : ''}`;
  }

  function renderChatView() {
    const group = state.chatGroups.find(item => item.ref === state.selectedChatGroup);
    const messages = group ? (state.chatMessages[group.ref] || []) : [];
    return `<div class="card"><div class="section-title"><h2>Чат между отделами</h2><button class="button" data-action="load-chat-groups">Обновить</button></div><p class="muted">Состав групп, права и история переписки загружаются из 1С.</p><div class="topic-list">${state.chatGroups.length ? state.chatGroups.map(item => topicButton(item, state.selectedChatGroup, 'chat')).join('') : '<div class="empty">Группы не загружены или отсутствуют.</div>'}</div></div>${group ? `<div class="card"><div class="section-title"><div><h2>${esc(group.title)}</h2><div class="tiny">${esc(group.subtitle)}</div></div><button class="button" data-action="refresh-chat-messages">Обновить</button></div>${renderMessages(messages)}<label for="chatMessage">Сообщение в группу</label><textarea id="chatMessage" placeholder="Введите сообщение"></textarea><button class="primary" data-action="send-chat-message">Отправить через 1С</button><div class="grid two" style="margin-top:8px"><button data-action="chat-photo">Фото и видео</button><button data-action="chat-file">Файл</button></div></div>` : ''}`;
  }

  function validateProcess(process, allRequired = true) {
    process.errors = new Set();
    for (const field of process.form?.fields || []) if ((allRequired || field.required) && !answered(process.values?.[field.id])) process.errors.add(`field:${field.id}`);
    for (const question of process.survey?.questions || []) if ((allRequired || question.required) && !answered(process.answers?.[question.id])) process.errors.add(`question:${question.id}`);
    return process.errors.size === 0;
  }

  async function startAcceptance() {
    const order = currentOrder(); if (!order || state.busy) return;
    if (order._acceptance?.active) return render();
    state.busy = true; toast('Создаём акт приёма в 1С…');
    try {
      const response = await call1C('/acceptance/start', orderPayload());
      order._acceptance = API.normalizeProcess(response, 'acceptance');
      // Use values already displayed from the 1C form in both validation and submission.
      for (const field of order._acceptance.form.fields) {
        if (order._acceptance.values[field.id] === undefined) order._acceptance.values[field.id] = field.value;
      }
      render(); toast('Акт приёма создан, анкета загружена из 1С');
    } finally { state.busy = false; render(); }
  }

  async function completeAcceptance() {
    const session = sessionSnapshot();
    const order = currentOrder(), process = order?._acceptance; if (!process) return;
    const key = `acceptance:${process.documentRef || ''}`;
    if (activeCompletions.has(key) || documentCompletionLocked(process.documentRef)) return;
    if (state.busy) return;
    validateProcess(process, false);
    if (process.photo?.required !== false && !acceptanceHasPhoto(order)) process.errors.add('photo');
    if (process.errors.size) { render(); toast('Заполните обязательные поля, ответы и отправьте фотографию, если она обязательна', true); return; }
    const scope = queueScope();
    state.completionKey=key;state.completionStatus={key,stage:'saving'};render();
    let queuedCompletion;
    try { queuedCompletion = await operationQueue.prepare({
      id:`${scope}:complete:acceptance:${process.documentRef}`, scope, method:'/acceptance/complete',
      body:orderPayload({ documentRef: process.documentRef, formValues: process.values, surveyRef: process.survey.surveyRef, surveyVersion: process.survey.version, answers: process.answers }),
      documentKey:String(process.documentRef || ''), requestId:requestId(), kind:'complete'
    }); } catch(error) {
      if(sessionCurrent(session)) {state.completionKey='';state.completionStatus=null;render();}
      throw error;
    }
    assertSession(session,scope);
    state.completionKey = key; state.completionStatus = {key, stage:'waiting'};
    await refreshQueuedOperations(); render();
    return runQueuedAcceptanceCompletion(String(process.documentRef || ''), queuedCompletion);
  }

  async function choosePost() {
    showSheet('Выбор поста', 'Получаем посты согласно правам пользователя', '<div class="loading"><span class="spinner"></span>Загрузка из 1С…</div>');
    try {
      const response = await call1C('/resources/posts/list', orderPayload());
      const items = API.extractItems(response, ['posts']).map(API.normalizeResource);
      $('sheetBody').innerHTML = items.length ? `<div class="grid">${items.map(item => `<button data-action="set-post" data-ref="${escAttr(item.ref)}" data-name="${escAttr(item.name)}" ${item.available ? '' : 'disabled'}><b>${esc(item.name)}</b>${item.description ? `<br><span class="tiny">${esc(item.description)}</span>` : ''}</button>`).join('')}</div>` : '<div class="empty">1С не вернула доступные посты.</div>';
    } catch (error) { $('sheetBody').innerHTML = `<div class="empty">${esc(error.message)}</div>`; }
  }

  async function setPost(ref, name) {
    const order = currentOrder(); if (!order) return;
    await call1C('/resources/posts/assign', orderPayload({ postRef: ref }));
    order.postRef = ref; order.post = name; closeSheet(); render(); toast('Пост назначен');
  }

  async function assignExecutor(other = false) {
    showSheet('Назначить исполнителя', other ? 'Все доступные сотрудники согласно правам пользователя' : 'В первую очередь показаны запланированные ресурсы', '<div class="loading"><span class="spinner"></span>Загрузка из 1С…</div>');
    try {
      const method = other ? '/resources/executors/list' : '/resources/executors/planned/list';
      const response = await call1C(method, orderPayload({ postRef: currentOrder()?.postRef || '' }));
      const items = API.extractItems(response, ['executors','employees','plannedExecutors']).map(API.normalizeResource);
      $('sheetBody').innerHTML = `${items.length ? `<div class="grid">${items.map(item => `<button data-action="set-executor" data-ref="${escAttr(item.ref)}" data-name="${escAttr(item.name)}" ${item.available ? '' : 'disabled'}><b>${esc(item.name)}</b>${item.description ? `<br><span class="tiny">${esc(item.description)}</span>` : ''}</button>`).join('')}</div>` : '<div class="empty">Исполнители не найдены.</div>'}${other ? '' : '<button class="secondary" style="margin-top:10px" data-action="assign-other-executor">Выбрать другого исполнителя</button>'}`;
    } catch (error) { $('sheetBody').innerHTML = `<div class="empty">${esc(error.message)}</div>`; }
  }

  async function setExecutor(ref, name) {
    const order = currentOrder(); if (!order) return;
    await call1C('/executor/assign', orderPayload({ employeeRef: ref, executorRef: ref, postRef: order.postRef || '', notifyExecutor: true }));
    order.executorRef = ref; order.executor = name; closeSheet(); render(); toast('Исполнитель назначен и уведомлён через 1С');
  }

  async function startExecutorWork() {
    const order = currentOrder(); if (!order) return;
    state.busy = true;
    try {
      const response = await call1C('/workshop/work/start', orderPayload({ executorRef: order.executorRef || state.user?.employeeRef || '' }));
      order._checklist = API.normalizeProcess(response, 'checklist');
      const packageData = response.package || response.data?.package;
      if (packageData) { order.packageRef = String(packageData.packageRef || packageData.ref || order.packageRef || ''); order.packageStatus = String(packageData.status || order.packageStatus); }
      render(); toast('Работа начата, контрольный лист загружен из 1С');
    } finally { state.busy = false; }
  }

  async function completeChecklist() {
    const order = currentOrder(), process = order?._checklist; if (!process) return;
    if (!validateProcess(process, true)) { render(); toast('Заполните все вопросы контрольного листа', true); return; }
    state.busy = true; render();
    try {
      await call1C('/checklist/complete', orderPayload({ documentRef: process.documentRef, surveyRef: process.survey.surveyRef, surveyVersion: process.survey.version, answers: process.answers, formValues: process.values }));
      order._checklist = null; render(); toast('Контрольный лист завершён и скрыт');
    } finally { state.busy = false; render(); }
  }

  let worktimeDraft = null;

  function renderWorktimeStep() {
    const d = worktimeDraft; if (!d) return;
    const button = (action, text) => `<button class="primary" data-action="${action}">${text}</button>`;
    let body = '';
    if (d.step === 'works') {
      body = `<h3>Работы без активных пакетов</h3>${d.works.length ? d.works.map(x => `<label class="setting-row"><input type="checkbox" data-worktime-work="${escAttr(x.ref)}" ${d.workRefs.includes(x.ref) ? 'checked' : ''}>${esc(x.name)}</label>`).join('') : '<p>В этом ЗН нет доступных работ без активных пакетов.</p>'}${d.works.length ? button('worktime-works-next','Подтвердить работы') : ''}`;
    } else if (d.step === 'employees') {
      const self = d.employees.find(x => x.ref === state.user?.employeeRef);
      body = `${self ? button('worktime-self','Делаю сам') : '<p>1С не вернула вас в списке доступных исполнителей.</p>'}<h3>Другие исполнители цеха</h3><p>Выберите исполнителей. Чтобы участвовать вместе с коллегами, отметьте «Я участвую».</p>${self ? `<label class="setting-row"><input type="checkbox" data-worktime-employee="${escAttr(self.ref)}" ${d.employeeRefs.includes(self.ref) ? 'checked' : ''}>Я участвую</label>` : ''}${d.employees.filter(x => x.ref !== self?.ref).map(x => `<label class="setting-row"><input type="checkbox" data-worktime-employee="${escAttr(x.ref)}" ${d.employeeRefs.includes(x.ref) ? 'checked' : ''}>${esc(x.name)}</label>`).join('')}${button('worktime-employees-next','Подтвердить исполнителей')}${button('worktime-back-works','Назад к работам')}`;
    } else if (d.step === 'shares') {
      body = `<h3>Распределение участия</h3><p>Сумма долей должна быть ровно 100%.</p>${d.employeeRefs.map(ref => `<label>${esc(d.employees.find(x => x.ref === ref)?.name)} — участие, %<input type="number" min="0.01" max="100" step="0.01" data-worktime-percent="${escAttr(ref)}" value="${escAttr(d.participants.find(p => p.employeeRef === ref)?.percent ?? '')}"></label>`).join('')}<button class="secondary worktime-equal-button" data-action="worktime-shares-equal">Распределить % поровну</button>${button('worktime-shares-next','Подтвердить распределение')}${button('worktime-back-employees','Назад к исполнителям')}`;
    } else {
      body = `<h3>Подтверждение пакета</h3><h4>Работы</h4><ul>${d.workRefs.map(ref => `<li>${esc(d.works.find(x => x.ref === ref)?.name)}</li>`).join('')}</ul><h4>Исполнители</h4><ul>${d.participants.map(p => `<li>${esc(d.employees.find(x => x.ref === p.employeeRef)?.name)} — ${p.percent}%</li>`).join('')}</ul>${button('worktime-submit','Подтвердить и создать пакет')}${!d.sent ? button('worktime-back-employees','Изменить исполнителей') : '<p>При повторе отправляется тот же состав с тем же идентификатором.</p>'}`;
    }
    showSheet('Создание пакета УРВ', ({works:'Шаг 1 · работы ЗН',employees:'Шаг 2 · исполнители',shares:'Шаг 3 · проценты',confirm:'Проверьте состав перед отправкой в 1С'})[d.step], body + '<p id="worktimeError" role="alert"></p>');
  }

  async function preparePackage() {
    if (!currentOrder() || state.busy) return;
    // Preserve an uncertain creation attempt rather than issuing a new ID.
    if (worktimeDraft?.sent && worktimeDraft.context.orderRef === (currentOrder().orderRef || currentOrder().id)) return renderWorktimeStep();
    state.busy = true;
    const context = orderPayload();
    worktimeDraft = null;
    showSheet('Создание пакета УРВ', 'Получаем работы без активных пакетов', '<p>Загрузка…</p>');
    try {
      const response = await call1C('/worktime/orders/works', {...context, withoutActivePackages:true});
      const data = response.data || response;
      const workshopRef = String(data.workshopRef || currentOrder()?.workshopRef || state.user?.workshopRef || '');
      if (!workshopRef) throw new Error('1С не вернула цех для заказ-наряда');
      const works = API.extractItems(response, ['works']).filter(x => x.available !== false && x.hasActivePackage !== true && !x.activePackageRef && !(x.activePackages?.length)).map(x => ({ref:String(x.workRef || x.ref || ''),name:String(x.name || x.title || x.workRef || ''),available:true})).filter(x => x.ref);
      worktimeDraft = {context,workshopRef,works,employees:[],workRefs:[],employeeRefs:[],participants:[],step:'works',clientPackageId:requestId(),busy:false,sent:false};
      renderWorktimeStep();
    } catch(error) { $('sheetBody').innerHTML = `<p role="alert">${esc(error.message)}</p><button data-action="package-create">Повторить загрузку</button>`; }
    finally { state.busy = false; }
  }

  async function worktimeStep(action) {
    const d = worktimeDraft; if (!d || d.busy || state.busy || d.sent) return;
    try {
      if ((currentOrder()?.orderRef || currentOrder()?.id) !== d.context.orderRef) throw new Error('Заказ-наряд изменился. Откройте форму заново');
      if (action === 'worktime-works-next') {
        d.workRefs = [...$('sheetBody').querySelectorAll('[data-worktime-work]:checked')].map(el => el.dataset.worktimeWork);
        if (!d.workRefs.length) throw new Error('Выберите хотя бы одну работу');
        if (d.workRefs.some(ref => !d.works.some(x => x.ref === ref))) throw new Error('Выбрана недоступная работа');
        d.busy = true; state.busy = true;
        const response = await call1C('/worktime/executors/list', {...d.context,workshopRef:d.workshopRef});
        d.employees = API.extractItems(response,['executors','employees']).filter(x => x.available !== false && (!x.workshopRef || String(x.workshopRef) === d.workshopRef)).map(x => ({ref:String(x.employeeRef || x.ref || ''),name:String(x.name || x.fullName || x.employeeRef || '')})).filter(x => x.ref);
        d.employeeRefs = d.employeeRefs.filter(ref => d.employees.some(x => x.ref === ref));
        d.step = 'employees';
      } else if (action === 'worktime-self' || action === 'worktime-employees-next') {
        d.employeeRefs = action === 'worktime-self' ? [state.user?.employeeRef] : [...$('sheetBody').querySelectorAll('[data-worktime-employee]:checked')].map(el => el.dataset.worktimeEmployee);
        if (!d.employeeRefs.length || d.employeeRefs.some(ref => !d.employees.some(x => x.ref === ref))) throw new Error('Выберите доступных исполнителей');
        d.participants = d.employeeRefs.length === 1 ? [{employeeRef:d.employeeRefs[0],percent:100}] : d.participants.filter(p => d.employeeRefs.includes(p.employeeRef));
        d.step = d.employeeRefs.length === 1 ? 'confirm' : 'shares';
      } else if (action === 'worktime-shares-equal') {
        const totalCents = 10000, count = d.employeeRefs.length;
        const base = Math.floor(totalCents / count), remainder = totalCents - base * count;
        d.participants = d.employeeRefs.map((employeeRef, index) => ({employeeRef, percent:(base + (index < remainder ? 1 : 0)) / 100}));
      } else if (action === 'worktime-shares-next') {
        const values = new Map([...$('sheetBody').querySelectorAll('[data-worktime-percent]')].map(el => [el.dataset.worktimePercent,Number(el.value)]));
        d.participants = window.ITUS_WORKTIME.participation(d.employeeRefs.map(employeeRef => ({employeeRef,percent:values.get(employeeRef)})));
        d.step = 'confirm';
      } else if (action === 'worktime-back-works') d.step = 'works';
      else if (action === 'worktime-back-employees') d.step = 'employees';
      renderWorktimeStep();
    } catch(error) { $('worktimeError').textContent = error.message; }
    finally { d.busy = false; state.busy = false; }
  }

  function normalizeWorktimePackage(item) {
    const status = item?.status?.title || item?.status?.name || item?.statusTitle || (typeof item?.status === 'string' ? item.status : '') || item?.status?.code || 'Не стартовал';
    return { packageRef:String(item?.packageRef || item?.ref || item?.id || ''), number:String(item?.packageNumber || item?.number || item?.name || ''), status:String(status) };
  }

  function availablePackages(order, remote = []) {
    const current = order.packageRef ? [{packageRef:order.packageRef, packageNumber:order.packageNumber, status:order.packageStatus}] : [];
    return [...remote, ...(order.worktimePackages || []), ...current].map(normalizeWorktimePackage)
      .filter((item, index, all) => item.packageRef && !/закрыт|closed/i.test(item.status) && all.findIndex(x => x.packageRef === item.packageRef) === index);
  }

  function renderPackageChoices(packages, warning = '') {
    $('sheetBody').innerHTML = `${warning ? `<p class="tiny">${esc(warning)}</p>` : ''}${packages.length ? `<div class="grid">${packages.map(item => `<button data-action="package-use" data-ref="${escAttr(item.packageRef)}" data-number="${escAttr(item.number)}" data-status="${escAttr(item.status)}"><b>${esc(item.number || 'Пакет УРВ')}</b><br><span class="tiny">${esc(item.status)}</span></button>`).join('')}</div>` : '<div class="empty">У этого ЗН нет незакрытых пакетов работ.</div>'}`;
  }

  async function selectPackage() {
    const order = currentOrder(); if (!order || state.busy) return;
    showSheet('Пакеты работ', `Незакрытые пакеты ЗН ${order.num}`, '<div class="loading"><span class="spinner"></span>Загрузка из 1С…</div>');
    try {
      const response = await call1C('/worktime/packages/list', orderPayload({onlyOpen:true}));
      const remote = API.extractItems(response, ['packages','worktimePackages']).map(normalizeWorktimePackage);
      renderPackageChoices(availablePackages(order, remote));
    } catch (error) {
      const embedded = availablePackages(order);
      if (embedded.length) renderPackageChoices(embedded, 'Показаны пакеты из карточки ЗН; обновить полный список из 1С не удалось.');
      else $('sheetBody').innerHTML = `<div class="empty">${esc(error.message)}</div><button data-action="package-select">Повторить</button>`;
    }
  }

  function usePackage(ref, number, status) {
    const order = currentOrder(); if (!order || !ref) return;
    order.packageRef = ref; order.packageNumber = number || ''; order.packageStatus = status || 'Не стартовал';
    closeSheet(); render(); toast('Пакет УРВ выбран');
  }

  async function submitPackage() {
    const d = worktimeDraft; if (!d || d.step !== 'confirm' || d.busy || state.busy) return;
    try {
      if ((currentOrder()?.orderRef || currentOrder()?.id) !== d.context.orderRef) throw new Error('Заказ-наряд изменился. Откройте форму заново');
      const payload = {...d.context,workshopRef:d.workshopRef,workRefs:d.workRefs,participants:d.participants,clientPackageId:d.clientPackageId};
      window.ITUS_WORKTIME.validateRequest('/worktime/packages/create',payload);
      d.busy = true; state.busy = true;
      $('sheetBody').querySelectorAll('button').forEach(el => el.disabled = true);
      const checked = await call1C('/worktime/participation/validate',payload);
      if ((checked.data || checked).valid !== true) throw new Error('1С не подтвердила распределение участия');
      d.sent = true;
      const response = await call1C('/worktime/packages/create',payload);
      const data = response.package || response.data?.package;
      if (!data?.packageRef) throw new Error('1С не вернула ссылку пакета. Повторите подтверждение с тем же составом');
      const order = state.orders.find(x => (x.orderRef || x.id) === d.context.orderRef);
      if (order) { order.packageRef = String(data.packageRef); order.packageStatus = String(data.status || 'Создан'); }
      worktimeDraft = null; closeSheet(); render(); toast('Пакет создан из выбранных работ');
    } catch(error) { renderWorktimeStep(); $('worktimeError').textContent = error.message; }
    finally { d.busy = false; state.busy = false; }
  }

  async function packageAction(action) {
    const order = currentOrder(); if (!order || state.busy) return;
    const map = { start: '/worktime/packages/start', pause: '/worktime/packages/pause', close: '/worktime/packages/close' };
    if (!map[action]) throw new Error('Неизвестное действие пакета');
    const payload = orderPayload({ packageRef: order.packageRef || '' });
    window.ITUS_WORKTIME.validateRequest(map[action], payload);
    state.busy = true;
    try {
      const response = await call1C(map[action], payload);
      const data = response.package || response.data?.package || response.data || response;
      order.packageRef = String(data.packageRef || data.ref || order.packageRef);
      order.packageStatus = String(data.status || ({start:'В работе',pause:'Перерыв',close:'Закрыт'}[action]));
      render(); toast('Пакет УРВ: ' + order.packageStatus);
    } finally { state.busy = false; }
  }

  async function showProduction() {
    showSheet('Выработка', 'Количество закрытых часов текущего пользователя', '<div class="loading"><span class="spinner"></span>Получаем данные из 1С…</div>');
    try {
      const response = await call1C('/worktime/production', { employeeRef: state.user?.employeeRef || '', period: 'today' });
      const data = response.production || response.data?.production || response.data || response;
      const grades = Array.isArray(data.grades) ? data.grades : [];
      const total = grades.reduce((sum, item) => sum + (Number.isFinite(Number(item.closedHours)) ? Number(item.closedHours) : 0), 0);
      const rows = grades.length
        ? grades.map(item => `<tr><td>${esc(item.grade)}</td><td>${esc(item.closedHours)}</td></tr>`).join('')
        : '<tr><td colspan="2">Нет закрытых н/ч</td></tr>';
      $('sheetBody').innerHTML = `<div class="table-wrap"><table class="production-table"><thead><tr><th>Разряд</th><th>Количество закрытых н/ч</th></tr></thead><tbody>${rows}</tbody><tfoot><tr><th>Итого</th><th>${esc(total)}</th></tr></tfoot></table></div><button class="primary" data-action="close-sheet">Закрыть</button>`;
    } catch (error) { $('sheetBody').innerHTML = `<div class="empty">${esc(error.message)}</div><button class="primary" data-action="close-sheet">Закрыть</button>`; }
  }

  async function startQuality(source = 'manual') {
    const order = currentOrder(); if (!order) return;
    state.busy = true;
    try {
      const response = await call1C('/quality/start', orderPayload({ source }));
      order._quality = API.normalizeProcess(response, 'qualityControl');
      render(); toast('Документ контроля качества создан, анкета загружена');
    } finally { state.busy = false; }
  }

  async function completeQuality(result = '') {
    const order = currentOrder(), process = order?._quality; if (!process) return;
    if (result) process.answers = { ...process.answers, result };
    if (!validateProcess(process, false)) { render(); toast('Заполните обязательные поля выходного контроля', true); return; }
    state.busy = true; render();
    try {
      await call1C('/quality/complete', orderPayload({ documentRef: process.documentRef, surveyRef: process.survey.surveyRef, surveyVersion: process.survey.version, result: result || process.answers?.result || '', answers: process.answers, formValues: process.values }));
      order._quality = null; render(); toast('Выходной контроль завершён и скрыт');
    } finally { state.busy = false; render(); }
  }

  async function showCurrentAppeal() {
    showSheet('Текущее обращение', 'Причина обращения загружается из 1С', '<div class="loading"><span class="spinner"></span>Загрузка…</div>');
    try {
      const response = await call1C('/quality/current-appeal', orderPayload());
      const appeal = response.appeal || response.data?.appeal || response.data || {};
      $('sheetBody').innerHTML = `<div class="reason"><b>Причина обращения:</b><br>${esc(appeal.reason || appeal.text || currentOrder()?.reason || 'Не заполнена')}</div>${appeal.createdAt ? `<p class="tiny">Создано: ${esc(FEATURES.dateTime(appeal.createdAt))}</p>` : ''}<button class="primary" data-action="close-sheet">Закрыть</button>`;
    } catch (error) { $('sheetBody').innerHTML = `<div class="empty">${esc(error.message)}</div>`; }
  }

  async function openServiceHistory() {
    showSheet('История обслуживания', 'Загружаем предыдущие заезды автомобиля из 1С', '<div class="loading"><span class="spinner"></span>Загрузка…</div>');
    try {
      const order = currentOrder();
      const mileage = String(order?.mileage ?? '').trim();
      const response = await call1C('/quality/service-history', orderPayload(/^\d+$/.test(mileage) ? { mileage: Number(mileage) } : {}));
      const data = response.data || response;
      const visits = API.extractItems(response, ['visits','history','items']);
      if (!visits.length) { $('sheetBody').innerHTML = '<div class="empty">1С не вернула историю обслуживания по этому автомобилю.</div>'; return; }
      $('sheetBody').innerHTML = `<div class="service-history">${visits.map((visit, index) => {
        const number = visit.orderNumber || visit.number || visit.orderNum || `Заезд ${index + 1}`;
        const reason = visit.reason || visit.appeal || visit.description || 'Не указана';
        const goods = Array.isArray(visit.goods) ? visit.goods : (Array.isArray(visit.products) ? visit.products : []);
        const works = Array.isArray(visit.works) ? visit.works : [];
        const recommendations = visit.recommendations || visit.recommendation || 'Нет';
        const mileageLabel = visit.mileage ?? visit.odometer;
        return `<article class="entry"><div class="entry-head"><b>ЗН ${esc(number)}</b><span>${esc(FEATURES.dateTime(visit.closedAt || visit.date || visit.createdAt))}</span></div>${mileageLabel !== undefined && mileageLabel !== null && mileageLabel !== '' ? `<p><b>Пробег:</b> ${esc(mileageLabel)} км</p>` : ''}<p><b>Причина обращения:</b> ${esc(reason)}</p>${goods.length ? `<p><b>Товары:</b> ${goods.map(item => esc(typeof item === 'string' ? item : item.name || item.title || item.description || '')).filter(Boolean).join(', ')}</p>` : ''}${works.length ? `<p><b>Работы:</b> ${works.map(item => esc(typeof item === 'string' ? item : item.name || item.title || item.description || '')).filter(Boolean).join(', ')}</p>` : ''}<p><b>Рекомендации:</b> ${esc(recommendations)}</p></article>`;
      }).join('')}</div><button class="secondary" data-action="close-sheet">Закрыть</button>`;
    } catch (error) { $('sheetBody').innerHTML = `<div class="empty">${esc(error.message)}</div><button class="primary" data-action="close-sheet">Закрыть</button>`; }
  }

  async function requestQualityControl() {
    const order = currentOrder(); if (!order || state.busy) return;
    state.busy = true;
    try {
      await call1C('/quality/request', orderPayload());
      toast('Запрос на контроль качества отправлен технологу');
    } finally { state.busy = false; }
  }

  async function searchOrders() {
    const search = String(state.search || '').trim();
    if (!search) return toast('Введите номер ЗН, госномер или контрагента', true);
    const response = await call1C('/orders/search', { search, searchBy: ['orderNumber','vehiclePlate','counterparty'] });
    const items = API.extractOrders(response).map(API.mapOrder);
    if (!items.length) return toast('Заказ-наряд не найден', true);
    items.forEach(mergeOrder); state.selectedOrderId = items[0].id; state.view = viewForCurrentUser(); render();
  }

  function showOrderQrManual(message = '') {
    orderQrScanner?.stop?.();
    orderQrScanner = null;
    const note = message ? `<div class="empty">${esc(message)}</div>` : '';
    showSheet('QR-код заказ-наряда', 'Введите ровно пять символов из QR', `${note}<label for="orderQr">Последние пять символов номера ЗН</label><input id="orderQr" maxlength="5" autocomplete="off" autocapitalize="characters" spellcheck="false"><button class="primary" data-action="submit-order-qr">Найти в 1С</button>`);
  }

  function showOrderQrChoices(items, suffix) {
    showSheet('Выберите заказ-наряд', `Найдено совпадений: ${items.length}`, items.map(order =>
      `<button class="order-qr-choice" data-action="select-order-qr" data-ref="${escAttr(order.orderRef || order.id)}"><b>ЗН ${esc(order.num)}</b><span>${esc(order.car)} · ${esc(order.plate)}</span></button>`
    ).join('') + `<button class="secondary" data-action="manual-order-qr">Искать другой код</button><p class="tiny">Совпадение по последним пяти символам: ${esc(suffix)}</p>`);
  }

  async function searchOrderQr(rawValue) {
    let suffix;
    try { suffix = window.ITUS_ORDER_QR.normalize(rawValue); }
    catch (error) { showOrderQrManual(error.message); return; }
    if (activeOrderQrSearch?.suffix === suffix) return activeOrderQrSearch.promise;
    lastOrderQrValue = suffix;
    showSheet('Поиск заказ-наряда', `Код: ${suffix}`, '<div class="loading"><span class="spinner"></span>Поиск в 1С…</div>');
    const promise = (async () => {
      try {
        // /orders/search is queried explicitly: QR search must not be limited to the locally loaded order list.
        // The server must search order numbers available to the authenticated user; the client enforces exact suffix matching.
        const response = await call1C('/orders/search', { search: suffix, searchBy: ['orderNumber'] });
        const items = window.ITUS_ORDER_QR.filterMatches(API.extractOrders(response).map(API.mapOrder), suffix);
        items.forEach(mergeOrder);
        if (!items.length) {
          showOrderQrManual(`Заказ-наряд, номер которого оканчивается на «${suffix}», не найден. Проверьте код или используйте ручной поиск.`);
          return;
        }
        if (items.length > 1) { showOrderQrChoices(items, suffix); return; }
        state.selectedOrderId = items[0].id;
        state.view = viewForCurrentUser();
        closeSheet();
        render();
      } catch (error) {
        showOrderQrManual(error.message || 'Не удалось выполнить поиск в 1С');
      }
    })().finally(() => {
      if (activeOrderQrSearch?.promise === promise) activeOrderQrSearch = null;
    });
    activeOrderQrSearch = { suffix, promise };
    return promise;
  }

  function openOrderQrScanner() {
    orderQrScanner?.stop?.();
    showSheet('Сканирование QR заказ-наряда', 'Наведите заднюю камеру на QR-код из пяти символов', '<video id="orderQrVideo" class="order-qr-video" autoplay muted playsinline></video><div class="order-qr-actions"><button class="secondary" data-action="manual-order-qr">Ввести вручную</button><button class="secondary" data-action="close-sheet">Отмена</button></div>');
    const video = $('orderQrVideo');
    orderQrScanner = window.ITUS_ORDER_QR.createScanner({
      onStream(stream) { state.cameraStream = stream; },
      onResult(value) {
        if (value === lastOrderQrValue && activeOrderQrSearch) return activeOrderQrSearch.promise;
        return searchOrderQr(value);
      },
      onFailure(error) { showOrderQrManual(`Не удалось открыть камеру: ${error.message || 'доступ запрещён'}. Доступен ручной ввод.`); }
    });
    void orderQrScanner.start(video);
  }

  function downloadFile(file) {
    if (file.downloadUrl) {
      const link = document.createElement('a'); link.href = file.downloadUrl; link.target = '_blank'; link.rel = 'noopener'; link.download = file.fileName || ''; link.click(); return;
    }
    if (!file.contentBase64) return toast('Файл не содержит данных для скачивания', true);
    const bytes = Uint8Array.from(atob(file.contentBase64), char => char.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: file.mimeType || 'application/octet-stream' }));
    const link = document.createElement('a'); link.href = url; link.download = file.fileName || 'document.pdf'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const pendingDefectSheets = new Map();
  const pendingDefectEntries = new Map();
  const activeEntrySubmissions = new Map();

  function defectEntryKey(order, documentRef, kind, value) {
    const identity = typeof value === 'string'
      ? value.trim()
      : [value?.name || '', value?.size || 0, value?.lastModified || 0, value?.type || ''].join(':');
    return [order?.orderRef || order?.id || '', documentRef || '', kind, identity].join('|');
  }

  function defectEntryId(key) {
    const existing = pendingDefectEntries.get(key);
    if (existing) return existing;
    const id = requestId();
    pendingDefectEntries.set(key, id);
    return id;
  }

  function finishDefectEntry(key, id) {
    if (pendingDefectEntries.get(key) === id) pendingDefectEntries.delete(key);
  }

  async function sendQueuedEntry(attemptKey, method, body) {
    const session = sessionSnapshot();
    const scope = queueScope();
    const queueId = `${scope}:entry:${attemptKey}`;
    if (activeEntrySubmissions.has(queueId)) return activeEntrySubmissions.get(queueId);
    const submission = (async () => {
      const existing = await operationQueue.get(queueId); assertSession(session,scope);
      const proposedId = existing?.clientEntryId || defectEntryId(attemptKey);
      const operation = await operationQueue.prepare({
        id: queueId, scope, method, clientEntryId: proposedId,
        documentKey: String(body.documentRef || ''),
        body: { ...body, clientEntryId: proposedId, entry: { ...body.entry, clientEntryId: proposedId } },
        requestId: requestId(), kind: 'entry'
      });
      try {
        assertSession(session,scope);
        const response = await operationQueue.run(operation.id, {manual:operation.status==='failed'}); assertSession(session,scope);
        finishDefectEntry(attemptKey, operation.clientEntryId);
        return { response, operation };
      } catch (error) {
        showQueuedOperationError(error);
        throw error;
      }
    })();
    activeEntrySubmissions.set(queueId, submission);
    try { return await submission; }
    finally { activeEntrySubmissions.delete(queueId); }
  }

  function appendQueuedEntry(process, response, operation, fallback) {
    const raw = response.entry || response.data?.entry || { ...fallback, id: operation.clientEntryId };
    const entry = API.normalizeProcess({ entries:[raw] }, 'x').entries[0];
    process.entries = Array.isArray(process.entries) ? process.entries : [];
    if (!process.entries.some(item => String(item.id || '') === String(entry.id || operation.clientEntryId))) process.entries.push(entry);
    return entry;
  }

  async function runPreparedOperations(operations, {stopOnError = false, onProgress} = {}) {
    const session = sessionSnapshot();
    let sent = 0;
    for (const operation of operations) {
      assertSession(session,operation.scope);
      onProgress?.({sent, total:operations.length});
      try {
        await operationQueue.run(operation.id);
        assertSession(session,operation.scope);
        sent++;
        onProgress?.({sent, total:operations.length});
      } catch (error) {
        if (error.queuePaused) throw error;
        showQueuedOperationError(error);
        if (stopOnError) throw error;
      } finally { await refreshQueuedOperations(); }
    }
  }

  async function waitForDocumentEntries(documentKey, onProgress) {
    const session=sessionSnapshot();
    const pending = (await operationQueue.list(session.scope)).filter(item => item.kind === 'entry' && item.documentKey === documentKey);
    assertSession(session,session.scope);
    if (pending.length) await runPreparedOperations(pending, {stopOnError:true, onProgress});
    const remaining = (await operationQueue.list(session.scope)).filter(item => item.kind === 'entry' && item.documentKey === documentKey);
    assertSession(session,session.scope);
    if (remaining.length) throw new Error('Завершение недоступно: не все записи и вложения подтверждены 1С');
  }

  function acceptanceForDocument(documentKey) {
    const order = state.orders.find(item => String(item._acceptance?.documentRef || '') === String(documentKey));
    return order ? {order, process:order._acceptance} : {order:null, process:null};
  }

  async function runQueuedAcceptanceCompletion(documentKey, queuedCompletion = null) {
    return runQueuedDocumentCompletion(documentKey,queuedCompletion);
  }

  async function runQueuedDocumentCompletion(documentKey, queuedCompletion = null, {manual=false} = {}) {
    const session=sessionSnapshot();
    const operations = await operationQueue.list(session.scope); assertSession(session,session.scope);
    const operation = queuedCompletion || operations.find(item => item.kind === 'complete' && item.documentKey === documentKey);
    if (!operation) return;
    assertSession(session,operation.scope);
    const acceptance = operation.method === '/acceptance/complete';
    const key = `${acceptance?'acceptance':'defects'}:${documentKey}`;
    if (activeCompletions.has(key)) return activeCompletions.get(key);
    const orderRef = String(operation.body?.orderRef || operation.body?.orderId || '');
    const order = state.orders.find(item=>String(item.orderRef || item.id)===orderRef);
    const process = order?.[acceptance?'_acceptance':'_defectSheet'];
    const pendingEntries = operations.filter(item => item.kind === 'entry' && item.documentKey === documentKey);
    if (pendingEntries.length) {
      const failed = pendingEntries.some(item => item.status === 'invalid' || item.status === 'failed');
      state.completionKey = key;
      state.completionStatus = {key, stage:failed ? 'error' : 'waiting'};
      render();
      return;
    }
    const completion = (async () => {
      state.completionKey = key; state.completionStatus = {key, stage:'completing'}; render();
      try {
        await operationQueue.run(operation.id,{manual});
        assertSession(session,session.scope);
        const fields=process?.form?.fields || [], values=operation.body?.formValues || {};
        const mileageField = fields.find(field => /mileage|пробег/i.test(field.id));
        const hoursField = fields.find(field => /engineHours|hours|моточас/i.test(field.id));
        const reasonField = fields.find(field => /reason|appeal|причин/i.test(field.id));
        if (mileageField) order.mileage = String(values[mileageField.id] || '');
        if (hoursField) order.engineHours = String(values[hoursField.id] || '');
        if (reasonField) order.reason = String(values[reasonField.id] || '');
        state.completionStatus = {key, stage:'completed'};
        if(order) order[acceptance?'_acceptance':'_defectSheet'] = null;
        if(orderRef) await loadSingleOrder(orderRef,{select:false});
        assertSession(session,session.scope);
        toast(acceptance?'Приём завершён, данные сохранены в 1С':'Дефектовка завершена');
        return true;
      } catch (error) {
        if(error.queuePaused) throw error;
        state.completionStatus = {key, stage:'error'};
        showQueuedOperationError(error);
        return false;
      } finally {
        if(activeCompletions.get(key)===completion) activeCompletions.delete(key);
        if(sessionCurrent(session)) {
          if(state.completionKey===key) state.completionKey = '';
          await refreshQueuedOperations();
          if (state.completionStatus?.key === key && state.completionStatus.stage === 'completed') state.completionStatus = null;
          render();
        }
      }
    })();
    activeCompletions.set(key, completion);
    return completion;
  }
  const hasDocumentRef = ref => Boolean(String(ref || '').trim()) && !/^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(String(ref));
  async function ensureDefectSheet(order = currentOrder(), {refreshExisting = false} = {}) {
    if (!order) throw new Error('Выберите заказ-наряд');
    if (hasDocumentRef(order._defectSheet?.documentRef)) return order._defectSheet;
    const ref = order.orderRef || order.id;
    if (pendingDefectSheets.has(ref)) return pendingDefectSheets.get(ref);
    const attach = process => {
      if (!hasDocumentRef(process.documentRef)) throw new Error('1С не вернула ссылку на дефектовочную ведомость. Файл не отправлен.');
      for (const item of [order, ...state.orders.filter(item => (item.orderRef || item.id) === ref)]) {
        item._defectSheet = process; item.defectDocumentRef = process.documentRef;
      }
      return process;
    };
    const existing = (documentRef, entries) => attach(API.normalizeProcess({documentRef, entries:entries || []}, 'defectSheet'));
    if (!refreshExisting && hasDocumentRef(order._defectSheet?.documentRef)) return order._defectSheet;
    if (!refreshExisting && hasDocumentRef(order.defectDocumentRef)) return existing(order.defectDocumentRef, order.defects);
    const pending = (async () => {
      // Read the current order first; a stale list must not trigger creation.
      const response = await call1C('/orders/get', {orderRef:ref,orderId:ref});
      const fresh = API.mapOrder(response.order || response.data?.order || response.data || response);
      if ((fresh.orderRef || fresh.id) !== ref) throw new Error('Не удалось проверить действующий документ выбранного ЗН');
      const existingRef = fresh.defectDocumentRef || order.defectDocumentRef || order._defectSheet?.documentRef || '';
      if (!refreshExisting && hasDocumentRef(existingRef)) return existing(existingRef, fresh.defects || order.defects);
      const started = await call1C('/defects/start', {orderRef:ref,orderId:ref,existingDocumentRef:existingRef});
      const process = API.normalizeProcess(started, 'defectSheet');
      if (!process.entries.length && Array.isArray(fresh.defects)) process.entries = API.normalizeProcess({entries:fresh.defects}, 'defectSheet').entries;
      return attach(process);
    })();
    pendingDefectSheets.set(ref,pending);
    try { return await pending; } finally { pendingDefectSheets.delete(ref); }
  }

  function defectImageSource(file) {
    const direct = String(file?.previewUrl || file?.downloadUrl || '').trim();
    if (/^https?:\/\//i.test(direct) || direct.startsWith('/')) return direct;
    const base64 = String(file?.contentBase64 || '').replace(/^data:[^,]*,/, '');
    return base64 ? `data:${file?.mimeType || 'image/jpeg'};base64,${base64}` : '';
  }

  function renderDefectSheet() {
    const order = currentOrder(), sheet = order?._defectSheet;
    if (!sheet) return;
    const entries = sheet.entries || [];
    const entryHtml = entries.length ? entries.map((entry, index) => {
      const file = entry.file;
      const imageSource = entry.type === 'photo' || /^image\//i.test(file?.mimeType || '') ? defectImageSource(file) : '';
      const fileButton = imageSource
        ? `<button class="defect-photo-preview" data-action="defect-media" data-index="${index}" aria-label="${escAttr(file.fileName || 'Фото дефекта')}"><img src="${escAttr(imageSource)}" alt="${escAttr(file.fileName || 'Фото дефекта')}" loading="lazy"><span>${esc(file.fileName || 'Фото дефекта')}</span></button>`
        : file ? `<button class="entry-file" data-action="defect-media" data-index="${index}"><span class="file-icon">${entry.type === 'video' ? '🎥' : '📷'}</span><span><b>${esc(file.fileName)}</b></span></button>` : '';
      return `<div class="entry"><div class="entry-head"><span>${esc(entry.author || 'Сотрудник')}</span><span>${esc(FEATURES.dateTime(entry.createdAt))}</span></div>${entry.text ? `<div>${esc(entry.text)}</div>` : ''}${fileButton}</div>`;
    }).join('') : '<div class="empty">По этому ЗН ранее добавленных дефектов нет.</div>';
    const completionKey = `defects:${sheet.documentRef || ''}`;
    const completing = state.completionKey === completionKey;
    const disabled=documentCompletionLocked(sheet.documentRef)?' disabled':'';
    showSheet(`Дефектовочная ведомость · ЗН ${order.num}`, `Все записи по этому ЗН · документ 1С: ${sheet.documentRef || 'не указан'}`, `<div class="defect-history">${entryHtml}</div><label for="defectText">Новая запись</label><textarea id="defectText"${disabled} placeholder="Опишите выявленный дефект"></textarea><div class="grid two" style="margin-top:8px"><button data-action="defect-photo"${disabled}>Фото и видео</button><button data-action="send-defect-text"${disabled}>Добавить текст</button></div><button class="secondary" style="margin-top:8px" data-action="complete-defect-sheet" ${state.busy || disabled ? 'disabled' : ''} aria-busy="${completing}">${completing ? '<span class="spinner"></span> Подтверждаем отправку…' : 'Завершить дефектовку'}</button>`);
  }

  async function openDefectSheet() {
    showSheet('Дефектовочная ведомость', 'Проверяем документ в 1С', '<div class="loading"><span class="spinner"></span>Загрузка…</div>');
    try { await ensureDefectSheet(currentOrder(), {refreshExisting:true}); if (state.view === 'mp' && currentOrder()?._acceptance?.active) render(); renderDefectSheet(); }
    catch (error) { $('sheetBody').innerHTML = `<div class="empty">${esc(error.message)}</div>`; }
  }

  function openDefectMedia(index) {
    const entry = currentOrder()?._defectSheet?.entries?.[index], file = entry?.file;
    if (!file) return;
    const mime = file.mimeType || 'application/octet-stream';
    let url = file.downloadUrl;
    if (!url && file.contentBase64) {
      try {
        const raw = atob(file.contentBase64.replace(/^data:[^,]*,/, ''));
        const bytes = Uint8Array.from(raw, c => c.charCodeAt(0));
        url = URL.createObjectURL(new Blob([bytes], {type:mime}));
      } catch { return toast('Не удалось открыть вложение', true); }
    }
    if (!url) return toast('1С не передала ссылку или содержимое файла', true);
    if (/^image\//.test(mime)) showSheet('Фото дефекта', file.fileName, `<img src="${esc(url)}" alt="${esc(file.fileName)}" style="max-width:100%;border-radius:12px">`);
    else if (/^video\//.test(mime)) showSheet('Видео дефекта', file.fileName, `<video controls playsinline preload="metadata" src="${esc(url)}" style="width:100%;border-radius:12px"></video>`);
    else { const link=document.createElement('a'); link.href=url; link.download=file.fileName||'attachment'; link.target='_blank'; link.click(); }
  }

  async function openAcceptancePhotoSheet() {
    const order = currentOrder();
    const process = order?._acceptance;
    if (!process?.documentRef) {
      toast('Сначала создайте акт приёма', true);
      return;
    }
    if(documentCompletionLocked(process.documentRef)) return toast('Завершение уже сохранено. Статус доступен в очереди.',true);
    if (!window.ITUS_MEDIA_PICKER?.create) {
      showSheet('Приём автомобиля', `Документ 1С: ${process.documentRef || 'не указан'}`, '<div class="grid two"><button class="primary" data-action="acceptance-photo">Фото</button><button class="secondary" data-action="acceptance-video">Видео</button></div>');
      return;
    }
    openMediaPicker({ type:'acceptance' });
  }

  async function uploadAcceptanceFile(file, kind) {
    const session=sessionSnapshot();
    const order = currentOrder();
    const process = order?._acceptance;
    if (!process?.documentRef) throw new Error('Сначала создайте акт приёма');
    await assertDocumentEditable(process.documentRef,session);
    toast('Подготавливаем файл для акта приёма…');
    const payload = await fileToPayload(file, kind);
    assertSession(session,session.scope);
    await assertDocumentEditable(process.documentRef,session);
    const attemptKey = defectEntryKey(order, process.documentRef, kind, file);
    const requestBody = { ...orderPayloadFor(order), documentRef: process.documentRef, entry: { type: kind, file: payload } };
    let response, operation;
    try { ({response, operation} = await sendQueuedEntry(attemptKey, '/defects/entries/add', requestBody)); }
    catch (error) {
      if (error.status === 404) throw new Error('Фото получено, но метод /defects/entries/add отсутствует в 1С. Попросите администратора 1С добавить метод; файл не сохранён.');
      throw error;
    }
    appendQueuedEntry(process, response, operation, { type:kind, file:operation.body.entry.file, createdAt:nowIso(), author:state.user?.name || '' });
    render(); toast('Файл добавлен в акт приёма');
  }

  async function sendDefectText() {
    const session=sessionSnapshot(), order=currentOrder();
    const text = String($('defectText')?.value || '').trim();
    if (!text) return toast('Введите описание дефекта', true);
    const sheet = await ensureDefectSheet(order); assertSession(session,session.scope);
    await assertDocumentEditable(sheet.documentRef,session);
    const attemptKey = defectEntryKey(order, sheet.documentRef, 'text', text);
    const {response, operation} = await sendQueuedEntry(attemptKey, '/defects/entries/add', {...orderPayloadFor(order),documentRef:sheet.documentRef,entry:{type:'text',text}});
    appendQueuedEntry(sheet, response, operation, { type:'text', text, createdAt:nowIso(), author:state.user?.name || '' });
    renderDefectSheet(); toast('Запись добавлена в дефектовку');
  }

  function choosePhoto(target) {
    openMediaPicker(target);
  }

  function openMediaPicker(target) {
    const process=target.type==='acceptance'?currentOrder()?._acceptance:target.type==='defect'?currentOrder()?._defectSheet:null;
    if(documentCompletionLocked(process?.documentRef)) return toast('Завершение уже сохранено. Статус доступен в очереди.',true);
    if (!mediaPicker && window.ITUS_MEDIA_PICKER?.create) {
      mediaPicker = window.ITUS_MEDIA_PICKER.create({ showSheet, closeSheet, toast, limits: { photo:CONFIG.maxPhotoBytes, video:CONFIG.maxVideoBytes } });
    }
    if (!mediaPicker) return configureFilePicker(target, 'image/*,video/*', null, true);
    const labels = { acceptance: 'акт приёма', defect: 'дефектовку', client: 'чат с клиентом', chat: 'внутренний чат', messenger: 'чат' };
    const queueTarget = target.type === 'acceptance' || target.type === 'defect';
    mediaPicker.open({
      hint: `Файлы будут отправлены в ${labels[target.type] || 'текущий раздел'} по одному действию.`,
      onCommit: queueTarget ? files => commitMediaBatch(target.type, files) : target.type==='messenger' ? files => messenger.enqueueMediaBatch(files,target) : null,
      onSend: async (file, kind, uploadId) => {
        toast(`Загрузка файла «${file.name || 'вложения'}»…`);
        if (target.type === 'messenger') return messenger.upload(file, { ...target, kind });
        if (target.type === 'acceptance') return uploadAcceptanceFile(file, kind);
        if (target.type === 'defect') return uploadDefectFile(file, kind);
        if (target.type === 'client') return sendClientFile(file, kind, uploadId);
        if (target.type === 'chat') return sendChatFile(file, kind, uploadId);
        throw new Error('Не определено место прикрепления файла');
      }
    });
  }

  async function commitMediaBatch(type, files) {
    const session=sessionSnapshot();
    if (!operationQueue || !files.length) throw new Error('Очередь отправки недоступна');
    const order = currentOrder();
    if (!order) throw new Error('Сначала выберите заказ-наряд');
    const orderData = orderPayloadFor(order);
    const process = type === 'acceptance' ? order._acceptance : await ensureDefectSheet(order);
    assertSession(session,session.scope);
    if (!process?.documentRef) throw new Error(type === 'acceptance' ? 'Сначала создайте акт приёма' : 'Не найден документ дефектовки');
    const documentKey = String(process.documentRef);
    const scope = queueScope();
    await assertDocumentEditable(documentKey,session);
    // Finish every conversion before opening the atomic IndexedDB transaction.
    const preparedFiles = [];
    for(const item of files) { assertSession(session,scope); preparedFiles.push({...item,payload:await fileToPayload(item.file,item.kind)}); }
    assertSession(session,scope);
    const definitions = preparedFiles.map(item => {
      const attemptKey = [orderData.orderRef, documentKey, item.kind, item.uploadId].join('|');
      const clientEntryId = item.uploadId;
      const body = { ...orderData, documentRef:documentKey, clientEntryId, entry:{ type:item.kind, file:item.payload, clientEntryId } };
      return { id:`${scope}:entry:${attemptKey}`, scope, method:'/defects/entries/add', documentKey, clientEntryId, body, requestId:requestId(), kind:'entry' };
    });
    await assertDocumentEditable(documentKey,session);
    const operations = await operationQueue.prepareBatch(definitions);
    assertSession(session,scope);
    await refreshQueuedOperations();
    process.entries = Array.isArray(process.entries) ? process.entries : [];
    for (const [index, operation] of operations.entries()) {
      if (!process.entries.some(entry => entry.id === operation.clientEntryId)) {
        const item = preparedFiles[index];
        process.entries.push(API.normalizeProcess({entries:[{id:operation.clientEntryId,type:item.kind,file:item.payload,createdAt:nowIso(),author:state.user?.name || ''}]}, 'x').entries[0]);
      }
    }
    // The picker may now close; transport no longer references its File objects or DOM.
    void runPreparedOperations(operations).then(async () => {
      assertSession(session,scope);
      await runQueuedDocumentCompletion(documentKey);
      render();
    }).catch(error=>{if(!error.queuePaused && sessionCurrent(session)) showQueuedOperationError(error);});
    return operations;
  }

  function configureFilePicker(target, accept, capture, multiple = false) {
    const input = $('filePicker');
    state.fileTarget = target; input.value = ''; input.accept = accept || '*/*'; input.multiple = multiple;
    if (capture) input.setAttribute?.('capture', capture); else input.removeAttribute?.('capture');
    input.click?.();
  }

  async function fileToPayload(file, kind) {
    let blob = file;
    if (kind === 'photo' && /^image\//.test(file.type)) blob = await compressImage(file);
    const limit = kind === 'photo' ? CONFIG.maxPhotoBytes : (kind === 'video' ? CONFIG.maxVideoBytes : CONFIG.maxDocumentBytes);
    if (blob.size > limit) {
      const actualMb = (blob.size / 1024 / 1024).toFixed(1);
      const limitMb = (limit / 1024 / 1024).toFixed(0);
      throw new Error(`Размер файла ${actualMb} МБ превышает допустимый предел ${limitMb} МБ`);
    }
    const dataUrl = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob); });
    const mimeType = blob.type || file.type || 'application/octet-stream';
    const originalName = file.name || `${kind}-${Date.now()}`;
    const imageExtension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' }[mimeType];
    const fileName = kind === 'photo' && imageExtension
      ? `${originalName.replace(/\.[^.]*$/, '') || `photo-${Date.now()}`}.${imageExtension}`
      : originalName;
    return { fileName, mimeType, sizeBytes: blob.size, contentBase64: String(dataUrl).split(',')[1], clientFileId: requestId() };
  }

  async function compressImage(file) {
    if (file.size < 900 * 1024) return file;
    let image;
    try {
      if (typeof createImageBitmap === 'function') image = await createImageBitmap(file);
      else {
        const url = URL.createObjectURL(file);
        try { image = await new Promise((resolve,reject) => {
          const img = new Image(); img.onload=()=>resolve(img); img.onerror=reject; img.src=url;
        }); } finally { URL.revokeObjectURL(url); }
      }
    } catch { return file; } // Unsupported phone format: retain original file and size checks.
    const max = 1600, scale = Math.min(1, max / Math.max(image.width, image.height));
    const canvas = document.createElement('canvas'); canvas.width = Math.round(image.width * scale); canvas.height = Math.round(image.height * scale);
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', .82));
    image.close?.(); return blob || file;
  }

  async function uploadDefectFile(file, kind) {
    const session=sessionSnapshot();
    const order = currentOrder();
    const targetOrder = orderPayload();
    const sheet = await ensureDefectSheet(order);
    await assertDocumentEditable(sheet.documentRef,session);
    toast('Подготавливаем файл…');
    const payload = await fileToPayload(file, kind);
    assertSession(session,session.scope);
    await assertDocumentEditable(sheet.documentRef,session);
    const attemptKey = defectEntryKey(order, sheet.documentRef, kind, file);
    const {response, operation} = await sendQueuedEntry(attemptKey, '/defects/entries/add', { ...targetOrder, documentRef: sheet.documentRef, entry: { type: kind, file: payload } });
    appendQueuedEntry(sheet, response, operation, { type:kind, file:operation.body.entry.file, createdAt:nowIso(), author:state.user?.name || '' });
    render(); if (!$('overlay').classList.contains('hidden')) renderDefectSheet(); toast('Файл добавлен в дефектовку');
  }

  async function completeDefectSheet() {
    const session=sessionSnapshot(), order=currentOrder(), sheet = order?._defectSheet; if (!sheet) return;
    const key = `defects:${sheet.documentRef || ''}`;
    if (activeCompletions.has(key)) return activeCompletions.get(key);
    if (state.busy) return;
    const scope=session.scope;
    const completion=await operationQueue.prepare({id:`${scope}:complete:defects:${sheet.documentRef}`,scope,method:'/defects/complete',body:{...orderPayloadFor(order),documentRef:sheet.documentRef},documentKey:String(sheet.documentRef),requestId:requestId(),kind:'complete'});
    assertSession(session,scope); state.completionKey=key;state.completionStatus={key,stage:'waiting'};
    closeSheet(); await refreshQueuedOperations();
    await runQueuedDocumentCompletion(String(sheet.documentRef),completion);
    scheduleQueueResume();
  }

  async function loadClientTopics() {
    const response = await call1C('/clients/topics/list', { status: 'active' });
    state.clientTopics = API.extractItems(response, ['topics']).map(API.normalizeTopic);
    if (!state.clientTopics.some(item => item.ref === state.selectedClientTopic)) state.selectedClientTopic = state.clientTopics[0]?.ref || '';
    if (state.selectedClientTopic) await loadClientMessages(state.selectedClientTopic, true);
    render();
  }

  async function loadClientMessages(ref, silent = false) {
    const response = await call1C('/clients/messages/list', { topicRef: ref, topicId: ref }, { silent });
    state.clientMessages[ref] = API.extractItems(response, ['messages']).map(API.normalizeMessage);
  }

  async function sendClientMessage() {
    const text = String($('clientMessage')?.value || '').trim(); if (!text) return toast('Введите сообщение клиенту', true);
    const ref = state.selectedClientTopic;
    await call1C('/clients/messages/send', { topicRef: ref, topicId: ref, clientMessageId: requestId(), text });
    await loadClientMessages(ref); render(); toast('Сообщение отправлено клиенту через 1С');
  }

  async function sendClientFile(file, kind, clientMessageId = requestId()) {
    const payload = await fileToPayload(file, kind);
    const ref = state.selectedClientTopic;
    await call1C('/clients/files/send', { topicRef: ref, topicId: ref, clientMessageId, file: payload, kind });
    await loadClientMessages(ref); render(); toast('Вложение отправлено клиенту через 1С');
  }

  async function loadChatGroups() {
    const response = await call1C('/internal-chat/groups/list', {});
    state.chatGroups = API.extractItems(response, ['groups']).map(API.normalizeTopic)
      .sort((a, b) => Number(Boolean(b.common)) - Number(Boolean(a.common)));
    if (!state.chatGroups.some(item => item.ref === state.selectedChatGroup)) state.selectedChatGroup = state.chatGroups[0]?.ref || '';
    if (state.selectedChatGroup) await loadChatMessages(state.selectedChatGroup, true);
    render();
  }

  async function loadChatMessages(ref, silent = false) {
    const response = await call1C('/internal-chat/messages/list', { groupRef: ref, groupId: ref }, { silent });
    state.chatMessages[ref] = API.extractItems(response, ['messages']).map(API.normalizeMessage);
  }

  async function sendChatMessage() {
    const text = String($('chatMessage')?.value || '').trim(); if (!text) return toast('Введите сообщение', true);
    const ref = state.selectedChatGroup;
    await call1C('/internal-chat/messages/send', { groupRef: ref, groupId: ref, clientMessageId: requestId(), text });
    await loadChatMessages(ref); render(); toast('Сообщение отправлено в группу через 1С');
  }

  async function sendChatFile(file, kind, clientMessageId = requestId()) {
    const payload = await fileToPayload(file, kind);
    const ref = state.selectedChatGroup;
    await call1C('/internal-chat/files/send', { groupRef: ref, groupId: ref, clientMessageId, file: payload, kind });
    await loadChatMessages(ref); render(); toast('Вложение отправлено в группу через 1С');
  }

  function startPolling() {
    clearInterval(state.pollTimer);
    if (CONFIG.pollMs < 2000) return;
    pollNotifications();
    state.pollTimer = setInterval(pollNotifications, Math.max(60000, CONFIG.pollMs));
  }

  async function notificationRegistration() {
    if (!('serviceWorker' in navigator)) return null;
    await navigator.serviceWorker.register(new URL('./notification-sw.js', document.baseURI), {scope:new URL('./', document.baseURI).pathname});
    return navigator.serviceWorker.ready;
  }

  function webPushSupported() {
    return Boolean(window.ITUS_WEB_PUSH?.ready());
  }
  function base64UrlBytes(value) {
    const text = String(value || '').replace(/-/g,'+').replace(/_/g,'/');
    const raw = atob(text + '='.repeat((4 - text.length % 4) % 4));
    return Uint8Array.from(raw, char => char.charCodeAt(0));
  }
  function pushPayload(subscription) {
    const json = subscription.toJSON();
    return { subscription:{endpoint:json.endpoint,keys:{p256dh:json.keys?.p256dh || '',auth:json.keys?.auth || ''}},
      clientInstanceId:pushClientInstanceId(),
      platform:'web', userId:state.userId };
  }
  function pushClientInstanceId() {
    const stored = localStorage.getItem('itus.push.instance');
    if (stored) return stored;
    const id = requestId(); localStorage.setItem('itus.push.instance', id); return id;
  }
  let webPushRegistered = false;
  async function syncExistingWebPush() {
    if (window.ITUS_NATIVE_PUSH?.supported?.() || !window.ITUS_WEB_PUSH) return;
    const owner = state.userId;
    try {
      const subscription = await window.ITUS_WEB_PUSH.existing();
      if (!subscription || !owner || state.userId !== owner) return;
      const response = await call1C('/notifications/push/subscribe', pushPayload(subscription), {silent:true});
      if (state.userId === owner) webPushRegistered = response?.data?.registered === true;
    } catch { console.warn('Не удалось подтвердить Web Push в 1С; повторите подключение в настройках уведомлений.'); }
  }
  async function registerWebPush() {
    const owner = state.userId;
    if (!webPushSupported()) {
      await window.ITUS_WEB_PUSH?.prepare();
      showNotificationSettings();
      throw new Error(window.ITUS_WEB_PUSH?.reason() || 'Настройки загружены. Нажмите «Подключить Push» ещё раз.');
    }
    const subscription = await window.ITUS_WEB_PUSH.subscribe();
    if (!owner || state.userId !== owner) throw new Error('Пользователь изменился. Повторите подключение Push.');
    const response = await call1C('/notifications/push/subscribe', pushPayload(subscription), {silent:true});
    if (response?.data?.registered !== true) throw new Error('1С не подтвердила регистрацию Web Push');
    webPushRegistered = true;
    enableSystemPreference();
    return subscription;
  }
  async function unregisterWebPush() {
    webPushRegistered = false;
    if (!('serviceWorker' in navigator)) return;
    let subscription;
    try {
      const registration = await navigator.serviceWorker.getRegistration(new URL('./',document.baseURI).pathname);
      subscription = await registration?.pushManager?.getSubscription();
      if (subscription && state.userId) await call1C('/notifications/push/unsubscribe', pushPayload(subscription), {silent:true});
    } catch (error) { console.warn('Push unsubscribe:',error.message); }
    finally { try { await subscription?.unsubscribe(); } catch {} }
  }
  async function startNativePush() {
    const session=sessionSnapshot();
    const nativePush = window.ITUS_NATIVE_PUSH;
    if (!nativePush?.supported?.() || !state.userId) return;
    try {
      return await nativePush.start({
        onToken: async token => {
          if (!token) return;
          assertSession(session,session.scope);
          const response=await call1C('/notifications/push/subscribe', {platform:'android',token,userId:session.userId,
            clientInstanceId:pushClientInstanceId()}, {silent:true,session});
          if(response?.data?.registered!==true) throw new Error('1С не подтвердила регистрацию Android Push');
          return true;
        }
      });
    } catch (error) { console.warn('Native push start:',error.message); return false; }
  }
  function normalizePushTarget(data) {
    const payload = data?.data && typeof data.data === 'object' ? data.data : data;
    const type = String(payload?.type || '').trim();
    const orderRef = String(payload?.orderRef || payload?.orderId || '').trim();
    const topicRef = String(payload?.topicRef || payload?.topicId || '').trim();
    if (type === 'internal_chat_message') return topicRef ? {type,topicRef,eventId:String(payload?.eventId || payload?.notificationId || payload?.messageId || '')} : null;
    if (type === 'quality_control_requested') return orderRef ? {type,orderRef,payload:payload?.payload,message:payload?.message,eventId:String(payload?.eventId || payload?.notificationId || '')} : null;
    if (type === 'new_messages') return topicRef ? {type,topicRef,eventId:String(payload?.eventId || payload?.notificationId || payload?.messageId || '')} : null;
    if (orderRef) return {type,orderRef,eventId:String(payload?.eventId || payload?.notificationId || '')};
    return null;
  }
  function refreshOpenInternalChatFromPush(data) {
    const target = normalizePushTarget(data);
    return target?.type === 'internal_chat_message' ? Boolean(messenger?.refreshInternalThreadFromPush?.(target.topicRef)) : false;
  }
  function pushTargetKey(target) { return target.eventId || `${target.type}:${target.topicRef || target.orderRef || ''}`; }
  async function openQualityPushTarget(target) {
    if (!state.views.tech) throw new Error('Выходной контроль недоступен для вашей роли');
    await loadSingleOrder(target.orderRef);
    state.view = 'tech';
    const order = currentOrder();
    if (target.payload?.survey) order._quality = API.normalizeProcess({ qualityControl: target.payload }, 'qualityControl');
    else await startQuality('notification');
    render();
    toast(target.message || 'Открыт запрос выходного контроля');
  }
  async function applyPushTarget(target) {
    if (target.type === 'internal_chat_message') {
      if (!state.views.chat) throw new Error('Внутренние чаты недоступны для вашей роли');
      await setView('chat');
      if (!await messenger?.openThread?.('staff', target.topicRef)) throw new Error('Чат не найден или недоступен');
      return;
    }
    if (target.type === 'quality_control_requested') return openQualityPushTarget(target);
    if (target.type === 'new_messages') {
      if (!state.views.clients) throw new Error('Чаты с клиентами недоступны для вашей роли');
      await setView('clients');
      if (!await messenger?.openThread?.('clients', target.topicRef)) throw new Error('Чат не найден или недоступен');
      return;
    }
    await loadSingleOrder(target.orderRef);
    state.view = target.type === 'executor_assigned' ? 'executor' : 'orders';
    render();
  }
  async function applyPendingPushTarget() {
    if (!pendingPushTarget || !state.initialized || !state.userId) return false;
    const target = pendingPushTarget; pendingPushTarget = null;
    return openPushTarget(target, {alreadyQueued:true});
  }
  async function openPushTarget(data, {alreadyQueued=false} = {}) {
    const target = normalizePushTarget(data);
    if (!target) { toast('В Push-уведомлении нет корректной цели', true); return false; }
    if (!state.userId || !state.initialized) {
      pendingPushTarget = target;
      if (!state.userId) toast('Войдите в приложение, чтобы открыть Push-уведомление');
      return false;
    }
    const key = pushTargetKey(target);
    if (!alreadyQueued && handledPushTargets.has(key)) return true;
    handledPushTargets.add(key);
    if (handledPushTargets.size > 100) handledPushTargets.delete(handledPushTargets.values().next().value);
    try { await applyPushTarget(target); return true; }
    catch (error) { handledPushTargets.delete(key); toast(error.message || 'Не удалось открыть Push-уведомление', true); return false; }
  }

  const nativeNotifications = window.ITUSNativeNotifications;
  const nativePush = () => window.ITUS_NATIVE_PUSH?.supported?.() ? window.ITUS_NATIVE_PUSH : null;
  function notificationPermission() {
    if (nativePush()) return nativePush().permission();
    if (nativeNotifications) return nativeNotifications.permission();
    return 'Notification' in window ? Notification.permission : 'не поддерживается';
  }
  function enableSystemPreference() {
    if (notificationPermission() !== 'granted') return false;
    localStorage.setItem('itus.notifications.'+state.userId,
      JSON.stringify({...FEATURES.preferences(state.userId),system:true}));
    showNotificationSettings();
    toast('Уведомления разрешены');
    return true;
  }
  window.addEventListener('itus-notification-permission', () => {
    if (!enableSystemPreference()) {showNotificationSettings();toast('Разрешение не получено',true);}
  });

  function showNotificationSettings() {
    const prefs = FEATURES.preferences(state.userId);
    const labels = {new_messages:'Новые сообщения бота',executor_assigned:'Назначение исполнителем',executor_changed:'Изменение исполнителя',task_assigned:'Новая задача',quality_control_requested:'Запрос выходного контроля'};
    const types = FEATURES.typesFor(state.user);
    const native = nativePush();
    const deviceButton = native
      ? '<button data-action="enable-system-notifications">Подключить Push на устройстве</button>'
      : '<button data-action="enable-web-push">Подключить Push</button>';
    showSheet('Уведомления', 'Настройки этого пользователя на этом устройстве',
      types.map(type => '<label class="setting-row"><input type="checkbox" data-notification-pref="'+type+'" '+(prefs[type]?'checked':'')+'>'+labels[type]+'</label>').join('') +
      (!types.length ? '<p>1С не передала известную роль. Уведомления не запрашиваются.</p>' : '') +
      '<label class="setting-row"><input type="checkbox" data-notification-pref="system" '+(prefs.system?'checked':'')+'>Показывать системные уведомления</label>' +
      '<p>Разрешение устройства: '+esc(notificationPermission())+'</p>' +
      (!native ? '<p>'+esc(window.ITUS_WEB_PUSH?.reason() || 'Web Push доступен. Разрешение браузера само по себе ещё не подтверждает регистрацию в 1С.')+'</p>' : '') +
      '<div class="grid">'+deviceButton+'<button data-action="save-notifications">Сохранить</button></div>' +
      '<p class="tiny">На Android используется Firebase Push; в браузере — Web Push. Закрытые ключи хранятся только на сервере. В Windows разрешите уведомления Яндекс Браузера и отключите режим «Не беспокоить» для проверки.</p>');
  }

  async function pollNotifications() {
    const types = FEATURES.typesFor(state.user);
    if (!state.userId || !state.initialized || !types.length || state.polling) return;
    const userId = state.userId;
    const unreadRevision = state.unreadRevision;
    state.polling = true;
    try {
      // Лёгкий запрос: 1С возвращает только новые события и счётчики.
      // История чатов, документы и медиа здесь не запрашиваются.
      const response = await call1C('/notifications/poll', {
        cursor: state.notificationCursor, limit: 5, light: true, onlyUnread: true,
        includeChatHistory: false, role: state.user.roleName || state.user.role,
        roleName: state.user.roleName || '',
        types, ...(types.length === 1 ? {type:types[0]} : {}),
        includeUnreadCount: types.includes('new_messages'),
        botId: state.clientBotId
      }, { silent:true });
      if (state.userId !== userId) return;
      const data = response.data || response;
      const count = FEATURES.unread(data);
      if (count !== null && state.unreadRevision === unreadRevision) state.unreadMessages = count;
      state.notificationCursor = String(data.nextCursor || data.cursor || state.notificationCursor || '');
      const prefs = FEATURES.preferences(userId);
      for (const raw of API.extractItems(response, ['events','notifications'])) {
        const type = normalizedNotificationType(raw.type || raw.eventType);
        if (!types.includes(type)) continue;
        const event = {eventId:String(raw.eventId || raw.id || JSON.stringify(raw)), type,
          title:String(raw.title || 'Уведомление из 1С'),message:String(raw.message || raw.text || ''),
          orderRef:String(raw.orderRef || raw.orderId || raw.payload?.orderRef || ''),payload:raw.payload || {}};
        if (state.seenEvents.has(event.eventId)) continue;
        if (type === 'new_messages' && count === null && state.unreadRevision === unreadRevision) {
          const eventCount = FEATURES.unread(raw.payload || raw);
          if (eventCount !== null) state.unreadMessages = eventCount;
        }
        state.seenEvents.add(event.eventId);
        if (state.seenEvents.size > 2000) state.seenEvents.delete(state.seenEvents.values().next().value);
        await messenger?.notify(event);
        if (!prefs[type]) continue;
        state.notifications.unshift(event);
        state.notifications = state.notifications.slice(0,100);
        if (document.hidden && prefs.system && nativeNotifications && nativeNotifications.permission() === 'granted') {
          nativeNotifications.show(event.title,event.message,event.eventId);
        } else if (document.hidden && prefs.system && !webPushRegistered && 'Notification' in window && Notification.permission === 'granted') {
          try {
            const registration = await notificationRegistration();
            if (registration) await registration.showNotification(event.title,{body:event.message,tag:event.eventId,
              icon:new URL('./assets/itus-logo.png',document.baseURI).href,
              data:{url:new URL('./',document.baseURI).href}});
            else new Notification(event.title,{body:event.message,tag:event.eventId});
          } catch (error) {
            try { if ('Notification' in window && Notification.permission === 'granted') new Notification(event.title,{body:event.message,tag:event.eventId}); }
            catch { console.warn('System notification:',error.message); }
          }
        }
      }
      renderNotifications(); renderUser();
    } catch(error) { console.warn('Notification poll:',error.message); }
    finally { state.polling = false; }
  }

  async function openQualityNotification(event) { return openPushTarget({...event,type:'quality_control_requested'}); }

  async function openNotification(eventId) {
    const event = state.notifications.find(item => item.eventId === eventId); if (!event) return;
    if (event.type === 'new_messages') return openPushTarget(event);
    if (event.type === 'quality_control_requested') return openQualityNotification(event);
    if (event.orderRef) { await loadSingleOrder(event.orderRef); state.view = event.type === 'executor_assigned' ? 'executor' : 'orders'; render(); }
  }

  function showSettings() {
    showSheet('Настройки I-MAX', 'Параметры релизной версии', `<p><b>Пользователь MAX:</b><br>${esc(state.userId)}</p><p><b>Локальный маршрут API:</b><br>${esc(CONFIG.apiBase)}</p><p><b>HTTP-сервис 1С:</b><br>${esc(CONFIG.publicBase || 'задаётся сервером')}</p><p><b>Версия:</b> ${esc(CONFIG.version)}</p><div class="grid"><button data-action="notification-settings">Уведомления</button><button data-action="show-operation-queue">Неотправленные операции</button><button data-action="test-1c">Проверить связь с 1С</button><button data-action="retry-init">Перезагрузить данные</button><button class="danger" data-action="logout">Выйти</button></div><p class="tiny">Адрес 1С задаётся в config/itus.config.js или переменной ONE_C_TARGET на сервере приложения. Секреты в браузерном файле не хранятся.</p>`);
  }

  async function logout() {
    loggingOut=true;
    setAuth(state.userId,state.authMode); // Invalidate every running request before remote cleanup.
    try { await Promise.allSettled([unregisterWebPush(),window.ITUS_NATIVE_PUSH?.unregister?.()]); }
    finally {
      messenger?.reset(); clearInterval(state.pollTimer); pendingPushTarget=null;handledPushTargets.clear();
      mediaPicker?.dismiss?.({force:true});
      setAuth('','');
      Object.assign(state,{user:null,orders:[],selectedOrderId:'',initialized:false,loading:false,busy:false,error:'',notifications:[],notificationCursor:'',unreadMessages:null,lastUnreadMessages:null,seenEvents:new Set()});
      document.body?.classList.remove('messenger-view'); closeSheet(); loggingOut=false; render();
    }
  }

  async function test1C() {
    try {
      try { await call1C('/ping', { check: 'ITUS' }, { silent: true }); toast('Связь с 1С установлена'); }
      catch (error) { if (!CONFIG.pingFallback || error.status !== 404) throw error; await call1C('/auth/max', authPayload(), { silent: true }); toast('Связь с 1С установлена через /auth/max'); }
    } catch (error) { toast(`1С недоступна: ${error.message}`, true); }
  }

  function parseQr(value) {
    const raw = String(value || '').trim(); if (!raw) return '';
    try { const json = JSON.parse(raw); return String(json.maxUserId || json.userId || json.authId || json.id || '').trim(); } catch {}
    try { const url = new URL(raw, location.href); return String(url.searchParams.get('max_user_id') || url.searchParams.get('maxUserId') || url.searchParams.get('userId') || url.searchParams.get('id') || raw).trim(); } catch { return raw; }
  }

  function manualQr() {
    state.cameraStream?.getTracks().forEach(track => track.stop());
    state.cameraStream = null;
    showSheet('Вход по QR-коду', 'Вставьте значение QR вручную', '<label for="qrValue">QR может содержать ID, ссылку или JSON</label><input id="qrValue" placeholder="Значение QR"><button class="primary" data-action="submit-auth-qr">Войти</button>');
  }

  async function scanAuthQr() {
    if (!navigator.mediaDevices?.getUserMedia || typeof BarcodeDetector === 'undefined') return manualQr();
    showSheet('Вход по QR-коду', 'Наведите камеру на QR-код', '<video id="qrVideo" autoplay muted playsinline style="width:100%;border-radius:17px;background:#000"></video><button class="secondary" data-action="manual-auth-qr">Ввести вручную</button>');
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      if (!$('qrVideo')) { stream.getTracks().forEach(track => track.stop()); return; }
      state.cameraStream = stream;
      const video = $('qrVideo'); video.srcObject = stream;
      const detector = new BarcodeDetector({ formats: ['qr_code'] });
      const scan = async () => {
        if ($('overlay').classList.contains('hidden')) return stream.getTracks().forEach(track => track.stop());
        const codes = await detector.detect(video).catch(() => []);
        if (codes.length) {
          const id = parseQr(codes[0].rawValue); stream.getTracks().forEach(track => track.stop());
          if (/^\d+$/.test(id)) { setAuth(id, 'qr'); closeSheet(); initialize(); return; }
        }
        requestAnimationFrame(scan);
      };
      scan();
    } catch { manualQr(); toast('Камера недоступна — используйте ручной ввод', true); }
  }

  async function handleFilePicked(event) {
    const file = event.target.files?.[0], target = state.fileTarget; state.fileTarget = null;
    if (!file || !target) return;
    try {
      if (target.type === 'messenger') { await messenger.upload(file,target); return; }
      toast(`Загрузка файла «${file.name || 'вложения'}»…`);
      if (target.type === 'acceptance') await uploadAcceptanceFile(file, target.kind);
      else if (target.type === 'defect') await uploadDefectFile(file, target.kind);
      else if (target.type === 'client') await sendClientFile(file, target.kind);
      else if (target.type === 'chat') await sendChatFile(file, target.kind);
    } catch (error) { toast(error.message, true); }
  }

  async function setView(view) {
    if (messenger && (view === 'chat' || view === 'clients') && (state.views.chat || state.views.clients)) {
      state.view='chat';document.body.classList.add('messenger-view');renderUser();renderTabs();renderNotifications();
      return messenger.enter(view === 'clients' ? 'clients' : 'staff');
    }
    messenger?.leave();
    if (!state.views[view]) view = 'orders';
    state.view = view; render();
    try {
      if (view === 'clients' && !state.clientTopics.length) await loadClientTopics();
      if (view === 'chat' && !state.chatGroups.length) await loadChatGroups();
    } catch (error) { toast(error.message, true); }
  }

  function firstMainView() {
    return Object.keys(state.views).find(view => view !== 'clients' && view !== 'chat') || ((state.views.clients || state.views.chat) ? 'chat' : 'orders');
  }

  if (typeof ResizeObserver !== 'undefined') {
    const header = document.querySelector('.top');
    if (header) new ResizeObserver(() => document.documentElement.style.setProperty('--header-height', `${header.offsetHeight}px`)).observe(header);
  }

  window.addEventListener('offline', () => connectionStatus('error', 'Нет подключения к интернету'));
  window.addEventListener('online', () => { connectionStatus('', 'Интернет восстановлен · ожидаем ответа 1С'); scheduleQueueResume(); });

  document.addEventListener('focusin', event => {
    if (event.target.id === 'orderSearch') {
      const end = event.target.value.length;
      event.target.setSelectionRange(end, end);
    }
  });

  document.addEventListener('input', event => {
    if (event.target.id === 'orderSearch') {
      const { selectionStart, selectionEnd } = event.target;
      state.search = event.target.value;
      // Keep the same focused element: recreating it resets Android's virtual keyboard layout.
      filterRenderedOrderList(state.search);
      event.target.setSelectionRange(selectionStart ?? event.target.value.length, selectionEnd ?? event.target.value.length);
    }
    const processKey = event.target.dataset.processInput;
    const answerKey = event.target.dataset.processAnswer;
    if (processKey) { const process = currentOrder()?.[processKey]; if (process && !documentCompletionLocked(process.documentRef)) { process.values[event.target.dataset.field] = event.target.value; process.errors?.delete(`field:${event.target.dataset.field}`); updateProcessProgress(processKey); } }
    if (answerKey) { const process = currentOrder()?.[answerKey]; if (process && !documentCompletionLocked(process.documentRef)) { process.answers[event.target.dataset.question] = event.target.value; process.errors?.delete(`question:${event.target.dataset.question}`); updateProcessProgress(answerKey); } }
  });

  document.addEventListener('change', event => {
    if (event.target.id === 'filePicker') handleFilePicked(event);
    const processKey = event.target.dataset.processInput;
    const answerKey = event.target.dataset.processAnswer;
    if (processKey) { const process = currentOrder()?.[processKey]; if (process) { process.values[event.target.dataset.field] = event.target.value; updateProcessProgress(processKey); } }
    if (answerKey) { const process = currentOrder()?.[answerKey]; if (process) { process.answers[event.target.dataset.question] = event.target.value; updateProcessProgress(answerKey); } }
  });

  document.addEventListener('click', async event => {
    const button = event.target.closest('[data-action]'); if (!button) return;
    const action = button.dataset.action;
    const session=sessionSnapshot();
    const actionKey=[session.generation,action,button.dataset.operationId || button.dataset.operation || '',button.dataset.ref || '',currentOrder()?.id || ''].join('|');
    const tracksPendingState = longRunningActions.has(action);
    if (button.disabled || (tracksPendingState && (pendingActionButtons.has(button) || pendingActions.has(actionKey)))) return;
    if (tracksPendingState) {
      pendingActionButtons.add(button); pendingActions.add(actionKey);
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
      button.classList.add('is-pending');
    }
    try {
      if (await mediaPicker?.handle(action, button)) return;
      if (action.startsWith('msg-')) return await messenger?.handle(action,button);
      if (action === 'view') return await setView(button.dataset.view);
      if (action === 'login') { const id = String($('authUserId')?.value || '').trim(); if (!/^\d+$/.test(id)) return await toast('ID пользователя MAX должен содержать только цифры', true); setAuth(id, 'manual'); return await initialize(); }
      if (action === 'scan-auth-qr') return await scanAuthQr();
      if (action === 'manual-auth-qr') return await manualQr();
      if (action === 'submit-auth-qr') { const id = parseQr($('qrValue')?.value); if (!/^\d+$/.test(id)) return await toast('QR не содержит корректный числовой ID', true); setAuth(id, 'qr'); closeSheet(); return await initialize(); }
      if (action === 'settings') return await showSettings();
      if (action === 'notification-settings') return await showNotificationSettings();
      if (action === 'save-notifications') {
        const prefs = FEATURES.preferences(state.userId);
        document.querySelectorAll('[data-notification-pref]').forEach(input => prefs[input.dataset.notificationPref] = input.checked);
        localStorage.setItem('itus.notifications.'+state.userId, JSON.stringify(prefs));
        state.notifications = state.notifications.filter(e => prefs[e.type]);
        renderNotifications(); toast('Настройки уведомлений сохранены'); return;
      }
      if (action === 'enable-system-notifications') {
        if (nativePush()) {
          const permission = await nativePush().requestPermission();
          if (permission !== 'granted') { showNotificationSettings(); return await toast('Разрешение на уведомления не получено',true); }
          await startNativePush(); if(nativePush().isRegistered?.()) enableSystemPreference(); else { showNotificationSettings(); toast('Разрешение получено. Ожидаем подтверждения регистрации в 1С'); } return;
        }
        if (nativeNotifications) { nativeNotifications.requestPermission(); return; }
        if (!('Notification' in window) || !('serviceWorker' in navigator) || !window.isSecureContext) return await toast('Нужен браузер с поддержкой уведомлений и HTTPS (или localhost)', true);
        const permission = await Notification.requestPermission();
        if (permission === 'granted') {await notificationRegistration();enableSystemPreference();}
        else {showNotificationSettings();toast('Разрешение не получено',true);}
        return;
      }
      if (action === 'enable-web-push') { await registerWebPush(); return await toast('Push-подписка зарегистрирована'); }
      if (action === 'bot-messages') return await setView('clients');
      if (action === 'test-1c') return await test1C();
      if (action === 'retry-init') { closeSheet(); return await initialize(); }
      if (action === 'retry-failed-operation') return await retryFailedOperation();
      if (action === 'copy-operation-report') return await copyOperationReport();
      if (action === 'logout') return await logout();
      if (action === 'show-operation-queue') return await showOperationQueue();
      if (action === 'open-operation-report') return await openOperationReport(button.dataset.operationId);
      if (action === 'close-sheet') return await closeSheet();
      if (action === 'refresh-orders') { await loadOrders(); return await render(); }
      if (action === 'search-orders') return await searchOrders();
      if (action === 'select-order') { await loadSingleOrder(button.dataset.ref); state.view = viewForCurrentUser(); return await render(); }
      if (action === 'load-order') { await loadSingleOrder(currentOrder().orderRef); render(); return await toast('Карточка обновлена из 1С'); }
      if (action === 'scan-order-qr') return await openOrderQrScanner();
      if (action === 'manual-order-qr') return await showOrderQrManual();
      if (action === 'submit-order-qr') return await searchOrderQr($('orderQr')?.value);
      if (action === 'select-order-qr') { const order = state.orders.find(item => (item.orderRef || item.id) === button.dataset.ref); if (!order) return await toast('Заказ-наряд больше недоступен', true); state.selectedOrderId = order.id; state.view = viewForCurrentUser(); closeSheet(); return await render(); }
      if (action === 'answer-option') { const process = currentOrder()?.[button.dataset.process]; if (!process || documentCompletionLocked(process.documentRef)) return; const id = button.dataset.question, value = button.dataset.value; if (button.dataset.type === 'multi') { const values = Array.isArray(process.answers[id]) ? process.answers[id] : []; process.answers[id] = values.includes(value) ? values.filter(item => item !== value) : values.concat(value); } else process.answers[id] = value; process.errors?.delete(`question:${id}`); return await render(); }
      if (action === 'start-acceptance') return await startAcceptance();
      if (action === 'complete-acceptance') return await completeAcceptance();
      if (action === 'choose-post') return await choosePost();
      if (action === 'set-post') return await setPost(button.dataset.ref, button.dataset.name);
      if (action === 'assign-executor') return await assignExecutor(false);
      if (action === 'assign-other-executor') return await assignExecutor(true);
      if (action === 'set-executor') return await setExecutor(button.dataset.ref, button.dataset.name);
      if (action === 'start-executor-work') return await startExecutorWork();
      if (action === 'complete-checklist') return await completeChecklist();
      if (action === 'package-create') return await preparePackage();
      if (action === 'package-select') return await selectPackage();
      if (action === 'package-use') return await usePackage(button.dataset.ref, button.dataset.number, button.dataset.status);
      if (['worktime-works-next','worktime-self','worktime-employees-next','worktime-shares-equal','worktime-shares-next','worktime-back-works','worktime-back-employees'].includes(action)) return await worktimeStep(action);
      if (action === 'worktime-submit') return await submitPackage();
      if (action === 'package-start') return await packageAction('start');
      if (action === 'package-pause') return await packageAction('pause');
      if (action === 'package-close') return await packageAction('close');
      if (action === 'production') return await showProduction();
      if (action === 'start-quality') return await startQuality('manual');
      if (action === 'request-quality') return await requestQualityControl();
      if (action === 'complete-quality') return await completeQuality(button.dataset.result);
      if (action === 'current-appeal') return await showCurrentAppeal();
      if (action === 'service-history') return await openServiceHistory();
      if (action === 'open-defect-chat') return await openDefectSheet();
      if (action === 'open-acceptance-photo') return await openAcceptancePhotoSheet();
      if (action === 'acceptance-photo' || action === 'acceptance-video') return await openMediaPicker({ type:'acceptance' });
      if (action === 'defect-photo' || action === 'defect-video') return await openMediaPicker({ type:'defect' });
      if (action === 'send-defect-text') return await sendDefectText();
      if (action === 'defect-media') return await openDefectMedia(Number(button.dataset.index));
      if (action === 'complete-defect-sheet') return await completeDefectSheet();
      if (action === 'load-client-topics') return await loadClientTopics();
      if (action === 'select-client-topic') { state.selectedClientTopic = button.dataset.ref; await loadClientMessages(button.dataset.ref); return await render(); }
      if (action === 'refresh-client-messages') { await loadClientMessages(state.selectedClientTopic); return await render(); }
      if (action === 'send-client-message') return await sendClientMessage();
      if (action === 'client-photo' || action === 'client-video') return await openMediaPicker({type:'client'});
      if (action === 'client-file') return await configureFilePicker({type:'client',kind:'file'}, '*/*');
      if (action === 'load-chat-groups') return await loadChatGroups();
      if (action === 'select-chat-topic') { state.selectedChatGroup = button.dataset.ref; await loadChatMessages(button.dataset.ref); return await render(); }
      if (action === 'refresh-chat-messages') { await loadChatMessages(state.selectedChatGroup); return await render(); }
      if (action === 'send-chat-message') return await sendChatMessage();
      if (action === 'chat-photo' || action === 'chat-video') return await openMediaPicker({type:'chat'});
      if (action === 'chat-file') return await configureFilePicker({type:'chat',kind:'file'}, '*/*');
      if (action === 'open-notification') return await openNotification(button.dataset.event);
      if (action === 'dismiss-notification') { state.notifications = state.notifications.filter(item => item.eventId !== button.dataset.event); return await renderNotifications(); }
    } catch (error) { if(!error.queuePaused && sessionCurrent(session)) { console.error(action, error); toast(error.message || 'Ошибка выполнения операции', true); } }
    finally {
      if (tracksPendingState && button.isConnected) {
        pendingActionButtons.delete(button);
        button.disabled = false;
        button.removeAttribute('aria-busy');
        button.classList.remove('is-pending');
      }
    }
  });

  $('closeSheetButton').addEventListener('click', closeSheet);
  $('overlay').addEventListener('click', event => { if (event.target === $('overlay')) closeSheet(); });
  $('userPanel').addEventListener('click', () => state.userId ? showSettings() : null);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && state.initialized) {
      pollNotifications();
      void messenger?.refreshVisibleInternalThread?.();
    }
  });

  function closeFocusedEditor() {
    const active = document.activeElement;
    if (!active || !(active.isContentEditable || active.matches?.('input, textarea, select, [contenteditable="true"]'))) return false;
    active.blur?.();
    return true;
  }

  window.ITUS_BACK = () => {
    if (closeFocusedEditor()) return true;
    if (!$('overlay').classList.contains('hidden')) { closeSheet(); return true; }
    if (messenger?.back?.()) return true;
    const view = firstMainView();
    if (state.view !== view) void setView(view);
    return true;
  };
  window.ITUS_NATIVE_PUSH?.listen?.({
    onNotification: event => { refreshOpenInternalChatFromPush(event); if (!document.hidden) toast(event?.title || 'Новое уведомление'); },
    onAction: data => void openPushTarget(data),
    onError: error => console.warn('Native push:', error)
  });
  navigator.serviceWorker?.addEventListener?.('message', event => {
    if (event.data?.type === 'itus-push') refreshOpenInternalChatFromPush(event.data.data);
  });
  if (!window.ITUS_NATIVE_PUSH?.supported?.()) {
    void window.ITUS_WEB_PUSH?.prepare().catch(() => {});
    const launch = new URL(window.location.href);
    if (launch.searchParams.get('push') === '1') {
      const target = Object.fromEntries(['type','eventId','topicRef','topicId','orderRef','orderId'].map(key => [key,launch.searchParams.get(key) || '']));
      void openPushTarget(target);
      for (const key of ['push','type','eventId','topicRef','topicId','orderRef','orderId']) launch.searchParams.delete(key);
      window.history.replaceState(null,'',launch.href);
    }
  }
  setAuth(readAuthFromContext(), 'max');
  void loadBuildInfo();
  render();
  if (state.userId) initialize();
})();
