import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const frame={style:{},getBoundingClientRect(){return {top:120};}};
const app={innerHTML:'',querySelector(){return null;},querySelectorAll(){return [];}};
const calls=[], receipts=[], handlers={};let failRead=false,failSend=true,uuid=0;
const viewportHandlers={};
const scope={
  URL, location:{origin:'https://ea-itus.ru'},
  document:{baseURI:'https://ea-itus.ru/p/max-service/',body:{classList:{toggle(){},remove(){}}},
    getElementById(id){return id==='app'?app:null;},querySelector(selector){return selector==='.messenger'?frame:null;},addEventListener(type,handler){handlers[type]=handler;}},
  innerHeight:800,addEventListener(){},ITUS_FEATURES:{dateTime:()=>''},
  visualViewport:{height:700,offsetTop:0,addEventListener(type,handler){viewportHandlers[type]=handler;}},
  crypto:{randomUUID:()=>`uuid-${++uuid}`}
};
scope.window=scope;
vm.createContext(scope);
vm.runInContext(readFileSync(new URL('../assets/api-normalizers.js',import.meta.url),'utf8'),scope);
vm.runInContext(readFileSync(new URL('../assets/messenger.js',import.meta.url),'utf8'),scope);
const mock={
  '/internal-chat/groups/list':{data:{groups:[{groupRef:'shift',title:'Передача смены',unreadCount:2},{groupRef:'all',title:'Общий цех',isCommon:true,lastMessageAt:'2026-10-01T10:00:00Z'}]}},
  '/internal-chat/contacts/list':{data:{contacts:[{employeeRef:'one',name:'Анна',authorized:true},{employeeRef:'two',name:'Нет входа',authorized:false}]}},
  '/internal-chat/direct/open':{data:{groupRef:'direct-one'}},
  '/internal-chat/messages/list':{data:{messages:[
    {messageRef:'message-2',direction:'incoming',text:'Позднее',createdAt:'2026-10-07T10:02:00Z',attachments:[{fileName:'photo.jpg',mimeType:'image/jpeg',downloadUrl:'https://ea-itus.ru/photo.jpg'}]},
    {messageRef:'message-1',direction:'outgoing',authorName:'Реальный автор',text:'Ранее',createdAt:'2026-10-07T10:01:00Z'}]}},
  '/internal-chat/messages/read':{data:{read:true}},
  '/internal-chat/messages/send':{data:{message:{messageRef:'sent-1',direction:'outgoing',text:'Повтор'}}},
  '/clients/topics/list':{data:{topics:[{topicRef:'client-one',title:'Клиент'}]}},
  '/clients/messages/list':{data:{messages:[]}},
  '/clients/messages/send':{data:{message:{messageRef:'client-sent-1',direction:'outgoing',text:'Клиент'}}}
};
const messenger=scope.ITUS_MESSENGER.create({api:scope.ITUS_API,call:async(method,payload)=>{
  calls.push({method,payload});if(failRead && method.endsWith('/messages/read'))throw Error('Read rejected');if(failSend&&method.endsWith('/messages/send'))throw Error('Send rejected');if(!mock[method])throw new Error('Unexpected '+method);return mock[method];
},onRead:receipt=>receipts.push(receipt),user:()=>({name:'Тест'}),allowed:()=>['staff','clients'],toast(){},pickFile(){},photo(){},filePayload(){},closeSheet(){},sheet(){},settings(){}});
await messenger.enter('staff');
assert.equal(frame.style.height,'570px');assert.equal(frame.style.minHeight,'300px');
scope.visualViewport.height=240;viewportHandlers.resize();
assert.equal(frame.style.height,'110px');assert.equal(frame.style.minHeight,'110px');
assert.match(app.innerHTML,/Передача смены/);
assert.ok(app.innerHTML.indexOf('Общий цех')<app.innerHTML.indexOf('Передача смены'));assert.match(app.innerHTML,/Общий чат/);
await messenger.handle('msg-open',{dataset:{ref:'shift'}});
assert.equal(calls.find(x=>x.method==='/internal-chat/messages/read').payload.messageRefs[0],'message-2');
assert.equal(receipts[0].previousUnread,2);assert.equal(receipts[0].remainingUnread,0);
assert.ok(app.innerHTML.indexOf('Ранее')<app.innerHTML.lastIndexOf('Позднее'));
assert.match(app.innerHTML,/Реальный автор/);
assert.doesNotMatch(app.innerHTML,/<div class="msg-author">Тест<\/div>/);
assert.match(app.innerHTML,/photo.jpg/);
assert.match(app.innerHTML,/data-action="msg-media"/);
assert.doesNotMatch(app.innerHTML,/<img src="https:\/\/ea-itus.ru\/photo.jpg"/);
assert.doesNotMatch(app.innerHTML,/data-auto-image/);
handlers.input({target:{id:'msgDraft',value:'Повтор'}});await messenger.handle('msg-send',{dataset:{}});
failSend=false;await messenger.handle('msg-send',{dataset:{}});
const sends=calls.filter(x=>x.method==='/internal-chat/messages/send');assert.equal(sends.length,2);assert.equal(sends[0].payload.clientMessageId,sends[1].payload.clientMessageId);
handlers.input({target:{id:'msgDraft',value:'Enter'}});
let prevented=0;
handlers.keydown({target:{id:'msgDraft'},key:'Enter',ctrlKey:false,altKey:false,metaKey:false,shiftKey:false,repeat:false,isComposing:false,preventDefault(){prevented++;}});
await new Promise(resolve=>setTimeout(resolve,0));
assert.equal(prevented,1);assert.equal(calls.filter(x=>x.method==='/internal-chat/messages/send').length,3);
handlers.input({target:{id:'msgDraft',value:'Не отправлять'}});
handlers.keydown({target:{id:'msgDraft'},key:'Enter',ctrlKey:true,repeat:false,isComposing:false,preventDefault(){throw Error('Ctrl+Enter must be ignored');}});
handlers.keydown({target:{id:'msgDraft'},key:'Enter',ctrlKey:true,repeat:true,isComposing:false,preventDefault(){throw Error('Repeated shortcut must be ignored');}});
handlers.keydown({target:{id:'msgDraft'},key:'Enter',ctrlKey:false,repeat:false,isComposing:true,preventDefault(){throw Error('IME composition must be ignored');}});
assert.equal(calls.filter(x=>x.method==='/internal-chat/messages/send').length,3);
await messenger.handle('msg-back',{dataset:{}});
assert.match(app.innerHTML,/Новый чат с сотрудником/);
const historyCallsBeforeReopen=calls.filter(x=>x.method==='/internal-chat/messages/list').length;
await messenger.handle('msg-open',{dataset:{ref:'shift'}});
const historyCallsAfterReopen=calls.filter(x=>x.method==='/internal-chat/messages/list');
assert.equal(historyCallsAfterReopen.length,historyCallsBeforeReopen+1);
assert.equal(historyCallsAfterReopen.at(-1).payload.includeAttachmentContent,false);
mock['/internal-chat/messages/list']={data:{messages:[
  {direction:'incoming',text:'no-server-id',createdAt:'2026-10-07T10:03:00Z'},
  {direction:'incoming',text:'no-server-id',createdAt:'2026-10-07T10:03:00Z'}
]}};
await messenger.handle('msg-refresh-messages',{dataset:{}});
assert.equal((app.innerHTML.match(/no-server-id/g)||[]).length,2);
await messenger.handle('msg-back',{dataset:{}});
await messenger.handle('msg-new-chat',{dataset:{}});
assert.match(app.innerHTML,/Анна/);
assert.doesNotMatch(app.innerHTML,/Нет входа/);
await messenger.handle('msg-open',{dataset:{ref:'one'}});
assert.equal(calls.find(x=>x.method==='/internal-chat/direct/open').payload.employeeRef,'one');
await messenger.handle('msg-source',{dataset:{source:'clients'}});
await messenger.handle('msg-open',{dataset:{ref:'client-one'}});
handlers.input({target:{id:'msgDraft',value:'Клиенту'}});
handlers.keydown({target:{id:'msgDraft'},key:'Enter',ctrlKey:false,altKey:false,metaKey:false,shiftKey:false,repeat:false,isComposing:false,preventDefault(){}});
await new Promise(resolve=>setTimeout(resolve,0));
assert.equal(calls.filter(x=>x.method==='/clients/messages/send').length,1);
console.log('Messenger: shift group, authorized contacts, direct conversation and read receipt OK');

const before=receipts.length;failRead=true;await messenger.handle('msg-refresh-messages',{dataset:{}});assert.equal(receipts.length,before);
console.log('Messenger cache: no eager media, lightweight history refresh, read receipt and Enter behavior OK.');
