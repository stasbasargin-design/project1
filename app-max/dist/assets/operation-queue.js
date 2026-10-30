(function (root) {
  'use strict';

  const DB_NAME = 'itus-operation-queue';
  const STORE_NAME = 'operations';
  const MAX_ATTEMPTS = 5;
  const LEASE_MS = 600000;
  const RETRY_DELAYS_MS = [0, 1000, 3000, 7000, 15000];

  // IndexedDB preserves immutable Blob values without expanding large videos into Base64.
  const clone = value => {
    if(typeof root.structuredClone==='function')return root.structuredClone(value);
    if(value===null || typeof value!=='object')return value;
    if(typeof root.Blob==='function' && value instanceof root.Blob)return value.slice(0,value.size,value.type);
    if(Array.isArray(value))return value.map(clone);
    return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,clone(item)]));
  };
  const wait = ms => ms > 0 ? new Promise(resolve => setTimeout(resolve, ms)) : Promise.resolve();

  function contentBody(value) {
    const body = clone(value);
    if (body?.entry?.file) delete body.entry.file.clientFileId;
    return body;
  }

  function sameOperation(existing, value) {
    return existing.method === value.method
      && existing.kind === value.kind
      && existing.scope === value.scope
      && existing.documentKey === value.documentKey
      && existing.clientEntryId === value.clientEntryId
      && JSON.stringify(contentBody(existing.body)) === JSON.stringify(contentBody(value.body));
  }

  function requireSameOperation(existing, value) {
    if (sameOperation(existing, value)) return existing;
    throw Object.assign(new Error('Сохранённый пакет отправки не совпадает с новым содержимым'), { code:'QUEUE_ID_CONFLICT' });
  }

  function openDb() {
    if (!root.indexedDB) return Promise.resolve(null);
    return new Promise((resolve,reject) => {
      // Version 4 fences old senders that do not understand an S3-buffer route.
      // The store and all v2/v3 operations (including Blobs) remain intact.
      const request = root.indexedDB.open(DB_NAME, 4);
      let blocked=false;
      request.onblocked=()=>{blocked=true;reject(Object.assign(new Error('Закройте старые вкладки I-MAX и повторите сохранение. Выбранные файлы остаются в форме.'),{code:'QUEUE_UPGRADE_BLOCKED'}));};
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      };
      request.onsuccess = () => {
        if(blocked){request.result.close();return;}
        request.result.onversionchange=()=>request.result.close();
        resolve(request.result);
      };
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
        let claimed = null;
        request.onsuccess = () => {
          const value = request.result;
          if (!value) return;
          const now = Date.now();
          const activeOtherLease = value.leaseOwner && value.leaseOwner !== owner && Number(value.leaseUntil || 0) > now;
          if (activeOtherLease) return;
          claimed = { ...value, leaseOwner: owner, leaseUntil: now + leaseMs };
          store.put(claimed);
        };
        tx.oncomplete = () => resolve(claimed && clone(claimed));
        tx.onerror = () => reject(tx.error || new Error('Ошибка блокировки IndexedDB'));
      });
    };
    const writeOwned = async (id, owner, value) => {
      const db = await openDb();
      if (!db) throw new Error('IndexedDB недоступна');
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const request = store.get(id);
        let saved = null;
        request.onsuccess = () => {
          const current = request.result;
          if (!current || current.leaseOwner !== owner || Number(current.leaseUntil || 0) <= Date.now()) return;
          saved = { ...clone(value), id: current.id, leaseOwner: current.leaseOwner, leaseUntil: current.leaseUntil };
          store.put(saved);
        };
        tx.oncomplete = () => resolve(saved && clone(saved));
        tx.onerror = () => reject(tx.error || new Error('Не удалось сохранить операцию с блокировкой'));
      });
    };
    const removeOwned = async (id, owner) => {
      const db = await openDb();
      if (!db) throw new Error('IndexedDB недоступна');
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const request = store.get(id);
        let removed = false;
        request.onsuccess = () => {
          const current = request.result;
          if (!current || current.leaseOwner !== owner || Number(current.leaseUntil || 0) <= Date.now()) return;
          store.delete(id);
          removed = true;
        };
        tx.oncomplete = () => resolve(removed);
        tx.onerror = () => reject(tx.error || new Error('Не удалось удалить операцию с блокировкой'));
      });
    };
    const release = async (id, owner) => {
      const db = await openDb();
      if (!db) return false;
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const request = store.get(id);
        let released = false;
        request.onsuccess = () => {
          const current = request.result;
          if (!current || current.leaseOwner !== owner) return;
          store.put({ ...current, leaseOwner: '', leaseUntil: 0 });
          released = true;
        };
        tx.oncomplete = () => resolve(released);
        tx.onerror = () => reject(tx.error || new Error('Не удалось освободить блокировку операции'));
      });
    };
    const renew = async (id, owner, leaseMs) => {
      const db=await openDb(); if(!db)return false;
      return new Promise((resolve,reject)=>{
        const tx=db.transaction(STORE_NAME,'readwrite'),store=tx.objectStore(STORE_NAME),request=store.get(id);
        let renewed=false;
        request.onsuccess=()=>{const value=request.result;if(value?.leaseOwner===owner && Number(value.leaseUntil)>Date.now()){store.put({...value,leaseUntil:Date.now()+leaseMs});renewed=true;}};
        tx.oncomplete=()=>resolve(renewed);tx.onerror=()=>reject(tx.error || new Error('Ошибка продления блокировки'));
      });
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
      claim, writeOwned, removeOwned, release, renew, putBatch
    };
  }

  function isRetryable(error) {
    const status = Number(error?.status || 0);
    if (status === 422) return false;
    return status === 0 || status >= 500 || error?.name === 'TypeError' || error?.code === 'TIMEOUT';
  }

  function create({ store = indexedDbStore(), sender, context = () => null, guard = () => {}, snapshot = () => null, delays = RETRY_DELAYS_MS, maxAttempts = MAX_ATTEMPTS } = {}) {
    if (typeof sender !== 'function') throw new Error('Operation queue sender is required');
    const owner = root.crypto?.randomUUID?.() || `queue-${Date.now()}-${Math.random()}`;
    const running = new Map();
    const lanes={file:Promise.resolve(),text:Promise.resolve()};

    function operationFromDefinition({ id, method, body, clientEntryId = '', requestId = '', kind = 'entry', scope = '', documentKey = '', operationMaxAttempts = maxAttempts }, createdAt = new Date().toISOString()) {
      return {
        id, method, body: clone(body), clientEntryId, requestId,
        kind, scope, documentKey, envelopeContext:clone(snapshot()), maxAttempts: operationMaxAttempts, attempts: 0, status: 'pending', createdAt, error: '', diagnostic: null, leaseOwner: '', leaseUntil: 0
      };
    }

    async function prepare(definition) {
      return (await prepareBatch([definition]))[0];
    }

    async function prepareBatch(definitions) {
      const createdAt = new Date().toISOString();
      const values = definitions.map(definition => operationFromDefinition(definition, createdAt));
      const unique = new Map();
      for (const value of values) {
        const previous = unique.get(value.id);
        if (previous) requireSameOperation(previous, value);
        else unique.set(value.id, value);
      }
      const uniqueValues = [...unique.values()];
      const existing = await Promise.all(uniqueValues.map(value => store.get(value.id)));
      existing.forEach((operation, index) => {
        if (operation) requireSameOperation(operation, uniqueValues[index]);
      });
      const missing = uniqueValues.filter((value, index) => !existing[index]);
      let stored = [];
      if (missing.length) {
        stored = store.putBatch
          ? await store.putBatch(missing)
          : await Promise.all(missing.map(value => store.put(value).then(() => value)));
      }
      const byId = new Map(stored.map(value => [value.id, value]));
      const resolved = new Map();
      uniqueValues.forEach((value, index) => {
        const operation = existing[index] || byId.get(value.id) || value;
        resolved.set(value.id, requireSameOperation(operation, value));
      });
      return values.map(value => resolved.get(value.id));
    }

    async function execute(id, { manual = false } = {}) {
      const executionContext = context();
      let operation = await store.get(id);
      if (!operation) throw Object.assign(new Error('Сохранённый пакет отправки не найден'),{code:'QUEUE_NOT_FOUND'});
      guard(operation, executionContext);
      function assertAutomaticRetryAllowed() {
        if (manual || !['invalid','failed'].includes(operation.status)) return;
        throw Object.assign(new Error('Сохранённый пакет требует ручной проверки перед повтором'), {
          code: operation.error || 'SEND_FAILED',
          status: Number(operation.diagnostic?.status || 0),
          diagnostic: operation.diagnostic || undefined,
          operation,
          queueStatus: operation.status
        });
      }
      assertAutomaticRetryAllowed();
      const attemptLimit = Number(operation.maxAttempts || maxAttempts);
      const claimed = store.claim ? await store.claim(id, owner, LEASE_MS) : true;
      const acquired = Boolean(claimed);
      if (!acquired) throw Object.assign(new Error('Операция уже отправляется в другой вкладке'), {code:'QUEUE_BUSY', leaseUntil:Number(operation.leaseUntil || 0)});
      operation = claimed === true ? await store.get(id) : claimed;
      if (!operation) throw Object.assign(new Error('Блокировка операции потеряна'), {code:'QUEUE_BUSY'});
      const leaseLost = () => Object.assign(new Error('Блокировка операции потеряна; перед повтором сверьте результат отправки'), {code:'QUEUE_BUSY', leaseLost:true});
      let lost=false, renewing=null;
      const heartbeat=store.renew && root.setInterval?.(()=>{
        if(renewing)return;
        renewing=store.renew(id,owner,LEASE_MS).then(ok=>{if(!ok)lost=true;},()=>{lost=true;}).finally(()=>{renewing=null;});
      },30000);
      const persistOwned = async value => {
        if(lost)throw leaseLost();
        const saved = store.writeOwned
          ? await store.writeOwned(id, owner, value)
          : (await store.put(value), value);
        if (!saved) throw leaseLost();
        operation = saved;
        return saved;
      };
      try {
      guard(operation, executionContext);
      // Another tab may reject the operation between the first read and claim.
      // Only the value returned by the atomic claim is authoritative now.
      assertAutomaticRetryAllowed();
      if(!operation.envelopeContext) await persistOwned({...operation,envelopeContext:clone(snapshot())});
      if (manual) await persistOwned({ ...operation, attempts: 0, status: 'pending', error: '', diagnostic: null });
      while (operation.attempts < attemptLimit) {
        guard(operation, executionContext);
        const delay = Number(delays[operation.attempts] || 0);
        if (delay) await wait(delay);
        guard(operation, executionContext);
        await persistOwned({ ...operation, attempts: operation.attempts + 1, status: 'sending' }); // Persist before transport so a lost response still consumes the attempt.
        try {
          guard(operation, executionContext);
          const response = await sender(operation, executionContext, {manual});
          guard(operation, executionContext);
          if(lost)throw leaseLost();
          const removed = store.removeOwned
            ? await store.removeOwned(id, owner)
            : (await store.delete(id), true);
          if (!removed) throw leaseLost();
          return response;
        } catch (error) {
          if (error?.leaseLost) throw error;
          if (error?.queuePaused || error?.code === 'SESSION_CHANGED') {
            await persistOwned({ ...operation, status:'pending', error:'', diagnostic:null });
            throw error;
          }
          const validation = Number(error?.status || 0) === 422;
          operation = {
            ...operation,
            status: validation ? 'invalid' : (operation.attempts >= attemptLimit || !isRetryable(error) ? 'failed' : 'pending'),
            error: String(error?.code || (validation ? 'HTTP_422' : 'SEND_FAILED')),
            diagnostic: error?.diagnostic && typeof error.diagnostic === 'object' ? clone(error.diagnostic) : null
          };
          await persistOwned(operation);
          if (validation || !isRetryable(error) || operation.attempts >= attemptLimit) {
            error.operation = operation;
            error.queueStatus = operation.status;
            throw error;
          }
        }
      }
      await persistOwned({...operation,status:'failed',error:operation.error || 'ATTEMPTS_EXHAUSTED'});
      const error = new Error('Не удалось подтвердить отправку');
      error.operation = operation;
      error.queueStatus = 'failed';
      throw error;
      } finally {
        if(heartbeat)root.clearInterval(heartbeat);
        if(renewing)await renewing;
        await store.release?.(id, owner);
      }
    }

    function run(id, options) {
      if (running.has(id)) return running.get(id);
      const queuedContext=context();
      const promise = (async()=>{
        const operation=await store.get(id);
        if(!operation)throw Object.assign(new Error('Пакет уже отправлен'),{code:'QUEUE_NOT_FOUND'});
        guard(operation,queuedContext);
        const lane=(operation.body?.file || operation.body?.entry?.file)?'file':'text';
        const task=lanes[lane].catch(()=>{}).then(()=>{guard(operation,queuedContext);return execute(id,options);});
        lanes[lane]=task.catch(()=>{});
        return task;
      })().finally(() => running.delete(id));
      running.set(id, promise);
      return promise;
    }

    return { prepare, prepareBatch, run, get: id => store.get(id), list: scope => store.list ? store.list(scope) : Promise.resolve([]), MAX_ATTEMPTS: maxAttempts };
  }

  root.ITUS_OPERATION_QUEUE = { create, indexedDbStore, isRetryable, MAX_ATTEMPTS, RETRY_DELAYS_MS };
})(typeof window !== 'undefined' ? window : globalThis);
