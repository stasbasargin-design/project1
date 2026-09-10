(function () {
  'use strict';

  window.WebApp?.ready?.();
  window.WebApp?.expand?.();

  const API = window.ITUS_API;
  const $ = id => document.getElementById(id);
  const CONFIG = {
    apiBase: window.ITUS_CONFIG?.ONE_C_API_BASE_URL || '/api/1c',
    publicBase: window.ITUS_CONFIG?.ONE_C_PUBLIC_BASE_URL || '',
    token: window.ITUS_CONFIG?.ONE_C_TOKEN || '',
    serviceBotId: window.ITUS_CONFIG?.MAX_SERVICE_BOT_ID || '',
    clientBotId: window.ITUS_CONFIG?.MAX_CLIENT_BOT_ID || '',
    miniAppId: window.ITUS_CONFIG?.MAX_MINI_APP_ID || '',
    timeoutMs: Number(window.ITUS_CONFIG?.REQUEST_TIMEOUT_MS || 35000),
    pollMs: Number(window.ITUS_CONFIG?.POLL_INTERVAL_MS || 15000),
    maxUploadBytes: Number(window.ITUS_CONFIG?.MAX_UPLOAD_BYTES || 15 * 1024 * 1024),
    enforceTabs: window.ITUS_CONFIG?.ENFORCE_SERVER_TABS === true,
    pingFallback: window.ITUS_CONFIG?.PING_FALLBACK_TO_AUTH !== false,
    version: 'itus-max-2.1.7'
  };

  const ALL_VIEWS = {
    orders: 'ЗН', mp: 'МП', executor: 'Исп.', tech: 'ТЕХ',
    clients: 'B2B', chat: 'Чат'
  };
  const VIEW_TITLES = {
    orders: 'Заказ-наряды', mp: 'Мастер-приёмщик', executor: 'Исполнитель',
    tech: 'Технолог', clients: 'B2B: общение с клиентами', chat: 'Чат между отделами'
  };
  const ICONS = {
    orders: '<svg viewBox="0 0 24 24"><path d="M7 3.5h7l4 4V20a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 20V5a1.5 1.5 0 0 1 1-1.5Z"/><path d="M14 3.5V8h4M9 12h6M9 16h6"/></svg>',
    mp: '<svg viewBox="0 0 24 24"><circle cx="12" cy="7.5" r="3"/><path d="M5.5 19c1.3-3.1 3.5-4.7 6.5-4.7s5.2 1.6 6.5 4.7"/></svg>',
    executor: '<svg viewBox="0 0 24 24"><path d="M4 18.5 12.5 10M14.5 4a4 4 0 0 0-4.8 5.7l-6.2 6.2a2 2 0 0 0 2.8 2.8l6.2-6.2A4 4 0 0 0 18.2 7l-2.5 2.5-2-2Z"/><path d="m15 14 5 5"/></svg>',
    tech: '<svg viewBox="0 0 24 24"><path d="m9.5 3 .7 2.1 2 .8 2-1 1.9 1.9-1 2 .8 2 2.1.7v2.6l-2.1.7-.8 2 1 2-1.9 1.9-2-1-2 .8-.7 2.1H6.9l-.7-2.1-2-.8-2 1-1.9-1.9 1-2-.8-2-2.1-.7v-2.6l2.1-.7.8-2-1-2 1.9-1.9 2 1 2-.8L6.9 3Z"/><circle cx="8.2" cy="12" r="2.7"/><path d="M15.5 4.5h2v2h2v2h-2v2h-2v-2h-2v-2h2Z"/></svg>',
    clients: '<svg viewBox="0 0 24 24"><path d="M5 8a7.5 7.5 0 0 1 12-2M17 6h-3M17 6V3M19 16a7.5 7.5 0 0 1-12 2M7 18h3M7 18v3"/><path d="M8 10h3a1.5 1.5 0 0 1 0 3H8Zm0 3h3.5a1.5 1.5 0 0 1 0 3H8Z"/></svg>',
    chat: '<svg viewBox="0 0 24 24"><path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h7A2.5 2.5 0 0 1 16 6.5v5a2.5 2.5 0 0 1-2.5 2.5H9l-4 3v-3.5A2.5 2.5 0 0 1 4 11.5Z"/><path d="M16 9h1.5a2.5 2.5 0 0 1 2.5 2.5V18l-3-2h-3"/></svg>'
  };

  const state = {
    view: 'orders', views: { ...ALL_VIEWS }, orders: [], selectedOrderId: '',
    user: null, userId: '', authMode: '', loading: false, error: '', busy: false,
    notifications: [], notificationCursor: '', clientTopics: [], selectedClientTopic: '',
    clientMessages: {}, chatGroups: [], selectedChatGroup: '', chatMessages: {},
    search: '', recording: null, pollTimer: null, initialized: false
  };

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
    if (state.recording) stopVoiceRecording(true);
    $('overlay').classList.add('hidden');
    $('sheetBody').innerHTML = '';
  }

  function readAuthFromContext() {
    const params = new URLSearchParams(location.search);
    const max = window.WebApp || {};
    const telegram = window.Telegram?.WebApp || {};
    const user = max.initDataUnsafe?.user || telegram.initDataUnsafe?.user || max.user || {};
    return String(user.id || params.get('max_user_id') || params.get('maxUserId') || params.get('userId') || params.get('id') || localStorage.getItem('itus.maxUserId') || '').trim();
  }

  function setAuth(id, mode) {
    state.userId = /^\d+$/.test(String(id || '').trim()) ? String(id).trim() : '';
    state.authMode = mode || 'max';
    if (state.userId) localStorage.setItem('itus.maxUserId', state.userId);
    else localStorage.removeItem('itus.maxUserId');
  }

  function authPayload() {
    return { userId: state.userId, maxUserId: state.userId, authId: state.userId, authMode: state.authMode || 'max', source: 'ITUS_MAX' };
  }

  function maxContext() {
    return {
      webAppData: window.WebApp?.initData || '', platform: window.WebApp?.platform || 'web',
      serviceBotId: CONFIG.serviceBotId, clientBotId: CONFIG.clientBotId,
      miniAppId: CONFIG.miniAppId, userId: state.userId, maxUserId: state.userId,
      authMode: state.authMode || 'max'
    };
  }

  function orderPayload(extra = {}) {
    const order = currentOrder();
    if (!order) throw new Error('Сначала выберите заказ-наряд');
    return {
      orderRef: order.orderRef || order.id, orderId: order.orderRef || order.id,
      orderNumber: order.num, vehicleRef: order.vehicleRef || '', vehiclePlate: order.plate,
      clientRef: order.clientRef || '', counterpartyName: order.client, ...extra
    };
  }

  function connectionStatus(status, message) {
    const el = $('connectionStatus');
    if (!el) return;
    el.textContent = message;
    el.dataset.status = status;
  }

  async function call1C(method, payload = {}, options = {}) {
    const base = String(CONFIG.apiBase || '').replace(/\/+$/, '');
    if (!base) throw new Error('Не заполнен ONE_C_API_BASE_URL');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CONFIG.timeoutMs);
    const headers = { 'Content-Type': 'application/json; charset=utf-8', 'X-ITUS-Request-Id': requestId() };
    if (CONFIG.token) headers['X-ITUS-Token'] = CONFIG.token;
    const envelope = {
      requestId: headers['X-ITUS-Request-Id'], timestamp: nowIso(), ...authPayload(), ...payload,
      max: maxContext(), miniApp: 'ITUS', version: CONFIG.version
    };
    try {
      const response = await fetch(base + method, { method: 'POST', headers, body: JSON.stringify(envelope), signal: controller.signal });
      const raw = (await response.text()).replace(/^\uFEFF/, '');
      let data;
      try { data = raw ? JSON.parse(raw) : {}; }
      catch { throw Object.assign(new Error('1С вернула не JSON'), { code: 'BAD_JSON', status: response.status }); }
      if (!response.ok || data.success === false) {
        const err = data.error || {};
        throw Object.assign(new Error(err.message || data.message || `HTTP ${response.status}`), { code: err.code || 'ONE_C_ERROR', status: response.status, details: err.details });
      }
      connectionStatus('ok', `1С доступна · ${new Date().toLocaleTimeString('ru-RU', {hour:'2-digit', minute:'2-digit'})}`);
      return data;
    } catch (error) {
      if (error.name === 'AbortError') error = Object.assign(new Error('Истекло время ожидания ответа 1С'), { code: 'TIMEOUT' });
      connectionStatus('error', navigator.onLine === false ? 'Нет подключения к интернету' : 'Последний запрос к 1С не выполнен');
      if (!options.silent) toast(`1С: ${error.message}`, true);
      throw error;
    } finally {
      clearTimeout(timer);
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
    state.loading = true; state.error = ''; render();
    try {
      const auth = await call1C('/auth/max', authPayload(), { silent: true });
      state.user = API.normalizeUser(auth.user || auth.data?.user || null);
      const tabs = auth.availableTabs || auth.data?.availableTabs;
      if (CONFIG.enforceTabs && Array.isArray(tabs) && tabs.length) {
        state.views = Object.fromEntries(Object.entries(ALL_VIEWS).filter(([key]) => tabs.includes(key)));
      } else state.views = { ...ALL_VIEWS };
      await loadOrders(false);
      state.initialized = true;
      startPolling();
    } catch (error) {
      state.error = `Не удалось подключиться к 1С: ${error.message}`;
    } finally {
      state.loading = false; render();
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

  async function loadSingleOrder(orderRef) {
    const response = await call1C('/orders/get', { orderRef, orderId: orderRef }, { silent: true });
    const raw = response.order || response.data?.order || response.data || response;
    const mapped = API.mapOrder(raw);
    if (mapped.id) { mergeOrder(mapped); state.selectedOrderId = mapped.id; }
    return mapped;
  }

  function renderAuth() {
    $('tabs').innerHTML = '';
    $('notifications').innerHTML = '';
    $('userPanel').innerHTML = '<div class="avatar">ID</div><div class="user-meta"><div class="user-name">Вход</div><div class="user-role">MAX ID или QR</div></div>';
    $('app').innerHTML = `<div class="card"><h2>Вход в ИТУС</h2><p class="muted">ID пользователя MAX передаётся в каждом JSON-запросе и используется 1С для проверки прав и записи автора действия.</p><label for="authUserId">ID пользователя MAX</label><input id="authUserId" inputmode="numeric" autocomplete="off" placeholder="Только цифры"><div class="grid two"><button class="primary" data-action="login">Войти по ID</button><button data-action="scan-auth-qr">Считать QR-код</button></div></div>`;
  }

  function renderUser() {
    const name = state.user?.name || `ID ${state.userId}`;
    const role = state.user?.roleName || state.user?.role || (state.loading ? 'Подключение к 1С' : `MAX ID: ${state.userId}`);
    $('userPanel').innerHTML = `<div class="avatar">${esc((name || 'И').slice(0,1).toUpperCase())}</div><div class="user-meta"><div class="user-name">${esc(name)}</div><div class="user-role">${esc(role)}</div></div>`;
  }

  function renderTabs() {
    $('tabs').innerHTML = Object.keys(state.views).map(key => `<button class="tab ${state.view === key ? 'active' : ''}" data-action="view" data-view="${key}" title="${escAttr(VIEW_TITLES[key])}" aria-label="${escAttr(VIEW_TITLES[key])}">${ICONS[key]}<span>${esc(state.views[key])}</span></button>`).join('');
  }

  function renderNotifications() {
    $('notifications').innerHTML = state.notifications.slice(0, 3).map(event => `<div class="notice"><strong>${esc(event.title || 'Уведомление из 1С')}</strong><span class="tiny">${esc(event.message || '')}</span><div class="notice-actions">${event.orderRef ? `<button data-action="open-notification" data-event="${escAttr(event.eventId)}">Открыть ЗН</button>` : ''}<button data-action="dismiss-notification" data-event="${escAttr(event.eventId)}">Скрыть</button></div></div>`).join('');
  }

  function render() {
    if (!state.userId) return renderAuth();
    renderUser(); renderTabs(); renderNotifications();
    if (state.loading) return $('app').innerHTML = '<div class="card loading"><span class="spinner"></span><div><h2>Подключение к 1С</h2><span class="tiny">Получаем пользователя и доступные заказ-наряды</span></div></div>';
    if (state.error) return $('app').innerHTML = `<div class="card"><h2>Нет подключения к 1С</h2><p class="muted">${esc(state.error)}</p><div class="grid two"><button data-action="retry-init">Повторить</button><button data-action="settings">Настройки</button></div></div>`;
    const renderers = { orders: renderOrdersView, mp: renderMpView, executor: renderExecutorView, tech: renderTechView, clients: renderClientsView, chat: renderChatView };
    $('app').innerHTML = (renderers[state.view] || renderOrdersView)();
  }

  function orderCard(order) {
    return `<button class="order ${state.selectedOrderId === order.id ? 'active' : ''}" data-action="select-order" data-ref="${escAttr(order.orderRef || order.id)}"><div class="row"><b>ЗН ${esc(order.num)} · ${esc(order.plate)}</b><span class="badge ${statusClass(order.status)}">${esc(order.status)}</span></div><div class="tiny">${esc(order.car)} · ${esc(order.client)}</div><div class="tiny">Исполнитель: ${esc(order.executor)} · дефекты: ${Number(order.counters?.defects || order.defects?.length || 0)}</div></button>`;
  }

  function renderOrderList() {
    const query = state.search.toLowerCase().trim();
    const orders = state.orders.filter(o => !query || [o.num,o.plate,o.car,o.client,o.status].join(' ').toLowerCase().includes(query));
    return `<div class="card"><label for="orderSearch">Поиск заказ-наряда</label><input id="orderSearch" value="${escAttr(state.search)}" placeholder="ЗН, госномер, клиент"><div class="grid two"><button data-action="scan-order-qr">Сканировать QR</button><button data-action="refresh-orders">Обновить из 1С</button></div></div>${orders.length ? orders.map(orderCard).join('') : '<div class="card empty">1С не вернула доступные заказ-наряды или ничего не найдено.</div>'}`;
  }

  function renderSelectedCard() {
    const order = currentOrder();
    if (!order) return '<div class="card empty">Выберите заказ-наряд для продолжения.</div>';
    return `<div class="card"><div class="row"><h2>ЗН ${esc(order.num)}</h2><span class="badge ${statusClass(order.status)}">${esc(order.status)}</span></div><p><b>${esc(order.car)}</b> · ${esc(order.plate)}</p><p class="tiny">${esc(order.client)}${order.contact ? ` / ${esc(order.contact)}` : ''}</p>${order.reason ? `<p class="reason"><b>Причина обращения:</b><br>${esc(order.reason)}</p>` : ''}<div class="summary"><div class="stat"><span class="tiny">Пост</span><br><b>${esc(order.post)}</b></div><div class="stat"><span class="tiny">Исполнитель</span><br><b>${esc(order.executor)}</b></div><div class="stat"><span class="tiny">Пакет УРВ</span><br><b>${esc(order.packageStatus)}</b></div><div class="stat"><span class="tiny">Дефектовка</span><br><b>${order.defectDocumentRef || order._defectSheet?.documentRef ? 'Создана' : 'Не создана'}</b></div></div></div>`;
  }

  function renderOrdersView() {
    return renderOrderList() + renderSelectedCard() + (currentOrder() ? `<div class="card"><h2>Меню заказ-наряда</h2><div class="grid two"><button data-action="view" data-view="mp">Раздел МП</button><button data-action="view" data-view="executor">Исполнитель</button><button data-action="view" data-view="tech">Технолог</button><button data-action="view" data-view="clients">B2B с клиентом</button><button data-action="view" data-view="chat">Чат отделов</button><button data-action="load-order">Обновить карточку</button></div></div>` : '');
  }

  function acceptanceHasPhoto(order = currentOrder()) {
    return [...(order?._defectSheet?.entries || []), ...(order?.defects || [])]
      .some(entry => entry.type === 'photo' && entry.file);
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
    const fields = process.form?.fields || [];
    const questions = process.survey?.questions || [];
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
            return `<label>${label}</label><select class="${error ? 'field-error' : ''}" data-process-input="${processKey}" data-field="${escAttr(field.id)}"><option value="">Выберите значение</option>${(field.options || []).map(option => `<option value="${escAttr(option.value)}" ${String(value) === String(option.value) ? 'selected' : ''}>${esc(option.label)}</option>`).join('')}</select>${error ? '<div class="error-text">Поле обязательно</div>' : ''}`;
        }

        const tag = field.type === 'textarea' ? 'textarea' : 'input';
        const type = field.type === 'textarea' ? '' : ` type="${field.type}"`;

        return `<label>${label}</label><${tag}${type} class="${error ? 'field-error' : ''}" data-process-input="${processKey}" data-field="${escAttr(field.id)}" placeholder="${escAttr(field.placeholder ?? '')}" value="${tag === 'input' ? escAttr(String(value ?? '')) : ''}">${tag === 'textarea' ? esc(String(value ?? '')) : ''}</${tag}>${error ? '<div class="error-text">Поле обязательно</div>' : ''}`;
    }

  function renderQuestion(processKey, question, process) {
    const value = process.answers?.[question.id];
    const done = answered(value);
    const error = process.errors?.has(`question:${question.id}`);
    const heading = `<div class="question-title">${esc(question.text)}${question.required ? ' <span class="required">*</span>' : ''}</div>${question.hint ? `<div class="tiny">${esc(question.hint)}</div>` : ''}`;
    if (['text','textarea','number'].includes(question.type)) {
      const tag = question.type === 'textarea' ? 'textarea' : 'input';
      const type = question.type === 'textarea' ? '' : ` type="${question.type}"`;
      return `<div class="question ${done ? 'done' : ''} ${error ? 'field-error' : ''}">${heading}<${tag}${type} data-process-answer="${processKey}" data-question="${escAttr(question.id)}" value="${tag === 'input' ? escAttr(value || '') : ''}">${tag === 'textarea' ? esc(value || '') : ''}</${tag}>${error ? '<div class="error-text">Ответ обязателен</div>' : ''}</div>`;
    }
    const options = question.type === 'boolean' && !question.options.length ? [{value:'true',label:'Да'},{value:'false',label:'Нет'}] : question.options;
    if (question.type === 'select') return `<div class="question ${done ? 'done' : ''} ${error ? 'field-error' : ''}">${heading}<select data-process-answer="${processKey}" data-question="${escAttr(question.id)}"><option value="">Выберите ответ</option>${options.map(option => `<option value="${escAttr(option.value)}" ${String(value) === String(option.value) ? 'selected' : ''}>${esc(option.label)}</option>`).join('')}</select>${error ? '<div class="error-text">Ответ обязателен</div>' : ''}</div>`;
    return `<div class="question ${done ? 'done' : ''} ${error ? 'field-error' : ''}">${heading}<div class="answers">${options.map(option => { const selected = Array.isArray(value) ? value.includes(option.value) : String(value ?? '') === String(option.value); return `<button class="answer ${selected ? 'selected' : ''}" data-action="answer-option" data-process="${processKey}" data-question="${escAttr(question.id)}" data-value="${escAttr(option.value)}" data-type="${question.type}">${selected ? '✓ ' : ''}${esc(option.label)}</button>`; }).join('')}</div>${error ? '<div class="error-text">Ответ обязателен</div>' : ''}</div>`;
  }

  function renderProcess(processKey, process, completeAction, completeLabel) {
    if (!process?.active) return '';
    const progress = processProgress(process, processKey);
    const hasContent = (process.form?.fields?.length || 0) + (process.survey?.questions?.length || 0) > 0;
    return `<div class="card" data-process-card="${processKey}"><div class="section-title"><div><h2>${esc(process.survey?.title || process.form?.title || 'Форма из 1С')}</h2><div class="tiny">Документ 1С: ${esc(process.documentRef || 'ссылка не возвращена')}</div></div><span data-process-progress class="badge ${progress.done === progress.total && progress.total ? 'ok' : 'warn'}">${progress.done}/${progress.total}</span></div>${process.form?.hint ? `<p class="muted">${esc(process.form.hint)}</p>` : ''}${process.survey?.hint ? `<p class="muted">${esc(process.survey.hint)}</p>` : ''}<div class="progress"><span data-process-bar style="width:${progress.pct}%"></span></div>${hasContent ? (process.form.fields.map(field => renderField(processKey, field, process)).join('') + process.survey.questions.map(question => renderQuestion(processKey, question, process)).join('')) : '<div class="empty">1С создала документ, но не вернула схему полей и вопросов. Продолжение заблокировано.</div>'}${processKey === '_acceptance' ? renderAcceptancePhoto(process) : ''}<button class="primary" data-action="${completeAction}" ${!hasContent || state.busy ? 'disabled' : ''}>${esc(completeLabel)}</button></div>`;
  }

  function renderAcceptancePhoto(process) {
    const done = acceptanceHasPhoto();
    const required = process.photo?.required !== false;
    return `<div class="question ${done ? 'done' : ''} ${!done && process.errors?.has('photo') ? 'field-error' : ''}"><div class="question-title">Фотография автомобиля${required ? ' <span class="required">*</span>' : ''}</div><p class="tiny">${done ? 'Фотография отправлена в 1С' : 'Отправьте фотографию через окно «Приём».'}</p><button data-action="open-defect-chat">Приём</button>${!done && process.errors?.has('photo') ? '<div class="error-text">Отправьте хотя бы одну фотографию</div>' : ''}</div>`;
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
    return renderSelectedCard() + `<div class="card"><h2>Действия МП</h2><div class="grid two"><button data-action="start-acceptance">Приём автомобиля</button><button data-action="open-defect-chat">Приём</button><button data-action="choose-post">Выбрать пост</button><button data-action="assign-executor">Назначить исполнителя</button></div></div>` + renderProcess('_acceptance', order._acceptance, 'complete-acceptance', 'Завершить приём');
  }

  function renderExecutorView() {
    const order = currentOrder();
    if (!order) return renderSelectedCard();
    const packageReady = Boolean(order.packageRef);
    return renderSelectedCard() + `<div class="card"><h2>Действия исполнителя</h2><div class="grid two"><button data-action="start-executor-work">Начать работу</button><button data-action="open-defect-chat">Добавить дефект</button><button data-action="package-create">Создать пакет УРВ</button><button data-action="package-start" ${!packageReady ? 'disabled' : ''}>Начать пакет</button><button data-action="package-pause" ${!packageReady ? 'disabled' : ''}>Начать перерыв</button><button data-action="package-close" ${!packageReady ? 'disabled' : ''}>Закрыть пакет</button><button data-action="production">Выработка</button></div></div>` + renderProcess('_checklist', order._checklist, 'complete-checklist', 'Завершить контрольный лист');
  }

  function renderTechView() {
    const order = currentOrder();
    if (!order) return renderSelectedCard();
    return renderSelectedCard() + `<div class="card"><h2>Действия технолога</h2><div class="grid two"><button data-action="open-defect-chat">Приём</button><button data-action="start-quality">Выходной контроль</button><button data-action="current-appeal">Текущее обращение</button><button data-action="service-history">История обслуживания</button></div></div>` + renderProcess('_quality', order._quality, 'complete-quality', 'Завершить выходной контроль');
  }

  function topicButton(topic, selected, type) {
    return `<button class="topic ${selected === topic.ref ? 'active' : ''}" data-action="select-${type}-topic" data-ref="${escAttr(topic.ref)}"><div class="topic-title"><span>${esc(topic.title)}</span>${topic.unread ? `<span class="badge bad">${topic.unread}</span>` : ''}</div><div class="topic-preview">${esc(topic.subtitle || topic.lastMessage || 'Нет сообщений')}</div>${topic.orderNumber || topic.vehiclePlate ? `<div class="topic-preview">ЗН ${esc(topic.orderNumber)} · ${esc(topic.vehiclePlate)}</div>` : ''}</button>`;
  }

  function renderMessages(messages) {
    if (!messages?.length) return '<div class="empty">Сообщений пока нет.</div>';
    return `<div class="chat">${messages.map(message => `<div class="message ${message.side}"><span class="message-meta">${esc(message.author)} · ${esc(message.createdAt)}</span>${esc(message.text)}${message.attachments?.length ? `<div class="attachments">${message.attachments.map(file => `<span class="attachment">📎 ${esc(file.fileName)}</span>`).join('')}</div>` : ''}</div>`).join('')}</div>`;
  }

  function renderClientsView() {
    const topic = state.clientTopics.find(item => item.ref === state.selectedClientTopic);
    const messages = topic ? (state.clientMessages[topic.ref] || []) : [];
    return `<div class="card"><div class="section-title"><h2>B2B: клиенты</h2><button class="button" data-action="load-client-topics">Обновить</button></div><p class="muted">Все исходящие и входящие сообщения проходят через 1С.</p><div class="topic-list">${state.clientTopics.length ? state.clientTopics.map(item => topicButton(item, state.selectedClientTopic, 'client')).join('') : '<div class="empty">Темы не загружены или отсутствуют.</div>'}</div></div>${topic ? `<div class="card"><div class="section-title"><div><h2>${esc(topic.title)}</h2><div class="tiny">${esc(topic.subtitle)}</div></div><button class="button" data-action="refresh-client-messages">Обновить</button></div>${renderMessages(messages)}<label for="clientMessage">Сообщение клиенту</label><textarea id="clientMessage" placeholder="Введите сообщение"></textarea><button class="primary" data-action="send-client-message">Отправить через 1С</button><div class="grid three" style="margin-top:8px"><button data-action="client-photo">Фото</button><button data-action="client-video">Видео</button><button data-action="client-file">Файл</button></div></div>` : ''}`;
  }

  function renderChatView() {
    const group = state.chatGroups.find(item => item.ref === state.selectedChatGroup);
    const messages = group ? (state.chatMessages[group.ref] || []) : [];
    return `<div class="card"><div class="section-title"><h2>Чат между отделами</h2><button class="button" data-action="load-chat-groups">Обновить</button></div><p class="muted">Состав групп, права и история переписки загружаются из 1С.</p><div class="topic-list">${state.chatGroups.length ? state.chatGroups.map(item => topicButton(item, state.selectedChatGroup, 'chat')).join('') : '<div class="empty">Группы не загружены или отсутствуют.</div>'}</div></div>${group ? `<div class="card"><div class="section-title"><div><h2>${esc(group.title)}</h2><div class="tiny">${esc(group.subtitle)}</div></div><button class="button" data-action="refresh-chat-messages">Обновить</button></div>${renderMessages(messages)}<label for="chatMessage">Сообщение в группу</label><textarea id="chatMessage" placeholder="Введите сообщение"></textarea><button class="primary" data-action="send-chat-message">Отправить через 1С</button><div class="grid three" style="margin-top:8px"><button data-action="chat-photo">Фото</button><button data-action="chat-video">Видео</button><button data-action="chat-file">Файл</button></div></div>` : ''}`;
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
    const order = currentOrder(), process = order?._acceptance; if (!process) return;
    validateProcess(process, false);
    if (process.photo?.required !== false && !acceptanceHasPhoto(order)) process.errors.add('photo');
    if (process.errors.size) { render(); toast('Заполните обязательные поля, ответы и отправьте фотографию, если она обязательна', true); return; }
    state.busy = true; render();
    try {
      await call1C('/acceptance/complete', orderPayload({ documentRef: process.documentRef, formValues: process.values, surveyRef: process.survey.surveyRef, surveyVersion: process.survey.version, answers: process.answers }));
      const mileageField = process.form.fields.find(f => /mileage|пробег/i.test(f.id));
      const hoursField = process.form.fields.find(f => /engineHours|hours|моточас/i.test(f.id));
      const reasonField = process.form.fields.find(f => /reason|appeal|причин/i.test(f.id));
      if (mileageField) order.mileage = String(process.values[mileageField.id] || '');
      if (hoursField) order.engineHours = String(process.values[hoursField.id] || '');
      if (reasonField) order.reason = String(process.values[reasonField.id] || '');
      order._acceptance = null; await loadSingleOrder(order.orderRef); render(); toast('Приём завершён, данные сохранены в 1С');
    } finally { state.busy = false; render(); }
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

  async function packageAction(action) {
    const order = currentOrder(); if (!order) return;
    const map = { create: '/worktime/packages/create', start: '/worktime/packages/start', pause: '/worktime/packages/pause', close: '/worktime/packages/close' };
    const response = await call1C(map[action], orderPayload({ packageRef: order.packageRef || '' }));
    const data = response.package || response.data?.package || response.data || response;
    order.packageRef = String(data.packageRef || data.ref || order.packageRef || '');
    order.packageStatus = String(data.status || ({create:'Создан',start:'В работе',pause:'Перерыв',close:'Закрыт'}[action]));
    render(); toast(`Пакет УРВ: ${order.packageStatus}`);
  }

  async function showProduction() {
    showSheet('Выработка', 'Количество закрытых часов текущего пользователя', '<div class="loading"><span class="spinner"></span>Получаем данные из 1С…</div>');
    try {
      const response = await call1C('/worktime/production', { employeeRef: state.user?.employeeRef || '', period: 'today' });
      const data = response.production || response.data?.production || response.data || response;
      const items = API.extractItems(response, ['items','packages']);
      $('sheetBody').innerHTML = `<div class="summary"><div class="stat"><span class="tiny">Закрыто часов</span><br><b>${esc(data.closedHours ?? data.hours ?? 0)}</b></div><div class="stat"><span class="tiny">Пакетов</span><br><b>${esc(data.closedPackages ?? items.length)}</b></div></div>${items.length ? `<h3>Закрытые пакеты</h3>${items.map(item => `<div class="entry"><b>${esc(item.orderNumber || item.packageNumber || item.name || '')}</b><br><span class="tiny">${esc(item.hours ?? item.closedHours ?? '')} ч · ${esc(item.closedAt || item.date || '')}</span></div>`).join('')}` : ''}<button class="primary" data-action="close-sheet">Закрыть</button>`;
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

  async function completeQuality() {
    const order = currentOrder(), process = order?._quality; if (!process) return;
    if (!validateProcess(process, true)) { render(); toast('Заполните все вопросы выходного контроля', true); return; }
    state.busy = true; render();
    try {
      await call1C('/quality/complete', orderPayload({ documentRef: process.documentRef, surveyRef: process.survey.surveyRef, surveyVersion: process.survey.version, answers: process.answers, formValues: process.values }));
      order._quality = null; render(); toast('Выходной контроль завершён и скрыт');
    } finally { state.busy = false; render(); }
  }

  async function showCurrentAppeal() {
    showSheet('Текущее обращение', 'Причина обращения загружается из 1С', '<div class="loading"><span class="spinner"></span>Загрузка…</div>');
    try {
      const response = await call1C('/quality/current-appeal', orderPayload());
      const appeal = response.appeal || response.data?.appeal || response.data || {};
      $('sheetBody').innerHTML = `<div class="reason"><b>Причина обращения:</b><br>${esc(appeal.reason || appeal.text || currentOrder()?.reason || 'Не заполнена')}</div>${appeal.createdAt ? `<p class="tiny">Создано: ${esc(appeal.createdAt)}</p>` : ''}<button class="primary" data-action="close-sheet">Закрыть</button>`;
    } catch (error) { $('sheetBody').innerHTML = `<div class="empty">${esc(error.message)}</div>`; }
  }

  async function downloadServiceHistory() {
    showSheet('История обслуживания', '1С формирует PDF-файл', '<div class="loading"><span class="spinner"></span>Формирование PDF…</div>');
    try {
      const response = await call1C('/quality/service-history/pdf', orderPayload());
      const file = API.normalizeFile(response.file || response.data?.file || response.document || response.data?.document);
      if (!file) throw new Error('1С не вернула PDF-файл');
      $('sheetBody').innerHTML = `<div class="entry-file"><span class="file-icon">📄</span><div><b>${esc(file.fileName)}</b><br><span class="tiny">${esc(file.mimeType || 'application/pdf')}</span></div></div><button class="primary" data-action="download-history">Скачать PDF</button>`;
      state.historyFile = file;
    } catch (error) { $('sheetBody').innerHTML = `<div class="empty">${esc(error.message)}</div><button class="primary" data-action="close-sheet">Закрыть</button>`; }
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
  const hasDocumentRef = ref => Boolean(String(ref || '').trim()) && !/^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(String(ref));
  async function ensureDefectSheet(order = currentOrder()) {
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
    if (hasDocumentRef(order.defectDocumentRef)) return existing(order.defectDocumentRef, order.defects);
    const pending = (async () => {
      // Read the current order first; a stale list must not trigger creation.
      const response = await call1C('/orders/get', {orderRef:ref,orderId:ref});
      const fresh = API.mapOrder(response.order || response.data?.order || response.data || response);
      if ((fresh.orderRef || fresh.id) !== ref) throw new Error('Не удалось проверить действующий документ выбранного ЗН');
      if (hasDocumentRef(fresh.defectDocumentRef)) return existing(fresh.defectDocumentRef, fresh.defects);
      const started = await call1C('/defects/start', {orderRef:ref,orderId:ref,existingDocumentRef:''});
      return attach(API.normalizeProcess(started, 'defectSheet'));
    })();
    pendingDefectSheets.set(ref,pending);
    try { return await pending; } finally { pendingDefectSheets.delete(ref); }
  }

  function renderDefectSheet() {
    const order = currentOrder(), sheet = order?._defectSheet;
    if (!sheet) return;
    const entries = sheet.entries || [];
    const entryHtml = entries.length ? entries.map((entry, index) => `<div class="entry"><div class="entry-head"><span>${esc(entry.author || 'Сотрудник')}</span><span>${esc(entry.createdAt || '')}</span></div>${entry.text ? `<div>${esc(entry.text)}</div>` : ''}${entry.file ? `<div class="entry-file"><span class="file-icon">${entry.type === 'video' ? '🎥' : entry.type === 'voice' ? '🎤' : '📷'}</span><div><b>${esc(entry.file.fileName)}</b>${entry.transcript ? `<br><span class="tiny">Текст: ${esc(entry.transcript)}</span>` : ''}</div></div>` : ''}${entry.type === 'voice' && !entry.transcript ? `<button class="button" style="margin-top:7px" data-action="transcribe-voice" data-index="${index}">Преобразовать голос в текст</button>` : ''}</div>`).join('') : '<div class="empty">В дефектовке пока нет записей.</div>';
    showSheet(`Дефектовочная ведомость · ЗН ${order.num}`, `Документ 1С: ${sheet.documentRef || 'не указан'}`, `${entryHtml}<label for="defectText">Информация о дефекте</label><textarea id="defectText" placeholder="Опишите выявленный дефект"></textarea><button class="primary" data-action="send-defect-text">Добавить в дефектовку</button><div class="grid three" style="margin-top:8px"><button data-action="defect-photo">Фото</button><button data-action="defect-video">Видео</button><button data-action="start-voice">Голос</button></div>${state.recording ? '<p class="recording">● Идёт запись голосового сообщения</p><button class="danger" data-action="stop-voice">Остановить и отправить</button>' : ''}<button class="secondary" style="margin-top:8px" data-action="complete-defect-sheet">Завершить дефектовку</button>`);
  }

  async function openDefectSheet() {
    showSheet('Дефектовочная ведомость', 'Проверяем документ в 1С', '<div class="loading"><span class="spinner"></span>Загрузка…</div>');
    try { await ensureDefectSheet(); if (state.view === 'mp' && currentOrder()?._acceptance?.active) render(); renderDefectSheet(); }
    catch (error) { $('sheetBody').innerHTML = `<div class="empty">${esc(error.message)}</div>`; }
  }

  async function sendDefectText() {
    const text = String($('defectText')?.value || '').trim();
    if (!text) return toast('Введите описание дефекта', true);
    const sheet = await ensureDefectSheet();
    const clientEntryId = requestId();
    const response = await call1C('/defects/entries/add', orderPayload({ documentRef: sheet.documentRef, clientEntryId, entry: { clientEntryId, type: 'text', text } }));
    const entry = response.entry || response.data?.entry || { id: clientEntryId, type: 'text', text, createdAt: nowIso(), author: state.user?.name || '' };
    sheet.entries.push(API.normalizeProcess({ entries: [entry] }, 'x').entries[0]);
    renderDefectSheet(); toast('Запись добавлена в дефектовку');
  }

  function configureFilePicker(target, accept, capture, multiple = false) {
    const input = $('filePicker');
    state.fileTarget = target; input.value = ''; input.accept = accept || '*/*'; input.multiple = multiple;
    if (capture) input.setAttribute('capture', capture); else input.removeAttribute('capture');
    input.click();
  }

  async function fileToPayload(file, kind) {
    let blob = file;
    if (kind === 'photo' && /^image\//.test(file.type)) blob = await compressImage(file);
    if (blob.size > CONFIG.maxUploadBytes) throw new Error(`Файл превышает лимит ${Math.round(CONFIG.maxUploadBytes / 1024 / 1024)} МБ`);
    const dataUrl = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob); });
    return { fileName: file.name || `${kind}-${Date.now()}`, mimeType: blob.type || file.type || 'application/octet-stream', sizeBytes: blob.size, contentBase64: String(dataUrl).split(',')[1], clientFileId: requestId() };
  }

  async function compressImage(file) {
    if (file.size < 900 * 1024) return file;
    const image = await createImageBitmap(file);
    const max = 1600, scale = Math.min(1, max / Math.max(image.width, image.height));
    const canvas = document.createElement('canvas'); canvas.width = Math.round(image.width * scale); canvas.height = Math.round(image.height * scale);
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', .82));
    image.close?.(); return blob || file;
  }

  async function uploadDefectFile(file, kind) {
    const order = currentOrder();
    const targetOrder = orderPayload();
    const sheet = await ensureDefectSheet(order);
    toast('Подготавливаем файл…');
    const payload = await fileToPayload(file, kind);
    const clientEntryId = requestId();
    const response = await call1C('/defects/entries/add', { ...targetOrder, documentRef: sheet.documentRef, clientEntryId, entry: { clientEntryId, type: kind, file: payload } });
    const raw = response.entry || response.data?.entry || { id: clientEntryId, type: kind, file: payload, createdAt: nowIso(), author: state.user?.name || '' };
    sheet.entries.push(API.normalizeProcess({ entries: [raw] }, 'x').entries[0]);
    render(); if (!$('overlay').classList.contains('hidden')) renderDefectSheet(); toast('Файл добавлен в дефектовку');
  }

  async function startVoiceRecording() {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      configureFilePicker({ type: 'defect', kind: 'voice' }, 'audio/*', true); return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream); const chunks = [];
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      recorder.onstop = async () => {
        stream.getTracks().forEach(track => track.stop());
        const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
        state.recording = null;
        try { await uploadDefectFile(new File([blob], `voice-${Date.now()}.webm`, { type: blob.type }), 'voice'); }
        catch (error) { toast(error.message, true); renderDefectSheet(); }
      };
      recorder.start(); state.recording = { recorder, stream }; renderDefectSheet();
    } catch (error) { toast(`Микрофон недоступен: ${error.message}`, true); }
  }

  function stopVoiceRecording(cancel = false) {
    const active = state.recording; if (!active) return;
    if (cancel) { active.recorder.onstop = null; active.stream.getTracks().forEach(track => track.stop()); state.recording = null; return; }
    active.recorder.stop();
  }

  async function transcribeVoice(index) {
    const sheet = currentOrder()?._defectSheet, entry = sheet?.entries?.[index]; if (!entry) return;
    const response = await call1C('/voice/transcribe', orderPayload({ documentRef: sheet.documentRef, entryRef: entry.id, fileRef: entry.file?.fileRef || '', language: 'ru-RU' }));
    entry.transcript = String(response.transcript || response.data?.transcript || response.text || '');
    renderDefectSheet(); toast(entry.transcript ? 'Голос преобразован в текст' : '1С не вернула распознанный текст', !entry.transcript);
  }

  async function completeDefectSheet() {
    const sheet = currentOrder()?._defectSheet; if (!sheet) return;
    await call1C('/defects/complete', orderPayload({ documentRef: sheet.documentRef }));
    currentOrder()._defectSheet = null; closeSheet(); await loadSingleOrder(currentOrder().orderRef); render(); toast('Дефектовка завершена');
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

  async function sendClientFile(file, kind) {
    const payload = await fileToPayload(file, kind);
    const ref = state.selectedClientTopic;
    await call1C('/clients/files/send', { topicRef: ref, topicId: ref, clientMessageId: requestId(), file: payload, kind });
    await loadClientMessages(ref); render(); toast('Вложение отправлено клиенту через 1С');
  }

  async function loadChatGroups() {
    const response = await call1C('/internal-chat/groups/list', {});
    state.chatGroups = API.extractItems(response, ['groups']).map(API.normalizeTopic);
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

  async function sendChatFile(file, kind) {
    const payload = await fileToPayload(file, kind);
    const ref = state.selectedChatGroup;
    await call1C('/internal-chat/files/send', { groupRef: ref, groupId: ref, clientMessageId: requestId(), file: payload, kind });
    await loadChatMessages(ref); render(); toast('Вложение отправлено в группу через 1С');
  }

  function startPolling() {
    clearInterval(state.pollTimer);
    if (CONFIG.pollMs < 5000) return;
    pollNotifications();
    state.pollTimer = setInterval(pollNotifications, CONFIG.pollMs);
  }

  async function pollNotifications() {
    if (!state.userId || document.hidden) return;
    try {
      const response = await call1C('/notifications/poll', { cursor: state.notificationCursor, limit: 20 }, { silent: true });
      const data = response.data || response;
      const events = API.extractItems(response, ['events','notifications']);
      state.notificationCursor = String(data.nextCursor || data.cursor || state.notificationCursor || '');
      for (const raw of events) {
        const event = {
          eventId: String(raw.eventId || raw.id || requestId()), type: String(raw.type || raw.eventType || ''),
          title: String(raw.title || 'Уведомление из 1С'), message: String(raw.message || raw.text || ''),
          orderRef: String(raw.orderRef || raw.orderId || raw.payload?.orderRef || ''), payload: raw.payload || {}
        };
        if (state.notifications.some(item => item.eventId === event.eventId)) continue;
        state.notifications.unshift(event);
        if (event.type === 'quality_control_requested' && event.orderRef) await openQualityNotification(event);
        else if (event.type === 'executor_assigned') toast(event.message || 'Вам назначен заказ-наряд');
      }
      renderNotifications();
    } catch (error) { console.warn('Notification poll:', error.message); }
  }

  async function openQualityNotification(event) {
    try {
      await loadSingleOrder(event.orderRef);
      state.view = 'tech';
      const order = currentOrder();
      if (event.payload?.survey) order._quality = API.normalizeProcess({ qualityControl: event.payload }, 'qualityControl');
      else await startQuality('notification');
      render(); toast(event.message || 'Назначен выходной контроль');
    } catch (error) { toast(`Не удалось открыть контроль: ${error.message}`, true); }
  }

  async function openNotification(eventId) {
    const event = state.notifications.find(item => item.eventId === eventId); if (!event) return;
    if (event.type === 'quality_control_requested') return openQualityNotification(event);
    if (event.orderRef) { await loadSingleOrder(event.orderRef); state.view = event.type === 'executor_assigned' ? 'executor' : 'orders'; render(); }
  }

  function showSettings() {
    showSheet('Подключение ИТУС', 'Параметры релизной версии', `<p><b>Пользователь MAX:</b><br>${esc(state.userId)}</p><p><b>Локальный маршрут API:</b><br>${esc(CONFIG.apiBase)}</p><p><b>HTTP-сервис 1С:</b><br>${esc(CONFIG.publicBase || 'задаётся сервером')}</p><p><b>Версия:</b> ${esc(CONFIG.version)}</p><div class="grid"><button data-action="test-1c">Проверить связь с 1С</button><button data-action="retry-init">Перезагрузить данные</button><button class="danger" data-action="logout">Выйти</button></div><p class="tiny">Адрес 1С задаётся в config/itus.config.js или переменной ONE_C_TARGET на сервере приложения. Секреты в браузерном файле не хранятся.</p>`);
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
    showSheet('Вход по QR-коду', 'Вставьте значение QR вручную', '<label for="qrValue">QR может содержать ID, ссылку или JSON</label><input id="qrValue" placeholder="Значение QR"><button class="primary" data-action="submit-auth-qr">Войти</button>');
  }

  async function scanAuthQr() {
    if (!navigator.mediaDevices?.getUserMedia || typeof BarcodeDetector === 'undefined') return manualQr();
    showSheet('Вход по QR-коду', 'Наведите камеру на QR-код', '<video id="qrVideo" autoplay muted playsinline style="width:100%;border-radius:17px;background:#000"></video><button class="secondary" data-action="manual-auth-qr">Ввести вручную</button>');
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
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
      if (target.type === 'defect') await uploadDefectFile(file, target.kind);
      if (target.type === 'client') await sendClientFile(file, target.kind);
      if (target.type === 'chat') await sendChatFile(file, target.kind);
    } catch (error) { toast(error.message, true); }
  }

  async function setView(view) {
    if (!state.views[view]) view = 'orders';
    state.view = view; render();
    try {
      if (view === 'clients' && !state.clientTopics.length) await loadClientTopics();
      if (view === 'chat' && !state.chatGroups.length) await loadChatGroups();
    } catch (error) { toast(error.message, true); }
  }

  if (typeof ResizeObserver !== 'undefined') {
    const header = document.querySelector('.top');
    if (header) new ResizeObserver(() => document.documentElement.style.setProperty('--header-height', `${header.offsetHeight}px`)).observe(header);
  }

  window.addEventListener('offline', () => connectionStatus('error', 'Нет подключения к интернету'));
  window.addEventListener('online', () => connectionStatus('', 'Интернет восстановлен · ожидаем ответа 1С'));

  document.addEventListener('focusin', event => {
    if (event.target.id === 'orderSearch') {
      const end = event.target.value.length;
      event.target.setSelectionRange(end, end);
    }
  });

  document.addEventListener('input', event => {
    if (event.target.id === 'orderSearch') {
      const { selectionStart, selectionEnd } = event.target;
      state.search = event.target.value; render();
      const search = $('orderSearch');
      search?.focus();
      search?.setSelectionRange(selectionStart ?? search.value.length, selectionEnd ?? search.value.length);
    }
    const processKey = event.target.dataset.processInput;
    const answerKey = event.target.dataset.processAnswer;
    if (processKey) { const process = currentOrder()?.[processKey]; if (process) { process.values[event.target.dataset.field] = event.target.value; process.errors?.delete(`field:${event.target.dataset.field}`); updateProcessProgress(processKey); } }
    if (answerKey) { const process = currentOrder()?.[answerKey]; if (process) { process.answers[event.target.dataset.question] = event.target.value; process.errors?.delete(`question:${event.target.dataset.question}`); updateProcessProgress(answerKey); } }
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
    try {
      if (action === 'view') return setView(button.dataset.view);
      if (action === 'login') { const id = String($('authUserId')?.value || '').trim(); if (!/^\d+$/.test(id)) return toast('ID пользователя MAX должен содержать только цифры', true); setAuth(id, 'manual'); return initialize(); }
      if (action === 'scan-auth-qr') return scanAuthQr();
      if (action === 'manual-auth-qr') return manualQr();
      if (action === 'submit-auth-qr') { const id = parseQr($('qrValue')?.value); if (!/^\d+$/.test(id)) return toast('QR не содержит корректный числовой ID', true); setAuth(id, 'qr'); closeSheet(); return initialize(); }
      if (action === 'settings') return showSettings();
      if (action === 'test-1c') return test1C();
      if (action === 'retry-init') { closeSheet(); return initialize(); }
      if (action === 'logout') { clearInterval(state.pollTimer); setAuth('', ''); Object.assign(state, { user:null,orders:[],selectedOrderId:'',initialized:false,error:'' }); closeSheet(); return render(); }
      if (action === 'close-sheet') return closeSheet();
      if (action === 'refresh-orders') { await loadOrders(); return render(); }
      if (action === 'select-order') { await loadSingleOrder(button.dataset.ref); return render(); }
      if (action === 'load-order') { await loadSingleOrder(currentOrder().orderRef); render(); return toast('Карточка обновлена из 1С'); }
      if (action === 'scan-order-qr') return showSheet('QR-код заказ-наряда', 'Введите значение, если камера недоступна', '<label for="orderQr">Номер или ссылка из QR</label><input id="orderQr"><button class="primary" data-action="submit-order-qr">Найти в 1С</button>');
      if (action === 'submit-order-qr') { const value = String($('orderQr')?.value || '').trim(); closeSheet(); if (!value) return toast('Введите значение QR', true); const response = await call1C('/orders/search', { search: value }); const items = API.extractOrders(response).map(API.mapOrder); if (!items.length) return toast('Заказ-наряд не найден', true); items.forEach(mergeOrder); state.selectedOrderId = items[0].id; return render(); }
      if (action === 'answer-option') { const process = currentOrder()?.[button.dataset.process]; if (!process) return; const id = button.dataset.question, value = button.dataset.value; if (button.dataset.type === 'multi') { const values = Array.isArray(process.answers[id]) ? process.answers[id] : []; process.answers[id] = values.includes(value) ? values.filter(item => item !== value) : values.concat(value); } else process.answers[id] = value; process.errors?.delete(`question:${id}`); return render(); }
      if (action === 'start-acceptance') return startAcceptance();
      if (action === 'complete-acceptance') return completeAcceptance();
      if (action === 'choose-post') return choosePost();
      if (action === 'set-post') return setPost(button.dataset.ref, button.dataset.name);
      if (action === 'assign-executor') return assignExecutor(false);
      if (action === 'assign-other-executor') return assignExecutor(true);
      if (action === 'set-executor') return setExecutor(button.dataset.ref, button.dataset.name);
      if (action === 'start-executor-work') return startExecutorWork();
      if (action === 'complete-checklist') return completeChecklist();
      if (action === 'package-create') return packageAction('create');
      if (action === 'package-start') return packageAction('start');
      if (action === 'package-pause') return packageAction('pause');
      if (action === 'package-close') return packageAction('close');
      if (action === 'production') return showProduction();
      if (action === 'start-quality') return startQuality('manual');
      if (action === 'complete-quality') return completeQuality();
      if (action === 'current-appeal') return showCurrentAppeal();
      if (action === 'service-history') return downloadServiceHistory();
      if (action === 'download-history') return downloadFile(state.historyFile);
      if (action === 'open-defect-chat') return openDefectSheet();
      if (action === 'defect-photo') return configureFilePicker({ type:'defect',kind:'photo' }, 'image/*', 'environment');
      if (action === 'defect-video') return configureFilePicker({ type:'defect',kind:'video' }, 'video/*', 'environment');
      if (action === 'send-defect-text') return sendDefectText();
      if (action === 'start-voice') return startVoiceRecording();
      if (action === 'stop-voice') return stopVoiceRecording(false);
      if (action === 'transcribe-voice') return transcribeVoice(Number(button.dataset.index));
      if (action === 'complete-defect-sheet') return completeDefectSheet();
      if (action === 'load-client-topics') return loadClientTopics();
      if (action === 'select-client-topic') { state.selectedClientTopic = button.dataset.ref; await loadClientMessages(button.dataset.ref); return render(); }
      if (action === 'refresh-client-messages') { await loadClientMessages(state.selectedClientTopic); return render(); }
      if (action === 'send-client-message') return sendClientMessage();
      if (action === 'client-photo') return configureFilePicker({type:'client',kind:'photo'}, 'image/*', 'environment');
      if (action === 'client-video') return configureFilePicker({type:'client',kind:'video'}, 'video/*', 'environment');
      if (action === 'client-file') return configureFilePicker({type:'client',kind:'file'}, '*/*');
      if (action === 'load-chat-groups') return loadChatGroups();
      if (action === 'select-chat-topic') { state.selectedChatGroup = button.dataset.ref; await loadChatMessages(button.dataset.ref); return render(); }
      if (action === 'refresh-chat-messages') { await loadChatMessages(state.selectedChatGroup); return render(); }
      if (action === 'send-chat-message') return sendChatMessage();
      if (action === 'chat-photo') return configureFilePicker({type:'chat',kind:'photo'}, 'image/*', 'environment');
      if (action === 'chat-video') return configureFilePicker({type:'chat',kind:'video'}, 'video/*', 'environment');
      if (action === 'chat-file') return configureFilePicker({type:'chat',kind:'file'}, '*/*');
      if (action === 'open-notification') return openNotification(button.dataset.event);
      if (action === 'dismiss-notification') { state.notifications = state.notifications.filter(item => item.eventId !== button.dataset.event); return renderNotifications(); }
    } catch (error) { console.error(action, error); toast(error.message || 'Ошибка выполнения операции', true); }
  });

  $('closeSheetButton').addEventListener('click', closeSheet);
  $('overlay').addEventListener('click', event => { if (event.target === $('overlay')) closeSheet(); });
  $('userPanel').addEventListener('click', () => state.userId ? showSettings() : null);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && state.initialized) pollNotifications(); });

  setAuth(readAuthFromContext(), 'max');
  render();
  if (state.userId) initialize();
})();
