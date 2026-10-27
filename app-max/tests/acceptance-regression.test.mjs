import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

// Execute the real application against an isolated DOM stub and mocked 1C transport.
// Nothing is sent to a real 1C server; no test hooks are included in the delivered JS.
const handlers = {}, elements = new Map(), calls = [];
function element(id) {
  if (!elements.has(id)) elements.set(id, { id, value:'', innerHTML:'', textContent:'', dataset:{}, style:{},
    classList:{ add(){}, remove(){}, toggle(){}, contains(){return true;} },
    setAttribute(){}, addEventListener(){}, focus(){}, setSelectionRange(a,b){this.selectionStart=a;this.selectionEnd=b;} });
  return elements.get(id);
}
const fields=[{id:'mileage',label:'Пробег',type:'number',required:true,value:100},
 {id:'engineHours',label:'Моточасы',type:'number',required:false,value:''},
 {id:'reason',label:'Дополнения к причине обращения',type:'textarea',required:false,value:''}];
let failPhoto=true, photoRequired=true, acceptanceUpload404=false, holdEntryResponse=false, releaseEntryResponse, notifyEntryRequest, holdCompletionResponse=false, releaseCompletionResponse, notifyCompletionRequest;
const order={orderRef:'test-order',orderNumber:'TEST-1',vehicle:{model:'Test truck',plate:'A123BC'},mileage:123456};
const context=vm.createContext({addEventListener(){},console,URL,URLSearchParams,AbortController,crypto:webcrypto,
 setTimeout(){return 1;},clearTimeout(){},setInterval(){return 1;},clearInterval(){},
 location:{search:'',href:'http://test.local/'},navigator:{},
 localStorage:{getItem(){return '';},setItem(){},removeItem(){}},
 document:{getElementById:element,querySelector(){return null;},addEventListener(name,fn){handlers[name]=fn;}},
 FileReader:class{readAsDataURL(){this.result='data:image/png;base64,AA==';this.onload();}},
 async fetch(url,options){
  const body=JSON.parse(options.body); calls.push({url,body});let data={};let ok=true;
  if(url.endsWith('/acceptance/start')) data={acceptance:{documentRef:'act-1',photo:{required:photoRequired},form:{fields},survey:{surveyRef:'survey-1',questions:[{id:'required',text:'Кузов',required:true,options:['ok']},{id:'optional',text:'Комментарий',required:false}]}}};
  if(url.endsWith('/defects/entries/add') && body.entry?.type !== 'text'){
    if (acceptanceUpload404) {
      ok=false; data={success:false,error:{message:'Acceptance endpoint not found'}};
      return {ok,status:404,async text(){return JSON.stringify(data);}};
    }
    ok=!(body.entry.type==='photo'&&failPhoto); data={entry:{...body.entry,entryRef:'entry-1'}};
  }
  if(url.endsWith('/orders/get'))data={order};
  if(url.endsWith('/defects/start'))data={documentRef:'def-1',entries:[]};
  if(url.endsWith('/defects/entries/add')){ok=!(body.entry.type==='photo'&&failPhoto);data={entry:{...body.entry,entryRef:body.clientEntryId || 'entry-1'}};}
  if (url.endsWith('/defects/entries/add') && holdEntryResponse) {
    notifyEntryRequest?.();
    await new Promise(resolve => { releaseEntryResponse = resolve; });
  }
  if (url.endsWith('/acceptance/complete') && holdCompletionResponse) {
    notifyCompletionRequest?.();
    await new Promise(resolve => { releaseCompletionResponse = resolve; });
  }
  return {ok,status:ok?200:500,async text(){return JSON.stringify(ok?{success:true,data}:{success:false,error:{message:'Photo rejected'}});}};
 }});
context.window=context;
vm.runInContext(fs.readFileSync(new URL('../assets/review-features.js',import.meta.url),'utf8'),context);
vm.runInContext(fs.readFileSync(new URL('../assets/api-normalizers.js',import.meta.url),'utf8'),context);
vm.runInContext(fs.readFileSync(new URL('../assets/operation-queue.js',import.meta.url),'utf8'),context);
const queueRecords = new Map();
const queueStore = {
  async get(id){ return queueRecords.get(id); },
  async put(value){ queueRecords.set(value.id, structuredClone(value)); },
  async delete(id){ queueRecords.delete(id); }
};
const createQueue = context.ITUS_OPERATION_QUEUE.create;
context.ITUS_OPERATION_QUEUE.create = options => createQueue({...options, store:queueStore, delays:[0,0,0,0,0]});
let source=fs.readFileSync(new URL('../assets/app.js',import.meta.url),'utf8');
source=source.replace("  setAuth(readAuthFromContext(), 'max');",`  window.testApp = {state, currentOrder, startAcceptance, completeAcceptance, requestQualityControl, processProgress, acceptanceHasPhoto, validateProcess, renderSelectedCard, renderMpView, renderTechView, renderExecutorView, openDefectSheet, openAcceptancePhotoSheet, uploadDefectFile, uploadAcceptanceFile, sendDefectText, sendQueuedEntry, renderAcceptancePhoto, renderDefectSheet, ensureDefectSheet, fileToPayload, renderMessages, errorDiagnostic, diagnosticReport, firstMainView};\n  setAuth(readAuthFromContext(), 'max');`);
vm.runInContext(source,context);
const app=context.testApp;
app.state.userId='123';app.state.orders=[context.ITUS_API.mapOrder(order)];app.state.selectedOrderId='test-order';
const retainedOrders=app.state.orders;
app.state.view='tech';context.ITUS_BACK();assert.equal(app.state.view,'orders');assert.equal(app.state.orders,retainedOrders);
context.ITUS_BACK();assert.equal(app.state.view,'orders');
app.state.views={mp:'MP',orders:'Orders'};app.state.view='orders';context.ITUS_BACK();assert.equal(app.state.view,'mp');
app.state.views={orders:'Orders',mp:'MP',executor:'Executor',tech:'Tech',clients:'Clients',chat:'Chat'};app.state.view='orders';
const photoPayload=await app.fileToPayload({name:'camera.heic',type:'image/jpeg',size:10},'photo');
assert.equal(photoPayload.fileName,'camera.jpg');assert.equal(photoPayload.mimeType,'image/jpeg');
app.state.user={name:'Viewer'};
const safeReport=app.diagnosticReport(app.errorDiagnostic({status:422,code:'VALIDATION',message:'secret attachment content'}, {route:'/defects/entries/add',requestId:'request-1',clientEntryId:'entry-1',attempt:2}));
assert.match(safeReport,/HTTP status: 422/);assert.match(safeReport,/Маршрут: \/defects\/entries\/add/);assert.match(safeReport,/requestId: request-1/);assert.match(safeReport,/clientEntryId: entry-1/);assert.match(safeReport,/Попытка: 2/);assert.match(safeReport,/Код: VALIDATION/);
assert.doesNotMatch(safeReport,/secret attachment content/);
const externalAuthorHtml=app.renderMessages([{side:'mine',author:'Actual sender',createdAt:'',text:'Test'}]);
assert.match(externalAuthorHtml,/Actual sender/);
assert.doesNotMatch(externalAuthorHtml,/Viewer/);
assert.match(app.renderMessages([{side:'mine',author:'Я',createdAt:'сейчас',text:'',attachments:[{fileName:'camera.jpg',mimeType:'image/jpeg',contentBase64:'AA=='}]}]),/<img class="attachment-preview"/);
assert.ok(!app.renderSelectedCard().includes('quick-actions'));
assert.match(app.renderMpView(),/data-action="request-quality"/);
assert.match(app.renderSelectedCard(),/123456/);
assert.doesNotMatch(app.renderSelectedCard(),/<span class="tiny">Пробег<\/span>/);
assert.match(app.renderMpView(),/data-action="open-acceptance-photo">Добавить фото\/видео/);
assert.doesNotMatch(app.renderTechView(),/data-action="open-defect-chat">Приём</);
assert.doesNotMatch(app.renderTechView(),/Текущее обращение/);
assert.match(app.renderTechView(),/data-action="service-history">История обслуживания/);
assert.match(app.renderExecutorView(),/Добавить дефект/);
const qualityProgress=app.processProgress({form:{fields:[{id:'comment',required:false},{id:'mileage',required:true}]},survey:{questions:[{id:'optional',required:false},{id:'required',required:true}]},values:{mileage:123},answers:{required:'yes'}},'_quality');
assert.equal(qualityProgress.done,2);assert.equal(qualityProgress.total,2);assert.equal(qualityProgress.pct,100);
const qualityValidation={form:{fields:[{id:'comment',required:false},{id:'mileage',required:true}]},survey:{questions:[{id:'optional',required:false},{id:'required',required:true}]},values:{mileage:123},answers:{required:'yes'}};
assert.equal(app.validateProcess(qualityValidation,false),true);
await app.requestQualityControl();
assert.equal(calls.at(-1).url.endsWith('/quality/request'),true);
assert.equal(calls.at(-1).body.orderRef,'test-order');
await app.startAcceptance();
let process=app.currentOrder()._acceptance;
assert.equal(process.values.mileage,100);
assert.equal(app.processProgress(process,'_acceptance').total,3);
assert.equal(app.processProgress(process,'_acceptance').done,1);
await app.completeAcceptance();
assert.ok(process.errors.has('question:required'));assert.ok(process.errors.has('photo'));
assert.ok(!process.errors.has('field:engineHours'));assert.ok(!process.errors.has('field:reason'));
process.answers.required='ok';
assert.equal(app.processProgress(process,'_acceptance').done,2);
await app.openDefectSheet();
assert.doesNotMatch(element('sheetBody').innerHTML,/Добавить в дефектовку/);
const file={name:'test.png',type:'image/png',size:10};
const retryStart=calls.filter(c=>c.url.endsWith('/defects/entries/add')).length;
await assert.rejects(app.uploadDefectFile(file,'photo'),/Photo rejected/);
assert.equal(app.acceptanceHasPhoto(),false);
assert.equal(app.processProgress(process,'_acceptance').done,2);
failPhoto=false;await app.uploadDefectFile(file,'photo');
const retryCalls=calls.filter(c=>c.url.endsWith('/defects/entries/add')).slice(retryStart);
assert.equal(retryCalls.length,6);assert.ok(retryCalls.every(call=>call.body.clientEntryId===retryCalls[0].body.clientEntryId));
const duplicateFile={name:'duplicate.png',type:'image/png',size:11};
const entryCount=app.currentOrder()._defectSheet.entries.length;
const duplicateStart=calls.filter(c=>c.url.endsWith('/defects/entries/add')).length;
holdEntryResponse=true;
const entryRequestStarted=new Promise(resolve=>{notifyEntryRequest=resolve;});
const duplicateFirst=app.uploadDefectFile(duplicateFile,'photo');
await entryRequestStarted;
const duplicateSecond=app.uploadDefectFile(duplicateFile,'photo');
assert.equal(calls.filter(c=>c.url.endsWith('/defects/entries/add')).length,duplicateStart+1);
holdEntryResponse=false;releaseEntryResponse();notifyEntryRequest=undefined;
await Promise.all([duplicateFirst,duplicateSecond]);
assert.equal(app.currentOrder()._defectSheet.entries.length,entryCount+1);
app.renderDefectSheet();assert.match(element('sheetBody').innerHTML,/class="defect-photo-preview"/);assert.doesNotMatch(element('sheetBody').innerHTML,/Открыть вложение/);
assert.equal(app.acceptanceHasPhoto(),false);
assert.equal(app.processProgress(process,'_acceptance').done,2);
assert.ok(app.renderAcceptancePhoto(process).includes('Отправьте хотя бы одну фотографию'));
await app.uploadAcceptanceFile(file,'photo');
assert.equal(app.acceptanceHasPhoto(),true);
assert.equal(app.processProgress(process,'_acceptance').done,3);
assert.ok(!app.renderAcceptancePhoto(process).includes('Отправьте хотя бы одну фотографию'));
assert.match(app.renderMpView(),/data-action="open-acceptance-photo">Добавить фото\/видео/);
await app.openAcceptancePhotoSheet();
assert.match(element('sheetBody').innerHTML, /data-action="acceptance-video"/);
const completions=()=>calls.filter(c=>c.url.endsWith('/acceptance/complete'));
await app.completeAcceptance();
assert.equal(completions().length,1);
assert.deepEqual(completions()[0].body.formValues,{mileage:100,engineHours:'',reason:''});
assert.equal(completions()[0].body.answers.required,'ok');assert.equal(completions()[0].body.userId,'123');
assert.equal(app.currentOrder()._acceptance,null);

// MP photo payload uses the shared defects endpoint but keeps the acceptance document reference.
photoRequired=false;app.currentOrder()._defectSheet=null;await app.startAcceptance();process=app.currentOrder()._acceptance;
acceptanceUpload404=false;await app.uploadAcceptanceFile(file,'photo');
assert.equal(calls.filter(c=>c.url.endsWith('/defects/entries/add')).at(-1).body.documentRef,process.documentRef);

photoRequired=false;app.currentOrder()._defectSheet=null;await app.startAcceptance();process=app.currentOrder()._acceptance;
const defectCallsBeforeAcceptanceFallback = calls.filter(c=>c.url.endsWith('/defects/entries/add')).length;
acceptanceUpload404=true;await assert.rejects(app.uploadAcceptanceFile(file,'photo'), /defects\/entries\/add|не сохранён/i);
assert.equal(calls.filter(c=>c.url.endsWith('/defects/entries/add')).length, defectCallsBeforeAcceptanceFallback + 1);
acceptanceUpload404=false;

photoRequired=false;app.currentOrder()._defectSheet=null;await app.startAcceptance();process=app.currentOrder()._acceptance;
assert.equal(app.processProgress(process,'_acceptance').total,2);
process.answers.required=false; // An explicit boolean "no" is a valid answer.
assert.equal(app.processProgress(process,'_acceptance').done,2);
await app.completeAcceptance();assert.equal(completions().length,2);
await app.startAcceptance();process=app.currentOrder()._acceptance;process.answers.required='ok';
const completionsBeforeJoin=completions().length;
holdCompletionResponse=true;
const completionRequestStarted=new Promise(resolve=>{notifyCompletionRequest=resolve;});
const firstCompletion=app.completeAcceptance();
await completionRequestStarted;
assert.match(app.renderMpView(),/Подтверждаем отправку/);
const secondCompletion=app.completeAcceptance();
assert.equal(completions().length,completionsBeforeJoin+1);
holdCompletionResponse=false;releaseCompletionResponse();notifyCompletionRequest=undefined;
await Promise.all([firstCompletion,secondCompletion]);
assert.equal(completions().length,completionsBeforeJoin+1);
const search=element('orderSearch');search.value='TEST-1';search.selectionStart=6;search.selectionEnd=6;
let orderSearchRenderWrites=0, appMarkup=element('app').innerHTML;
Object.defineProperty(element('app'),'innerHTML',{configurable:true,get(){return appMarkup;},set(value){orderSearchRenderWrites++;appMarkup=value;}});
handlers.input({target:search});assert.equal(app.state.search,'TEST-1');assert.equal(search.selectionStart,6);
search.selectionStart=2;search.selectionEnd=2;handlers.input({target:search});assert.equal(search.selectionStart,2);
assert.equal(orderSearchRenderWrites,0,'typing in order search must not recreate the application DOM or reset the mobile keyboard');
handlers.focusin({target:search});assert.equal(search.selectionStart,6);
console.log('Acceptance regression: OK (required flags, progress, failed/successful upload, completion JSON, default values, role buttons, caret).');

// Known document: never call start, send file to the exact existing document.
let startCount = calls.filter(c=>c.url.endsWith('/defects/start')).length;
app.currentOrder()._defectSheet=null; app.currentOrder().defectDocumentRef='existing-doc';
await app.uploadDefectFile(file,'photo');
assert.equal(calls.filter(c=>c.url.endsWith('/defects/start')).length,startCount);
assert.equal(calls.filter(c=>c.url.endsWith('/defects/entries/add')).at(-1).body.documentRef,'existing-doc');
// A stale order list must be refreshed before starting any new document.
app.currentOrder()._defectSheet=null;app.currentOrder().defectDocumentRef='';order.defectDocumentRef='fresh-doc';
await app.uploadDefectFile(file,'photo');
assert.equal(calls.filter(c=>c.url.endsWith('/defects/start')).length,startCount);
assert.equal(calls.filter(c=>c.url.endsWith('/defects/entries/add')).at(-1).body.documentRef,'fresh-doc');
// Simultaneous requests for an actually absent document share a single start.
app.currentOrder()._defectSheet=null;app.currentOrder().defectDocumentRef='';delete order.defectDocumentRef;
await Promise.all([app.ensureDefectSheet(),app.ensureDefectSheet()]);
assert.equal(calls.filter(c=>c.url.endsWith('/defects/start')).length,startCount+1);
assert.equal(context.ITUS_API.mapOrder({...order,defectSheet:{documentRef:'nested-doc'}}).defectDocumentRef,'nested-doc');
console.log('Existing document regression: OK — direct append, refresh before create, single concurrent start, nested reference.');
