import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
await import('../assets/worktime.js');
const W = globalThis.ITUS_WORKTIME;
const participants = [{employeeRef:'self',percent:60},{employeeRef:'colleague',percent:40}];
assert.equal(W.participation(participants).length,2);
assert.equal(W.participation([{employeeRef:'a',percent:33.33},{employeeRef:'b',percent:33.33},{employeeRef:'c',percent:33.34}]).length,3);
for (const p of [[],[{employeeRef:'a',percent:99.99}],[{employeeRef:'a',percent:100.01}],[{employeeRef:'a',percent:NaN}],[{employeeRef:'a',percent:'100'}],[{employeeRef:'a',percent:33.333},{employeeRef:'b',percent:66.667}],[{employeeRef:'a',percent:0},{employeeRef:'b',percent:100}],[{employeeRef:'a',percent:50},{employeeRef:'a',percent:50}]]) assert.throws(()=>W.participation(p));
const valid={orderRef:'order',workshopRef:'shop',workRefs:['row'],participants,clientPackageId:'stable'};
assert.equal(W.validateRequest(W.methods.create,valid),valid);
for(const value of [{...valid,workRefs:[]},{...valid,workRefs:['row','row']},{...valid,workshopRef:''},{...valid,clientPackageId:''}]) assert.throws(()=>W.validateRequest(W.methods.create,value));
assert.throws(()=>W.validateRequest(W.methods.start,{orderRef:'order'}));
const elements=new Map(), calls=[];
let selectedEmployees=['self','colleague'];
let pollData={unreadMessagesCount:0}, resolvePoll=null;
let percent=40, rejectValidation=false, missingPackage=false, failCreate=false;
function element(id){
  if(!elements.has(id)) elements.set(id,{innerHTML:'',textContent:'',value:'',dataset:{},style:{},classList:{add(){},remove(){},toggle(){},contains(){return true;}},addEventListener(){},setAttribute(){},
    querySelector(){return {disabled:false};},querySelectorAll(selector){
      if(selector==='[data-worktime-work]:checked')return [{dataset:{worktimeWork:'row'}}];
      if(selector==='[data-worktime-employee]:checked')return selectedEmployees.map(ref=>({dataset:{worktimeEmployee:ref}}));
      if(selector==='[data-worktime-percent]')return [{dataset:{worktimePercent:'self'},value:60},{dataset:{worktimePercent:'colleague'},value:percent}];
      return [];
    }});
  return elements.get(id);
}
const c=vm.createContext({console,URL,URLSearchParams,AbortController,crypto:webcrypto,location:{search:'',href:'http://test/'},navigator:{},
  setTimeout(){return 1;},clearTimeout(){},setInterval(){return 1;},clearInterval(){},addEventListener(){},
  localStorage:{getItem(){return '';},setItem(){},removeItem(){}},document:{getElementById:element,querySelector(){return null;},addEventListener(){}},
  async fetch(url,options){
    const body=JSON.parse(options.body);calls.push({url,body});let data={};
    if(url.endsWith('/notifications/poll')) data=resolvePoll === true ? await new Promise(resolve=>{resolvePoll=resolve;}) : pollData;
    if(url.endsWith('/orders/works'))data={workshopRef:'shop',works:[{workRef:'row',name:'Работа'},{workRef:'blocked',name:'Активный пакет',hasActivePackage:true},{workRef:'blocked2',name:'Ссылка активного пакета',activePackageRef:'active'}]};
    if(url.endsWith('/packages/list'))data={packages:[{packageRef:'open-package',packageNumber:'УРВ-7',status:'Не стартовал'},{packageRef:'closed-package',packageNumber:'УРВ-6',status:'Закрыт'}]};
    if(url.endsWith('/executors/list'))data={executors:[{employeeRef:'self',name:'Я'},{employeeRef:'colleague',name:'Коллега'}]};
    if(url.endsWith('/participation/validate'))data={valid:!rejectValidation};
    if(url.endsWith('/packages/create')){if(failCreate)throw Error('Connection lost');data=missingPackage?{}:{package:{packageRef:'created',status:'Создан'}};}
    return {ok:true,status:200,text:async()=>JSON.stringify({success:true,data})};
  }
});c.window=c;
for(const f of ['review-features.js','api-normalizers.js','worktime.js'])vm.runInContext(fs.readFileSync(new URL('../assets/'+f,import.meta.url),'utf8'),c);
let src=fs.readFileSync(new URL('../assets/app.js',import.meta.url),'utf8');
src=src.replace("  setAuth(readAuthFromContext(), 'max');", "  window.testApp={state,preparePackage,submitPackage,packageAction,selectPackage,usePackage,renderTabs,worktimeStep,messagesRead,pollNotifications,renderNotifications};\n  setAuth(readAuthFromContext(), 'max');");
vm.runInContext(src,c);
const app=c.testApp;app.state.user={employeeRef:'self'};app.state.userId='123';app.state.orders=[{id:'order',orderRef:'order'}];app.state.selectedOrderId='order';
await app.preparePackage();
assert.deepEqual(calls.map(x=>x.url),['/api/1c/worktime/orders/works']);
assert.equal(calls[0].body.withoutActivePackages,true);
assert.doesNotMatch(element('sheetBody').innerHTML,/Активный пакет|Ссылка активного пакета|Коллега/);
await app.worktimeStep('worktime-works-next');
assert.equal(calls.at(-1).url,'/api/1c/worktime/executors/list');
assert.match(element('sheetBody').innerHTML,/Делаю сам/);
await app.worktimeStep('worktime-employees-next');
assert.match(element('sheetBody').innerHTML,/Распределение участия/);
assert.match(element('sheetBody').innerHTML,/Распределить % поровну/);
await app.worktimeStep('worktime-shares-equal');
assert.match(element('sheetBody').innerHTML,/value="50"/);
percent=30;await app.worktimeStep('worktime-shares-next');assert.equal(calls.length,2);assert.match(element('worktimeError').textContent,/100%/);
percent=40;await app.worktimeStep('worktime-shares-next');assert.match(element('sheetBody').innerHTML,/Подтверждение пакета/);
rejectValidation=true;await app.submitPackage();assert.equal(calls.length,3);assert.equal(app.state.orders[0].packageRef,undefined);
rejectValidation=false;missingPackage=true;await app.submitPackage();assert.equal(app.state.orders[0].packageRef,undefined);assert.match(element('worktimeError').textContent,/не вернула/);
missingPackage=false;failCreate=true;await app.submitPackage();assert.equal(app.state.orders[0].packageRef,undefined);
failCreate=false;await Promise.all([app.submitPackage(),app.submitPackage()]);
assert.equal(app.state.orders[0].packageRef,'created');
const creates=calls.filter(x=>x.url.endsWith('/packages/create'));
assert.equal(creates.length,3);assert.equal(new Set(creates.map(x=>x.body.clientPackageId)).size,1);
assert.ok(creates.every(x=>!('packageRef' in x.body)));
assert.deepEqual(creates.at(-1).body.participants,participants);
assert.equal(creates.at(-1).body.userId,'123');assert.ok(creates.at(-1).body.max);
await app.selectPackage();assert.match(element('sheetBody').innerHTML,/УРВ-7/);assert.doesNotMatch(element('sheetBody').innerHTML,/УРВ-6/);
app.usePackage('open-package','УРВ-7','Не стартовал');assert.equal(app.state.orders[0].packageRef,'open-package');
await app.packageAction('start');assert.equal(calls.at(-1).body.packageRef,'open-package');
await app.preparePackage();await app.worktimeStep('worktime-works-next');await app.worktimeStep('worktime-self');
assert.match(element('sheetBody').innerHTML,/Подтверждение пакета/);assert.doesNotMatch(element('sheetBody').innerHTML,/data-worktime-percent/);
await app.submitPackage();assert.deepEqual(calls.filter(x=>x.url.endsWith('/packages/create')).at(-1).body.participants,[{employeeRef:'self',percent:100}]);
selectedEmployees=['colleague'];await app.preparePackage();await app.worktimeStep('worktime-works-next');await app.worktimeStep('worktime-employees-next');
assert.doesNotMatch(element('sheetBody').innerHTML,/data-worktime-percent/);await app.submitPackage();
assert.deepEqual(calls.filter(x=>x.url.endsWith('/packages/create')).at(-1).body.participants,[{employeeRef:'colleague',percent:100}]);
// Read receipts update only the acknowledged chat and protect against an older poll.
app.state.unreadMessages=5;
app.messagesRead({previousUnread:3,remainingUnread:0});assert.equal(app.state.unreadMessages,2);
app.messagesRead({previousUnread:0,remainingUnread:0});assert.equal(app.state.unreadMessages,2);
app.messagesRead({previousUnread:2,remainingUnread:0,totalUnread:0});assert.equal(element('botUnread').hidden,true);
app.state.initialized=true;app.state.unreadMessages=3;resolvePoll=true;
const pending=app.pollNotifications();
app.messagesRead({previousUnread:3,remainingUnread:0,totalUnread:0});
resolvePoll({unreadMessagesCount:3,events:[{eventId:'old',type:'new_messages',payload:{unreadCount:3}}]});await pending;
assert.equal(app.state.unreadMessages,0);assert.equal(element('botUnread').hidden,true);
resolvePoll=null;pollData={unreadMessagesCount:0,events:[{eventId:'another-old',type:'new_messages',payload:{unreadCount:3}}]};await app.pollNotifications();assert.equal(app.state.unreadMessages,0);
pollData={unreadMessagesCount:1,events:[{eventId:'new',type:'new_messages'}]};await app.pollNotifications();assert.equal(app.state.unreadMessages,1);assert.equal(element('botUnread').hidden,false);
assert.equal(element('notifications').innerHTML,'');
console.log('Worktime wizard and badge: OK — staged loading, active work exclusion, solo/colleague 100%, shares, confirmation, retries; read receipt, partial counts, stale poll and new messages.');

app.state.unreadMessages=3;app.renderTabs();assert.match(element('tabs').innerHTML,/class="chat-unread-dot"/);assert.match(element('tabs').innerHTML,/>3<\/span>/);assert.doesNotMatch(fs.readFileSync(new URL('../index.html',import.meta.url),'utf8'),/id="botUnread"/);
