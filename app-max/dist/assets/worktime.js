(function (root) {
  'use strict';
  const methods = Object.freeze({
    works: '/worktime/orders/works',
    packages: '/worktime/packages/list',
    executors: '/worktime/executors/list',
    participation: '/worktime/participation/validate',
    create: '/worktime/packages/create',
    start: '/worktime/packages/start', pause: '/worktime/packages/pause', close: '/worktime/packages/close'
  });
  function requireRef(value, label) {
    if (typeof value !== 'string' || !value.trim()) throw new Error(`${label}: не указана ссылка`);
    return value;
  }
  function participation(items) {
    if (!Array.isArray(items) || !items.length) throw new Error('Выберите исполнителей');
    const refs = new Set();
    let total = 0;
    const result = items.map(item => {
      const employeeRef = requireRef(item?.employeeRef, 'Исполнитель');
      if (refs.has(employeeRef)) throw new Error('Исполнитель указан повторно');
      refs.add(employeeRef);
      const value = item.percent;
      if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 100 || Math.abs(value * 100 - Math.round(value * 100)) > 1e-8) {
        throw new Error('Доля должна быть больше 0 и не больше 100, не более двух знаков после запятой');
      }
      total += Math.round(value * 100);
      return { employeeRef, percent: value };
    });
    if (total !== 10000) throw new Error(`Сумма участия должна быть 100% (сейчас ${total / 100}%)`);
    return result;
  }
  function validateRequest(method, body) {
    if (!Object.values(methods).includes(method)) return body;
    requireRef(body?.orderRef, 'Заказ-наряд');
    if (method === methods.packages) return body;
    if ([methods.start, methods.pause, methods.close].includes(method)) {
      requireRef(body.packageRef, 'Пакет');
      return body;
    }
    if (method === methods.works) return body;
    requireRef(body.workshopRef, 'Цех');
    if (method === methods.executors) return body;
    participation(body.participants);
    if (!Array.isArray(body.workRefs) || !body.workRefs.length) throw new Error('Выберите работы заказ-наряда');
    body.workRefs.forEach(ref => requireRef(ref, 'Работа'));
    if (new Set(body.workRefs).size !== body.workRefs.length) throw new Error('Работа указана повторно');
    if (method === methods.create) requireRef(body.clientPackageId, 'Идентификатор создания');
    return body;
  }
  const requests = [];
  let tracing = false;
  const consoleAPI = Object.freeze({
    enable() { tracing = true; requests.length = 0; console.info('Worktime: запись запросов включена, без токенов и контекста MAX'); },
    disable() { tracing = false; requests.length = 0; },
    show() { console.table(requests.map(x => ({ method: x.method, request: JSON.stringify(x.request) }))); return JSON.parse(JSON.stringify(requests)); },
    methods() { console.table(methods); return methods; }
  });
  function record(method, body) {
    if (!tracing || !Object.values(methods).includes(method)) return;
    const request = {};
    for (const key of ['orderRef','onlyOpen','withoutActivePackages','workshopRef','workRefs','participants','clientPackageId','packageRef']) if (body[key] !== undefined) request[key] = body[key];
    requests.push(JSON.parse(JSON.stringify({method,request})));
    if (requests.length > 30) requests.shift();
    console.info('[ITUS worktime]', method, JSON.stringify(request));
    if (root.ITUS_REVIEW_MODE) root.dispatchEvent(new CustomEvent('itus:worktime-request', {detail:{method,request}}));
  }
  root.ITUS_WORKTIME_CONSOLE = consoleAPI;
  root.ITUS_WORKTIME = Object.freeze({ methods, participation, validateRequest, record });
})(typeof window !== 'undefined' ? window : globalThis);
