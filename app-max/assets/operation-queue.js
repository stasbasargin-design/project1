(function (root) {
  'use strict';

  const DB_NAME = 'itus-operation-queue';
  const STORE_NAME = 'operations';
  const MAX_ATTEMPTS = 5;
  const RETRY_DELAYS_MS = [0, 1000, 3000, 7000, 15000];

  const clone = value => JSON.parse(JSON.stringify(value));
  const wait = ms => ms > 0 ? new Promise(resolve => setTimeout(resolve, ms)) : Promise.resolve();

  function openDb() {
    if (!root.indexedDB) return Promise.resolve(null);
    return new Promise(resolve => {
      const request = root.indexedDB.open(DB_NAME, 2);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    });
  }

  function indexedDbStore() {
    const transact = async (mode, action) => {
      const db = await openDb();
      if (!db) throw new Error('IndexedDB недоступна: пакет отправки не может быть сохранён');
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, mode);
        const result = action(tx.objectStore(STORE_NAME));
        tx.oncomplete = () => resolve(result?.result);
        tx.onerror = () => reject(tx.error || result?.error || new Error('Ошибка IndexedDB'));
        tx.onabort = () => reject(tx.error || new Error('Операция IndexedDB отменена'));
      });
    };
    const claim = async (id, owner, leaseMs) => {
      const db = await openDb();
      if (!db) throw new Error('IndexedDB недоступна: пакет отправки не может быть заблокирован');
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const request = store.get(id);
        let acquired = false;
        request.onsuccess = () => {
          const value = request.result;
          if (!value) return;
          const activeOtherLease = value.leaseOwner && value.leaseOwner !== owner && Number(value.leaseUntil || 0) > Date.now();
          if (activeOtherLease) return;
          store.put({ ...value, leaseOwner: owner, leaseUntil: Date.now() + leaseMs });
          acquired = true;
        };
        tx.oncomplete = () => resolve(acquired);
        tx.onerror = () => reject(tx.error || new Error('Ошибка блокировки IndexedDB'));
      });
    };
    const release = async (id, owner) => {
      const value = await transact('readonly', store => store.get(id));
      if (!value || value.leaseOwner !== owner) return;
      await transact('readwrite', store => store.put({ ...value, leaseOwner: '', leaseUntil: 0 }));
    };
    const putBatch = async values => {
      const db = await openDb();
      if (!db) throw new Error('IndexedDB недоступна: пакет отправки не может быть сохранён');
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const saved = new Array(values.length);
        values.forEach((value, index) => {
          const request = store.get(value.id);
          request.onsuccess = () => {
            saved[index] = request.result || clone(value);
            if (!request.result) store.put(saved[index]);
          };
        });
        tx.oncomplete = () => resolve(saved);
        tx.onerror = () => reject(tx.error || new Error('Не удалось сохранить полный пакет в IndexedDB'));
        tx.onabort = () => reject(tx.error || new Error('Сохранение полного пакета отменено'));
      });
    };
    return {
      get: id => transact('readonly', store => store.get(id)),
      put: value => transact('readwrite', store => store.put(clone(value))),
      delete: id => transact('readwrite', store => store.delete(id)),
      list: async scope => (await transact('readonly', store => store.getAll()) || []).filter(item => item.scope === scope),
      claim, release, putBatch
    };
  }

  function isRetryable(error) {
    const status = Number(error?.status || 0);
    if (status === 422) return false;
    return status === 0 || status >= 500 || error?.name === 'TypeError' || error?.code === 'TIMEOUT';
  }

  function create({ store = indexedDbStore(), sender, delays = RETRY_DELAYS_MS, maxAttempts = MAX_ATTEMPTS } = {}) {
    if (typeof sender !== 'function') throw new Error('Operation queue sender is required');
    const owner = root.crypto?.randomUUID?.() || `queue-${Date.now()}-${Math.random()}`;
    const running = new Map();

    async function prepare({ id, method, body, clientEntryId = '', requestId = '', kind = 'entry', scope = '', documentKey = '', operationMaxAttempts = maxAttempts }) {
      const existing = await store.get(id);
      if (existing) return existing;
      const operation = {
        id, method, body: clone(body), clientEntryId, requestId,
        kind, scope, documentKey, maxAttempts: operationMaxAttempts, attempts: 0, status: 'pending', createdAt: new Date().toISOString(), error: '', leaseOwner: '', leaseUntil: 0
      };
      await store.put(operation);
      return operation;
    }

    async function prepareBatch(definitions) {
      const createdAt = new Date().toISOString();
      const values = definitions.map(({ id, method, body, clientEntryId = '', requestId = '', kind = 'entry', scope = '', documentKey = '', operationMaxAttempts = maxAttempts }) => ({
        id, method, body:clone(body), clientEntryId, requestId, kind, scope, documentKey,
        maxAttempts:operationMaxAttempts, attempts:0, status:'pending', createdAt, error:'', leaseOwner:'', leaseUntil:0
      }));
      if (store.putBatch) return store.putBatch(values);
      return Promise.all(definitions.map(definition => prepare(definition)));
    }

    async function execute(id, { manual = false } = {}) {
      let operation = await store.get(id);
      if (!operation) throw new Error('Сохранённый пакет отправки не найден');
      if (manual) {
        operation = { ...operation, attempts: 0, status: 'pending', error: '' };
        await store.put(operation);
      }
      const attemptLimit = Number(operation.maxAttempts || maxAttempts);
      const acquired = store.claim ? await store.claim(id, owner, 600000) : true;
      if (!acquired) throw Object.assign(new Error('Операция уже отправляется в другой вкладке'), {code:'QUEUE_BUSY'});
      try {
      while (operation.attempts < attemptLimit) {
        const delay = Number(delays[operation.attempts] || 0);
        if (delay) await wait(delay);
        operation = { ...operation, attempts: operation.attempts + 1, status: 'sending' };
        await store.put(operation); // Persist before transport so a lost response still consumes the attempt.
        try {
          const response = await sender(operation);
          await store.delete(id);
          return response;
        } catch (error) {
          const validation = Number(error?.status || 0) === 422;
          operation = {
            ...operation,
            status: validation ? 'invalid' : (operation.attempts >= attemptLimit || !isRetryable(error) ? 'failed' : 'pending'),
            error: String(error?.message || error || '')
          };
          await store.put(operation);
          if (validation || !isRetryable(error) || operation.attempts >= attemptLimit) {
            error.operation = operation;
            error.queueStatus = operation.status;
            throw error;
          }
        }
      }
      const error = new Error('Не удалось подтвердить отправку');
      error.operation = operation;
      error.queueStatus = 'failed';
      throw error;
      } finally {
        await store.release?.(id, owner);
      }
    }

    function run(id, options) {
      if (running.has(id)) return running.get(id);
      const promise = execute(id, options).finally(() => running.delete(id));
      running.set(id, promise);
      return promise;
    }

    return { prepare, prepareBatch, run, get: id => store.get(id), list: scope => store.list ? store.list(scope) : Promise.resolve([]), MAX_ATTEMPTS: maxAttempts };
  }

  root.ITUS_OPERATION_QUEUE = { create, indexedDbStore, isRetryable, MAX_ATTEMPTS, RETRY_DELAYS_MS };
})(typeof window !== 'undefined' ? window : globalThis);
