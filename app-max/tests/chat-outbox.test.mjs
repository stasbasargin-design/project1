import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = name => fs.readFileSync(new URL(`../assets/${name}.js`, import.meta.url), 'utf8');
const clone = value => JSON.parse(JSON.stringify(value));
const defer = () => { let resolve, reject; const promise = new Promise((a,b) => {resolve=a;reject=b;}); return {promise,resolve,reject}; };
async function until(check) { for(let i=0;i<100;i++){if(await check())return;await new Promise(resolve=>setTimeout(resolve,2));}assert.fail('Expected asynchronous state was not reached'); }
function memoryStore(){
  const records=new Map();
  return {records,async get(id){return records.has(id)?clone(records.get(id)):null;},async put(value){records.set(value.id,clone(value));},async delete(id){records.delete(id);},async list(scope){return [...records.values()].filter(value=>value.scope===scope).map(clone);},async putBatch(values){for(const value of values)records.set(value.id,clone(value));return values.map(clone);}};
}
function fixture({store=memoryStore(),sender=async()=>({success:true}),payload,permanent=true,readMessages}={}){
  let uuid=0;
  const state={userId:'a',generation:0,scope(){return `https://test.invalid/api|${this.userId}`;}};
  const app={innerHTML:'',querySelector(){return null;},querySelectorAll(){return [];}};
  const handlers={},toasts=[],reports=[],inputs=[],readCalls=[];
  const mediaSlot={renders:0,replaceChildren(){this.renders++;}};
  const document={baseURI:'https://test.invalid/',hidden:false,body:{append(input){inputs.push(input);},classList:{toggle(){},remove(){}}},getElementById(id){return id==='app'?app:id.startsWith('msg-media-')?mediaSlot:null;},querySelector(){return null;},addEventListener(type,fn){handlers[type]=fn;},createElement(){return {style:{},addEventListener(type,fn){this[type]=fn;},setAttribute(){},removeAttribute(){},click(){}};}};
  const scope={console,URL,document,location:{origin:'https://test.invalid'},crypto:{randomUUID:()=>`id-${++uuid}`},addEventListener(){},setTimeout,clearTimeout,innerHeight:800,ITUS_FEATURES:{dateTime:()=>''}};
  scope.window=scope;vm.createContext(scope);
  for(const name of ['api-normalizers','operation-queue','messenger'])vm.runInContext(source(name),scope);
  const guard=(operation,context)=>{if(context.generation!==state.generation||operation.scope!==state.scope())throw Object.assign(new Error('User changed'),{code:'SESSION_CHANGED'});};
  const queue=scope.ITUS_OPERATION_QUEUE.create({store,sender,delays:[0,0,0,0,0],context:()=>({generation:state.generation}),guard});
  const call=async(method,body)=>{
    if(method.endsWith('/topics/list'))return {data:{topics:[{topicRef:'topic',title:'Клиент'}]}};
    if(method.endsWith('/groups/list'))return {data:{groups:[{groupRef:'staff',title:'Передача смены'}]}};
    if(method.endsWith('/messages/list')){readCalls.push({method,body});return readMessages?readMessages(method,body):{data:{messages:[]}};}
    if(method.endsWith('/messages/read'))return {data:{read:true}};
    return sender({method,body});
  };
  const outbox={scope:()=>state.scope(),prepareBatch:values=>queue.prepareBatch(values),list:()=>queue.list(state.scope()),run:(...args)=>queue.run(...args),report:id=>reports.push(id)};
  const messenger=scope.ITUS_MESSENGER.create({api:scope.ITUS_API,call,user:()=>({id:state.userId}),cacheOwner:()=>state.userId,allowed:()=>['clients','staff'],toast:(...args)=>toasts.push(args),filePayload:payload|| (async file=>({fileName:file.name,mimeType:file.type,contentBase64:file.name})),closeSheet(){},sheet(){},settings(){},...(permanent?{outbox}:{})});
  return {scope,state,store,queue,messenger,outbox,app,handlers,toasts,reports,inputs,readCalls,mediaSlot};
}
const files=['one','two','three'].map(name=>({file:{name:`${name}.jpg`,type:'image/jpeg',size:123,lastModified:1},kind:'photo',uploadId:`upload-${name}`}));
const target={source:'clients',ref:'topic'};

// Complete picker selection is durable before the first request, and local save
// completes while the network is still waiting for its first acknowledgement.
{
  const gate=defer(),calls=[],store=memoryStore();
  const f=fixture({store,sender:async operation=>{calls.push(clone(operation));if(calls.length===1){assert.equal(store.records.size,3);await gate.promise;}return {success:true};}});
  const prepared=await f.messenger.enqueueMediaBatch(files,target);
  assert.equal(prepared.length,3);
  await until(()=>calls.length===1);
  assert.equal(store.records.size,3,'HTTP response must not be required for local save');
  assert.deepEqual([...store.records.values()].map(x=>x.body.clientMessageId),['upload-one','upload-two','upload-three']);
  assert.ok([...store.records.values()].every(x=>x.requestId && x.documentKey==='chat:clients:topic'));
  gate.resolve();await until(()=>store.records.size===0);
  assert.equal(calls.length,3);assert.equal(new Set(calls.map(x=>x.requestId)).size,3);
}

// Adding another package while the worker waits cannot leave that package behind.
{
  const gate=defer(),calls=[];
  const f=fixture({sender:async operation=>{calls.push(operation);if(calls.length===1)await gate.promise;return {success:true};}});
  await f.messenger.enqueueMediaBatch([files[0]],target);await until(()=>calls.length===1);
  await f.messenger.enqueueMediaBatch([files[1]],target);gate.resolve();
  await until(()=>f.store.records.size===0);assert.equal(calls.length,2);
}

// Session pause leaves durable IDs/payload. A fresh messenger/queue instance
// restores the same user and retries those exact operations after login.
{
  const store=memoryStore(),first=fixture({store,sender:async()=>{throw Object.assign(new Error('Signed out'),{code:'SESSION_CHANGED'});}});
  await first.messenger.enqueueMediaBatch(files,target);
  await until(()=>[...store.records.values()][0]?.attempts===1&&[...store.records.values()][0]?.status==='pending');
  const saved=[...store.records.values()].map(clone);
  first.messenger.reset();
  const sent=[],second=fixture({store,sender:async operation=>{sent.push(clone(operation));return {success:true};}});
  await second.messenger.enter('clients');await until(()=>store.records.size===0);
  assert.deepEqual(sent.map(x=>x.body),saved.map(x=>x.body));
  assert.deepEqual(sent.map(x=>x.requestId),saved.map(x=>x.requestId));
  assert.deepEqual(sent.map(x=>x.body.clientMessageId),saved.map(x=>x.body.clientMessageId));
}

// 422 is not reported as sent, is never retried on screen refresh, and retains
// its original IDs for the explicit report/checked retry action.
{
  let reject=true;const sent=[];
  const f=fixture({sender:async operation=>{sent.push(clone(operation));if(reject)throw Object.assign(new Error('Rejected'),{status:422,code:'VALIDATION_ERROR'});return {success:true};}});
  await f.messenger.enqueueMediaBatch([files[0]],target);
  await until(()=>[...f.store.records.values()][0]?.status==='invalid');
  await f.messenger.enter('clients');await f.messenger.handle('msg-open',{dataset:{ref:'topic'}});
  f.messenger.paint();assert.match(f.app.innerHTML,/Данные отклонены/);assert.match(f.app.innerHTML,/msg-outbox-report/);
  assert.equal(sent.length,1);assert.ok(!f.toasts.some(([message])=>message==='Отправлено'));
  const operation=[...f.store.records.values()][0];
  await f.messenger.handle('msg-outbox-report',{dataset:{operation:operation.id}});assert.deepEqual(f.reports,[operation.id]);
  reject=false;await f.messenger.handle('msg-outbox-retry',{dataset:{operation:operation.id}});
  assert.equal(f.store.records.size,0);assert.equal(sent.length,2);
  assert.equal(sent[0].requestId,sent[1].requestId);assert.deepEqual(sent[0].body,sent[1].body);
}

// Text messages use the same durable path and retain their body on an HTTP error.
{
  const f=fixture({sender:async()=>{throw Object.assign(new Error('Rejected'),{status:422});}});
  await f.messenger.enter('clients');await f.messenger.handle('msg-open',{dataset:{ref:'topic'}});
  f.handlers.input({target:{id:'msgDraft',value:'Текст для отправки'}});
  await f.messenger.handle('msg-send',{dataset:{}});await until(()=>[...f.store.records.values()][0]?.status==='invalid');
  const operation=[...f.store.records.values()][0];
  assert.equal(operation.method,'/clients/messages/send');assert.equal(operation.body.text,'Текст для отправки');assert.ok(operation.body.clientMessageId);
}

// User switch during file preparation must not persist/send under the new owner.
{
  const gate=defer();let sent=0;
  const f=fixture({payload:async file=>{await gate.promise;return {fileName:file.name};},sender:async()=>{sent++;return {success:true};}});
  const save=f.messenger.enqueueMediaBatch(files,target);
  await new Promise(resolve=>setTimeout(resolve,0));f.messenger.reset();f.state.userId='b';f.state.generation++;gate.resolve();
  await assert.rejects(save,error=>error.code==='SESSION_CHANGED');assert.equal(f.store.records.size,0);assert.equal(sent,0);
}

// Compatibility sender propagates a rejected file to the media picker instead
// of resolving it as a successful upload; the picker must own its own closure.
{
  const f=fixture({permanent:false,sender:async()=>{throw Object.assign(new Error('Rejected 422'),{status:422});}});
  await assert.rejects(f.messenger.upload(files[0].file,{...target,kind:'photo'}),error=>error.status===422);
  assert.ok(!f.toasts.some(([message])=>message==='Отправлено'));
}

const incoming={messageRef:'incoming-1',attachments:[{fileRef:'file-1',fileName:'private.jpg',mimeType:'image/jpeg'}]};
// Switching the thread during asynchronous cache lookup cannot issue a request
// combining the old attachment IDs with the newly selected conversation.
{
  const f=fixture({readMessages:()=>({data:{messages:[incoming]}})});
  await f.messenger.enter('clients');await f.messenger.handle('msg-open',{dataset:{ref:'topic'}});
  let cacheRequest;
  f.scope.indexedDB={open(){const request={};queueMicrotask(()=>{request.result={transaction(){return {objectStore(){return {get(){cacheRequest={};return cacheRequest;}};}};}};request.onsuccess();});return request;}};
  const opening=f.messenger.handle('msg-media',{dataset:{mi:'0',fi:'0'}});await until(()=>cacheRequest);
  await f.messenger.handle('msg-source',{dataset:{source:'staff'}});
  cacheRequest.result=null;cacheRequest.onsuccess();await opening;
  assert.equal(f.readCalls.filter(x=>x.body.includeAttachmentContent).length,0);
  assert.equal(f.mediaSlot.renders,0);
}

// A media response that finishes after logout cannot populate the next user's
// cache or create an image/download in the next session.
{
  const gate=defer();
  const f=fixture({readMessages:(_method,body)=>body.includeAttachmentContent?gate.promise:{data:{messages:[incoming]}}});
  await f.messenger.enter('clients');await f.messenger.handle('msg-open',{dataset:{ref:'topic'}});
  const opening=f.messenger.handle('msg-media',{dataset:{mi:'0',fi:'0'}});await until(()=>f.readCalls.some(x=>x.body.includeAttachmentContent));
  f.messenger.reset();f.state.userId='b';f.state.generation++;
  gate.resolve({data:{messages:[{...incoming,text:'private old session',attachments:[{...incoming.attachments[0],contentBase64:'YQ=='}]}]}});
  await opening;
  assert.equal(f.mediaSlot.renders,0);assert.ok(!f.toasts.some(([message])=>/вложение/i.test(message)));
  await f.messenger.enter('clients');f.messenger.paint();assert.doesNotMatch(f.app.innerHTML,/private old session/);
}
// A new text message in another conversation must start while a file is held.
{
  const gate=defer(),calls=[];
  const f=fixture({sender:async operation=>{calls.push(operation);if(operation.body.file)await gate.promise;return {success:true};}});
  await f.messenger.enqueueMediaBatch([files[0]],target);await until(()=>calls.length===1);
  await f.messenger.enter('staff');await f.messenger.handle('msg-open',{dataset:{ref:'staff'}});
  f.handlers.input({target:{id:'msgDraft',value:'Independent text'}});
  await f.messenger.handle('msg-send',{dataset:{}});await until(()=>calls.some(x=>x.body.text==='Independent text'));
  assert.equal(f.store.records.size,1,'only the held file should remain');
  gate.resolve();await until(()=>f.store.records.size===0);
}
console.log('Chat outbox: durable complete batch, restore, stable IDs, 422 report/retry, owner isolation, independent text lane and error propagation passed');
