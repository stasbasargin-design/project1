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
    addEventListener(){}, focus(){}, setSelectionRange(a,b){this.selectionStart=a;this.selectionEnd=b;} });
  return elements.get(id);
}
const fields=[{id:'mileage',label:'Пробег',type:'number',required:true,value:100},
 {id:'engineHours',label:'Моточасы',type:'number',required:false,value:''},
 {id:'reason',label:'Дополнения к причине обращения',type:'textarea',required:false,value:''}];
let failPhoto=true, photoRequired=true, acceptanceUpload404=false;
const order={orderRef:'test-order',orderNumber:'TEST-1',vehicle:{model:'Test truck'}};
const context=vm.createContext({addEventListener(){},console,URL,URLSearchParams,AbortController,crypto:webcrypto,
 setTimeout(){return 1;},clearTimeout(){},setInterval(){return 1;},clearInterval(){},
 location:{search:'',href:'http://test.local/'},navigator:{},
 localStorage:{getItem(){return '';},setItem(){},removeItem(){}},
 document:{getElementById:element,querySelector(){return null;},addEventListener(name,fn){handlers[name]=fn;}},
 FileReader:class{readAsDataURL(){this.result='data:image/png;base64,AA==';this.onload();}},
 async fetch(url,options){
  const body=JSON.parse(options.body); calls.push({url,body});let data={};let ok=true;
  if(url.endsWith('/acceptance/start')) data={acceptance:{documentRef:'act-1',photo:{required:photoRequired},form:{fields},survey:{surveyRef:'survey-1',questions:[{id:'required',text:'Кузов',required:true,options:['ok']},{id:'optional',text:'Комментарий',required:false}]}}};
  if(url.endsWith('/acceptance/entries/add')){
    if (acceptanceUpload404) { ok=false; status=404; data={success:false,error:{message:'Not found'}}; }
    else { ok=!(body.entry.type==='photo'&&failPhoto); data={entry:{...body.entry,entryRef:'entry-1'}}; }
  }
  if(url.endsWith('/orders/get'))data={order};
  if(url.endsWith('/defects/start'))data={documentRef:'def-1',entries:[]};
  if(url.endsWith('/defects/entries/add')){ok=!(body.entry.type==='photo'&&failPhoto);data={entry:{...body.entry,entryRef:'entry-1'}};}
  return {ok,status:ok?200:500,async text(){return JSON.stringify(ok?{success:true,data}:{success:false,error:{message:'Photo rejected'}});}};
 }});
context.window=context;
vm.runInContext(fs.readFileSync(new URL('../assets/api-normalizers.js',import.meta.url),'utf8'),context);
let source=fs.readFileSync(new URL('../assets/app.js',import.meta.url),'utf8');
source=source.replace("  setAuth(readAuthFromContext(), 'max');",`  window.testApp = {state, currentOrder, startAcceptance, completeAcceptance, processProgress, acceptanceHasPhoto, validateProcess, renderSelectedCard, renderMpView, renderTechView, renderExecutorView, openDefectSheet, uploadDefectFile, uploadAcceptanceFile, sendDefectText, renderAcceptancePhoto, ensureDefectSheet};\n  setAuth(readAuthFromContext(), 'max');`);
vm.runInContext(source,context);
const app=context.testApp;
app.state.userId='123';app.state.orders=[context.ITUS_API.mapOrder(order)];app.state.selectedOrderId='test-order';
assert.ok(!app.renderSelectedCard().includes('quick-actions'));
assert.match(app.renderMpView(),/data-action="open-acceptance-photo">Приём</);
assert.match(app.renderTechView(),/data-action="open-defect-chat">Приём</);
assert.match(app.renderExecutorView(),/Добавить дефект/);
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
await app.openDefectSheet();element('defectText').value='Test defect';await app.sendDefectText();
assert.equal(app.acceptanceHasPhoto(),false);
const file={name:'test.png',type:'image/png',size:10};
await assert.rejects(app.uploadDefectFile(file,'photo'),/Photo rejected/);
assert.equal(app.acceptanceHasPhoto(),false);
assert.equal(app.processProgress(process,'_acceptance').done,2);
failPhoto=false;await app.uploadDefectFile(file,'photo');
assert.equal(app.acceptanceHasPhoto(),true);
assert.equal(app.processProgress(process,'_acceptance').done,3);
assert.ok(!app.renderAcceptancePhoto(process).includes('Отправьте хотя бы одну фотографию'));
await app.completeAcceptance();
const completions=()=>calls.filter(c=>c.url.endsWith('/acceptance/complete'));
assert.equal(completions().length,1);
assert.deepEqual(completions()[0].body.formValues,{mileage:100,engineHours:'',reason:''});
assert.equal(completions()[0].body.answers.required,'ok');assert.equal(completions()[0].body.userId,'123');
assert.equal(app.currentOrder()._acceptance,null);

// MP photo payload must use the acceptance document, not the executor defect sheet.
photoRequired=false;app.currentOrder()._defectSheet=null;await app.startAcceptance();process=app.currentOrder()._acceptance;
acceptanceUpload404=false;await app.uploadAcceptanceFile(file,'photo');
assert.equal(calls.filter(c=>c.url.endsWith('/acceptance/entries/add')).at(-1).body.documentRef,process.documentRef);

photoRequired=false;app.currentOrder()._defectSheet=null;await app.startAcceptance();process=app.currentOrder()._acceptance;
acceptanceUpload404=true;await app.uploadAcceptanceFile(file,'photo');
assert.equal(calls.filter(c=>c.url.endsWith('/defects/entries/add')).at(-1).body.documentRef,process.documentRef);

photoRequired=false;app.currentOrder()._defectSheet=null;await app.startAcceptance();process=app.currentOrder()._acceptance;
assert.equal(app.processProgress(process,'_acceptance').total,2);
process.answers.required=false; // An explicit boolean "no" is a valid answer.
assert.equal(app.processProgress(process,'_acceptance').done,2);
await app.completeAcceptance();assert.equal(completions().length,2);
const search=element('orderSearch');search.value='TEST-1';search.selectionStart=6;search.selectionEnd=6;
handlers.input({target:search});assert.equal(app.state.search,'TEST-1');assert.equal(search.selectionStart,6);
search.selectionStart=2;search.selectionEnd=2;handlers.input({target:search});assert.equal(search.selectionStart,2);
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

