import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';

// Reuse the existing isolated DOM/1C fixture, execute the delivered app functions.
const fixtureUrl=new URL('./acceptance-regression.test.mjs',import.meta.url);
let fixture=fs.readFileSync(fixtureUrl,'utf8').split('const app=context.testApp;')[0];
fixture=fixture.replace(/^import .*;\r?\n/gm,'').replaceAll('import.meta.url',JSON.stringify(fixtureUrl.href));
fixture=fixture.replace('firstMainView};','firstMainView, setAuth, operationQueue, queueScope, retryFailedOperation, resumeSavedOperations, runQueuedAcceptanceCompletion, runPreparedOperations, completeDefectSheet, refreshQueuedOperations, showOperationQueue, openOperationReport, logout, initialize, CONFIG, scheduleQueueResume};');
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
async function scenario(body){ await new AsyncFunction('assert','fs','vm','webcrypto',fixture+'\nconst app=context.testApp;\n'+body)(assert,fs,vm,webcrypto); }
const setup=`app.setAuth('111','manual');app.state.user={name:'A'};app.state.orders=[context.ITUS_API.mapOrder(order)];app.state.selectedOrderId='test-order';`;

await scenario(setup+`
  let started,release;
  const ready=new Promise(resolve=>started=resolve),waiting=new Promise(resolve=>release=resolve),actual=[];
  context.fetch=async(url,options)=>{actual.push({url,body:JSON.parse(options.body)});if(actual.length===1){started();await waiting;}return {ok:true,status:200,text:async()=>JSON.stringify({success:true,data:{}})};};
  const scope=app.queueScope();
  const operations=await app.operationQueue.prepareBatch([1,2].map(n=>({id:'owner-'+n,scope,method:'/defects/entries/add',body:{orderRef:'test-order',documentRef:'doc-A'},clientEntryId:'entry-'+n,requestId:'req-'+n,kind:'entry',documentKey:'doc-A'})));
  const pending=app.runPreparedOperations(operations), rejected=assert.rejects(pending,{code:'SESSION_CHANGED'});
  await ready;app.setAuth('222','manual');release();await rejected;
  assert.deepEqual(actual.map(item=>item.body.userId),['111']);
  assert.equal((await app.operationQueue.list(scope)).length,2,'stale response cannot delete saved work');
  await assert.rejects(app.operationQueue.run('owner-2'),{code:'SESSION_CHANGED'});
  app.setAuth('111','manual');await app.runPreparedOperations(await app.operationQueue.list(scope));
  assert.equal((await app.operationQueue.list(scope)).length,0);
  assert.deepEqual(actual.map(item=>item.body.userId),['111','111','111']);
  assert.equal(actual[0].body.requestId,actual[1].body.requestId);
`);

await scenario(setup+`
  await app.startAcceptance();const scope=app.queueScope();
  const entry=await app.operationQueue.prepare({id:'invalid-entry',scope,method:'/defects/entries/add',body:{orderRef:'test-order',documentRef:'act-1'},kind:'entry',documentKey:'act-1'});
  await queueStore.put({...entry,status:'invalid',attempts:1,error:'HTTP_422'});
  await app.operationQueue.prepare({id:'completion-waiting',scope,method:'/acceptance/complete',body:{orderRef:'test-order',documentRef:'act-1'},kind:'complete',documentKey:'act-1'});
  await app.runQueuedAcceptanceCompletion('act-1');assert.equal(app.state.completionStatus.stage,'error');
  const actual=[];context.fetch=async(url,options)=>{actual.push(url);return {ok:true,status:200,text:async()=>JSON.stringify({success:true,data:url.endsWith('/orders/get')?{order}: {}})};};
  app.state.failedOperationId='invalid-entry';await app.retryFailedOperation();
  assert.equal(actual.filter(url=>url.endsWith('/acceptance/complete')).length,1);
  assert.equal(await app.operationQueue.get('completion-waiting'),undefined);
  assert.equal(app.state.completionStatus,null);
`);

await scenario(setup+`
  const scope=app.queueScope(), item=await app.operationQueue.prepare({id:'old-failed',scope,method:'/defects/entries/add',body:{orderRef:'test-order',documentRef:'act-1'},kind:'entry',documentKey:'act-1'});
  await queueStore.put({...item,status:'failed',attempts:5,error:'TIMEOUT'});
  let count=0;context.fetch=async()=>{count++;throw Error('must not send');};
  await app.resumeSavedOperations();await app.refreshQueuedOperations();
  assert.equal(count,0);assert.match(app.renderSelectedCard(),/show-operation-queue/);
  await app.showOperationQueue();assert.match(element('sheetBody').innerHTML,/open-operation-report/);
  await app.openOperationReport('old-failed');assert.match(element('sheetBody').innerHTML,/copy-operation-report/);assert.match(element('sheetBody').innerHTML,/retry-failed-operation/);
`);

await scenario(setup+`
  await app.startAcceptance();const scope=app.queueScope();
  const complete=await app.operationQueue.prepare({id:'failed-complete',scope,method:'/acceptance/complete',body:{orderRef:'test-order',documentRef:'act-1'},kind:'complete',documentKey:'act-1'});
  await queueStore.put({...complete,status:'failed',attempts:5,error:'TIMEOUT'});
  app.state.completionStatus={key:'acceptance:act-1',stage:'error'};
  app.state.failedOperationId=complete.id;
  await app.retryFailedOperation();
  assert.equal(await app.operationQueue.get(complete.id),undefined);
  assert.equal(app.state.completionStatus,null);assert.equal(app.currentOrder()._acceptance,null);
`);

await scenario(setup+`
  const a=app.currentOrder();a._defectSheet={documentRef:'def-A',entries:[]};
  const b=context.ITUS_API.mapOrder({...order,orderRef:'other-order',orderNumber:'TEST-2'});b._defectSheet={documentRef:'def-B',entries:[]};app.state.orders.push(b);
  const scope=app.queueScope();const entry=await app.operationQueue.prepare({id:'held-entry',scope,method:'/defects/entries/add',body:{orderRef:'test-order',documentRef:'def-A'},kind:'entry',documentKey:'def-A'});
  let started,release;const ready=new Promise(resolve=>started=resolve),waiting=new Promise(resolve=>release=resolve),actual=[];
  context.fetch=async(url,options)=>{const body=JSON.parse(options.body);actual.push({url,body});if(url.endsWith('/defects/entries/add')){started();await waiting;}return {ok:true,status:200,text:async()=>JSON.stringify({success:true,data:url.endsWith('/orders/get')?{order}: {}})};};
  const sending=app.runPreparedOperations([entry]);await ready;
  await app.completeDefectSheet();assert.equal(actual.filter(item=>item.url.endsWith('/defects/complete')).length,0);
  app.state.selectedOrderId='other-order';release();await sending;await app.resumeSavedOperations();
  const complete=actual.find(item=>item.url.endsWith('/defects/complete'));
  assert.equal(complete.body.orderRef,'test-order');assert.equal(complete.body.documentRef,'def-A');
  assert.equal(app.state.selectedOrderId,'other-order');assert.equal(b._defectSheet.documentRef,'def-B');
`);

await scenario(setup+`
  app.state.search='TEST';
  context.console={...console,error(){}};
  let started,release;const ready=new Promise(resolve=>started=resolve),waiting=new Promise(resolve=>release=resolve);let count=0;
  context.fetch=async()=>{count++;started();await waiting;throw Error('offline');};
  const makeButton=()=>({dataset:{action:'search-orders'},disabled:false,isConnected:true,setAttribute(){},removeAttribute(){},classList:{add(){},remove(){}}});
  const first=makeButton(),second=makeButton();
  const pending=handlers.click({target:{closest:()=>first}});await ready;
  assert.equal(first.disabled,true,'spinner remains while request is unresolved');
  await handlers.click({target:{closest:()=>second}});assert.equal(count,1,'a re-rendered button joins the in-flight action');
  release();await pending;assert.equal(first.disabled,false);
`);

await scenario(setup+`
  context.ITUS_NATIVE_PUSH={unregister:async()=>{throw Error('native offline');}};
  await app.logout();assert.equal(app.state.userId,'');assert.equal(app.state.orders.length,0);assert.equal(app.state.busy,false);
`);

await scenario(setup+`
  app.CONFIG.enforceTabs=true;let ordersCalls=0;
  context.fetch=async(url)=>{if(url.endsWith('/orders/list')) ordersCalls++;return {ok:true,status:200,text:async()=>JSON.stringify({success:true,data:{user:{name:'A'},availableTabs:[]}})};};
  await app.initialize();assert.equal(Object.keys(app.state.views).length,0);assert.equal(ordersCalls,0);assert.match(element('app').innerHTML,/Нет доступных разделов/);
`);

for(const roleCase of [
  {user:{roleName:'admin',role:'Администратор'},allowed:true},
  {user:{roleName:'administrator'},allowed:true},
  {user:{role:'Администратор'},allowed:true},
  {user:{roleName:'executor'},allowed:false},
  {user:{roleName:'админ-помощник'},allowed:false},
  {user:{role:'помощник администратора'},allowed:false},
  {user:{roleName:'administrator-helper'},allowed:false},
  {user:{roleName:'executor',role:'Администратор'},allowed:false},
  {user:{roleName:'executor'},missingTabs:true,allowed:false}
]) await scenario(setup+`
  app.CONFIG.enforceTabs=true;let ordersCalls=0;const testCase=${JSON.stringify(roleCase)};
  context.fetch=async(url)=>{
    let data={};
    if(url.endsWith('/auth/max'))data={user:{name:'A',...testCase.user},...(testCase.missingTabs?{}:{availableTabs:[]})};
    if(url.endsWith('/orders/list')){ordersCalls++;data={orders:[order]};}
    return {ok:true,status:200,text:async()=>JSON.stringify({success:true,data})};
  };
  await app.initialize();
  assert.equal(Object.keys(app.state.views).length,testCase.allowed?6:0,JSON.stringify(testCase.user));
  assert.equal(ordersCalls,testCase.allowed?1:0);
`);

await scenario(setup+`
  const scope=app.queueScope(), item=await app.operationQueue.prepare({id:'lease-held',scope,method:'/defects/entries/add',body:{orderRef:'test-order',documentRef:'act-1'},kind:'entry',documentKey:'act-1'});
  let unavailable=true,sends=0;const leaseUntil=Date.now()+10000,timers=[];
  await queueStore.put({...item,leaseUntil});queueStore.claim=async()=>!unavailable;queueStore.release=async()=>{};
  context.setTimeout=(fn,ms)=>{timers.push({fn,ms});return timers.length;};context.fetch=async()=>{sends++;return {ok:true,status:200,text:async()=>JSON.stringify({success:true,data:{}})};};
  await app.resumeSavedOperations();assert.equal(sends,0);assert.ok(timers.some(timer=>timer.ms>=9000&&timer.ms<=11000));
  unavailable=false;timers.find(timer=>timer.ms>=9000&&timer.ms<=11000).fn();
  await app.resumeSavedOperations();assert.equal(await app.operationQueue.get('lease-held'),undefined);
`);

// Once completion is durable, every edit control for that document is locked,
// including after restoring a failed operation. Another order remains editable.
await scenario(setup+`
  photoRequired=false;await app.startAcceptance();const process=app.currentOrder()._acceptance;
  process.answers.required='ok';const scope=app.queueScope();
  const entry=await app.operationQueue.prepare({id:'blocking-photo',scope,method:'/defects/entries/add',body:{orderRef:'test-order',documentRef:'act-1'},kind:'entry',documentKey:'act-1'});
  await queueStore.put({...entry,status:'invalid',error:'HTTP_422'});
  await app.completeAcceptance();
  const complete=(await app.operationQueue.list(scope)).find(item=>item.kind==='complete');
  assert.ok(complete);const immutable=JSON.stringify(complete.body),mileage=process.values.mileage;
  for(const status of ['pending','sending','failed','invalid']){
    await queueStore.put({...complete,status});app.state.completionStatus=null;await app.refreshQueuedOperations();
    const html=app.renderMpView();
    assert.match(html,/<input[^>]*disabled[^>]*data-process-input="_acceptance"/);
    assert.match(html,/<button[^>]*data-action="answer-option"[^>]*disabled/);
    assert.match(html,/<button data-action="open-acceptance-photo" disabled>/);
    handlers.input({target:{id:'field-_acceptance-mileage',value:'999999',dataset:{processInput:'_acceptance',field:'mileage'}}});
    const button={dataset:{action:'answer-option',process:'_acceptance',question:'required',value:'wrong'},disabled:false};
    await handlers.click({target:{closest:()=>button}});
    assert.equal(process.values.mileage,mileage);assert.equal(process.answers.required,'ok');
  }
  await assert.rejects(app.commitMediaBatch('acceptance',[{file:{name:'late.jpg',type:'image/jpeg',size:1},kind:'photo',uploadId:'late'}]),{code:'DOCUMENT_COMPLETION_PENDING'});
  assert.equal(JSON.stringify((await app.operationQueue.get(complete.id)).body),immutable);
  const b=context.ITUS_API.mapOrder({...order,orderRef:'other-order',orderNumber:'TEST-2'});
  b._acceptance={...process,documentRef:'act-B',values:{...process.values},answers:{...process.answers}};app.state.orders.push(b);app.state.selectedOrderId=b.id;
  const html=app.renderMpView();assert.match(html,/<button data-action="open-acceptance-photo">Добавить/);
  assert.doesNotMatch(html,/<input[^>]*disabled[^>]*data-process-input="_acceptance"/);
  handlers.input({target:{id:'field-_acceptance-mileage',value:'456',dataset:{processInput:'_acceptance',field:'mileage'}}});
  assert.equal(b._acceptance.values.mileage,'456');assert.equal(process.values.mileage,mileage);
`);
console.log('Prelaunch queue integration: owner isolation, durable retry/completion/report, immutable document, button single-flight, logout, empty roles and lease recovery OK.');
