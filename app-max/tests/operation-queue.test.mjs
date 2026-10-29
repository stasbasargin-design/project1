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

// Queues are isolated by user/API scope.
{
  const store = memoryStore();
  const queue = context.ITUS_OPERATION_QUEUE.create({store, delays:[0,0,0,0,0], sender:async () => ({success:true})});
  await queue.prepare({id:'test|user-a|complete:doc-1', scope:'test|user-a', method:'/acceptance/complete', kind:'complete', requestId:'stable-complete', body:{documentRef:'doc-1'}});
  await queue.prepare({id:'test|user-b|entry:1', scope:'test|user-b', method:'/defects/entries/add', clientEntryId:'other-user', body:{documentRef:'doc-2'}});
  assert.equal((await queue.list('test|user-a')).length, 1);
  assert.equal((await queue.list('test|user-b')).length, 1);
}

// A saved package keeps its identifiers and payload after an application restart.
{
  const store = memoryStore(), sent = [];
  store.putBatch = async values => { for (const value of values) await store.put(value); return values; };
  const queue = context.ITUS_OPERATION_QUEUE.create({store, delays:[0], sender:async operation => { sent.push(structuredClone(operation)); return {success:true}; }});
  const definitions = ['one','two','three'].map(name => ({id:`entry:${name}`,scope:'test|user-a',method:'/defects/entries/add',kind:'entry',documentKey:'doc-3',clientEntryId:`client:${name}`,body:{documentRef:'doc-3',clientEntryId:`client:${name}`,entry:{clientEntryId:`client:${name}`,file:{fileName:`${name}.jpg`,contentBase64:name,clientFileId:`file:${name}`}}}}));
  const prepared = await queue.prepareBatch(definitions);
  assert.equal((await queue.list('test|user-a')).length, 3);
  const restartedQueue = context.ITUS_OPERATION_QUEUE.create({store, delays:[0], sender:async operation => { sent.push(structuredClone(operation)); return {success:true}; }});
  const replay = await restartedQueue.prepareBatch(definitions.map(item => ({...item, requestId:'changed-request', body:{...item.body, entry:{...item.body.entry, file:{...item.body.entry.file, clientFileId:'changed-file-id'}}}})));
  assert.deepEqual(replay.map(item => item.clientEntryId), prepared.map(item => item.clientEntryId));
  assert.deepEqual(replay.map(item => item.body.entry.file.contentBase64), ['one','two','three']);
  await assert.rejects(
    restartedQueue.prepareBatch(definitions.map(item => ({...item, body:{...item.body, entry:{...item.body.entry, file:{...item.body.entry.file, contentBase64:'changed-before-retry'}}}}))),
    error => error?.code === 'QUEUE_ID_CONFLICT'
  );
  definitions[0].body.entry.file.contentBase64 = 'changed-after-save';
  for (const operation of prepared) await queue.run(operation.id);
  assert.deepEqual(sent.map(item => item.body.entry.file.contentBase64), ['one','two','three']);
  assert.equal(new Set(sent.map(item => item.clientEntryId)).size, 3);
}

// 1C completes the document but the first response is lost. The retry is identical and 1C
// returns the original result for the same requestId instead of completing a second document.
{
  for (const method of ['/acceptance/complete', '/defects/complete']) {
    const store = memoryStore(), sent = []; let completedDocuments = 0;
    const queue = context.ITUS_OPERATION_QUEUE.create({store, delays:[0,0,0,0,0], sender:async operation => {
      sent.push({requestId:operation.requestId, body:structuredClone(operation.body)});
      if (sent.length === 1) { completedDocuments++; throw Object.assign(new Error('complete response lost'), {code:'TIMEOUT'}); }
      return {success:true, completed:true};
    }});
    const id = `complete:lost-response:${method}`;
    await queue.prepare({id, scope:'test|user-a', method, kind:'complete', requestId:`complete-request-id:${method}`, body:{documentRef:`document:${method}`,answers:{required:'ok'}}});
    const result = await queue.run(id);
    assert.equal(result.completed, true);
    assert.equal(sent.length, 2);
    assert.equal(sent[0].requestId, sent[1].requestId);
    assert.deepEqual(sent[0].body, sent[1].body);
    assert.equal(completedDocuments, 1);
  }
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
  const queue = context.ITUS_OPERATION_QUEUE.create({store, delays:[0,0,0,0,0], sender:async operation => {methods.push(operation.method); throw Object.assign(new Error('check data'), {status:422, diagnostic:{status:422,route:operation.method,requestId:operation.requestId,time:'2026-10-27T10:00:00.000Z',code:'VALIDATION',message:'safe'}});}});
  await queue.prepare({id:'entry:3', method:'/defects/entries/add', clientEntryId:'invalid', body:{entry:{text:''}}});
  await assert.rejects(queue.run('entry:3'), /check data/);
  assert.deepEqual(methods, ['/defects/entries/add']);
  const invalid = await store.get('entry:3');
  assert.equal(invalid.status, 'invalid');
  assert.deepEqual(invalid.diagnostic, {status:422,route:'/defects/entries/add',requestId:'',time:'2026-10-27T10:00:00.000Z',code:'VALIDATION',message:'safe'});
  await assert.rejects(queue.run('entry:3'), error => error?.queueStatus === 'invalid');
  assert.deepEqual(methods, ['/defects/entries/add']);
  assert.ok(!methods.includes('/acceptance/complete'));
}

// A second tab can receive 422 after our initial read but before our claim.
// Recheck the claimed record inside finally-protected ownership; never reset it
// or send automatically merely because the stale initial value was pending.
for (const status of ['invalid','failed']) for (const claimReturnsRecord of [true,false]) {
  const store=memoryStore();let sent=0,released=0;
  const queue=context.ITUS_OPERATION_QUEUE.create({store,delays:[0],sender:async()=>{sent++;return {success:true};}});
  const original=await queue.prepare({id:`claim-race:${status}:${claimReturnsRecord}`,scope:'test|a',method:'/defects/entries/add',kind:'entry',requestId:'same-request',clientEntryId:'same-entry',body:{entry:{text:'unchanged'}}});
  store.claim=async(id,owner)=>{
    const latest={...await store.get(id),status,attempts:1,error:status==='invalid'?'HTTP_422':'TIMEOUT',diagnostic:{status:status==='invalid'?422:0},leaseOwner:owner};
    await store.put(latest);return claimReturnsRecord ? latest : true;
  };
  store.release=async()=>{released++;};
  await assert.rejects(queue.run(original.id),error=>error.queueStatus===status);
  assert.equal(sent,0);assert.equal(released,1,'a terminal claimed operation releases its lease');
  const retained=await store.get(original.id);
  assert.equal(retained.status,status);assert.equal(retained.attempts,1);
  assert.equal(retained.requestId,original.requestId);assert.equal(JSON.stringify(retained.body),JSON.stringify(original.body));
  await queue.run(original.id,{manual:true});
  assert.equal(sent,1,'explicit checked retry is still available');assert.equal(released,2);
}

console.log('Operation queue: OK (lost response deduplication, five-attempt cap, 422, completion gate and post-claim rejection race).');
