import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const context = vm.createContext({console, setTimeout(fn){fn(); return 1;}, clearTimeout(){}});
context.window = context;
vm.runInContext(fs.readFileSync(new URL('../assets/operation-queue.js', import.meta.url), 'utf8'), context);

function memoryStore() {
  const records = new Map();
  return { records, async get(id){return records.get(id);}, async put(value){records.set(value.id, structuredClone(value));}, async delete(id){records.delete(id);}, async list(scope){return [...records.values()].filter(item=>item.scope===scope);} };
}

// Queues are isolated by user/API scope and a completion without confirmed idempotency is sent once.
{
  const store = memoryStore(); let completeCalls = 0;
  const queue = context.ITUS_OPERATION_QUEUE.create({store, delays:[0,0,0,0,0], sender:async () => {completeCalls++; throw Object.assign(new Error('response lost'), {code:'TIMEOUT'});}});
  await queue.prepare({id:'test|user-a|complete:doc-1', scope:'test|user-a', method:'/acceptance/complete', kind:'complete', operationMaxAttempts:1, requestId:'stable-complete', body:{documentRef:'doc-1'}});
  await queue.prepare({id:'test|user-b|entry:1', scope:'test|user-b', method:'/defects/entries/add', clientEntryId:'other-user', body:{documentRef:'doc-2'}});
  assert.equal((await queue.list('test|user-a')).length, 1);
  assert.equal((await queue.list('test|user-b')).length, 1);
  await assert.rejects(queue.run('test|user-a|complete:doc-1'), /response lost/);
  assert.equal(completeCalls, 1);
}

// Two tabs share one persistent lease; only the owner is allowed to send.
{
  const store = memoryStore();
  let leaseOwner = '', releaseSender;
  store.claim = async (_id, owner) => { if (leaseOwner && leaseOwner !== owner) return false; leaseOwner = owner; return true; };
  store.release = async (_id, owner) => { if (leaseOwner === owner) leaseOwner = ''; };
  const blockedSender = new Promise(resolve => { releaseSender = resolve; });
  let sends = 0;
  const options = {store, delays:[0], sender:async () => {sends++; await blockedSender; return {success:true};}};
  const tabA = context.ITUS_OPERATION_QUEUE.create(options);
  const tabB = context.ITUS_OPERATION_QUEUE.create(options);
  await tabA.prepare({id:'shared-entry', scope:'test|user-a', method:'/defects/entries/add', clientEntryId:'shared', body:{documentRef:'doc'}});
  const first = tabA.run('shared-entry');
  await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(tabB.run('shared-entry'), /другой вкладке/);
  releaseSender(); await first;
  assert.equal(sends, 1);
}

{
  const store = memoryStore(), received = [], saved = new Set();
  const queue = context.ITUS_OPERATION_QUEUE.create({store, delays:[0,0,0,0,0], sender:async operation => {
    received.push(structuredClone(operation)); saved.add(operation.clientEntryId);
    if (received.length === 1) throw Object.assign(new Error('response lost'), {code:'TIMEOUT'});
    return {success:true};
  }});
  await queue.prepare({id:'entry:1', method:'/defects/entries/add', clientEntryId:'entry-uuid', requestId:'request-uuid', body:{clientEntryId:'entry-uuid',entry:{clientEntryId:'entry-uuid',type:'text',text:'same'}}});
  await queue.run('entry:1');
  assert.equal(received.length, 2);
  assert.equal(received[0].clientEntryId, received[1].clientEntryId);
  assert.deepEqual(received[0].body, received[1].body);
  assert.equal(saved.size, 1);
}

{
  const store = memoryStore(); let calls = 0;
  const queue = context.ITUS_OPERATION_QUEUE.create({store, delays:[0,0,0,0,0], sender:async () => {calls++; throw Object.assign(new Error('offline'), {code:'TIMEOUT'});}});
  await queue.prepare({id:'entry:2', method:'/defects/entries/add', clientEntryId:'stable', requestId:'stable-request', body:{entry:{text:'keep'}}});
  await assert.rejects(queue.run('entry:2'), /offline/);
  assert.equal(calls, 5);
  assert.equal((await store.get('entry:2')).attempts, 5);
  assert.equal((await store.get('entry:2')).status, 'failed');
}

{
  const store = memoryStore(), methods = [];
  const queue = context.ITUS_OPERATION_QUEUE.create({store, delays:[0,0,0,0,0], sender:async operation => {methods.push(operation.method); throw Object.assign(new Error('check data'), {status:422});}});
  await queue.prepare({id:'entry:3', method:'/defects/entries/add', clientEntryId:'invalid', body:{entry:{text:''}}});
  await assert.rejects(queue.run('entry:3'), /check data/);
  assert.deepEqual(methods, ['/defects/entries/add']);
  assert.equal((await store.get('entry:3')).status, 'invalid');
  assert.ok(!methods.includes('/acceptance/complete'));
}

console.log('Operation queue: OK (lost response deduplication, five-attempt cap, 422 and completion gate).');
