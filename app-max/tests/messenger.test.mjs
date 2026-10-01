import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const app={innerHTML:'',querySelector(){return null;}};
const calls=[], receipts=[];let failRead=false;
const scope={
  URL, location:{origin:'https://ea-itus.ru'},
  document:{baseURI:'https://ea-itus.ru/p/max-service/',body:{classList:{toggle(){},remove(){}}},
    getElementById(id){return id==='app'?app:null;},querySelector(){return null;},addEventListener(){}},
  innerHeight:800,addEventListener(){},ITUS_FEATURES:{dateTime:()=>''},
  crypto:{randomUUID:()=>String(Date.now())}
};
scope.window=scope;
vm.createContext(scope);
vm.runInContext(readFileSync(new URL('../assets/api-normalizers.js',import.meta.url),'utf8'),scope);
vm.runInContext(readFileSync(new URL('../assets/messenger.js',import.meta.url),'utf8'),scope);
const mock={
  '/internal-chat/groups/list':{data:{groups:[{groupRef:'shift',title:'Передача смены',unreadCount:2}]}},
  '/internal-chat/contacts/list':{data:{contacts:[{employeeRef:'one',name:'Анна',authorized:true},{employeeRef:'two',name:'Нет входа',authorized:false}]}},
  '/internal-chat/direct/open':{data:{groupRef:'direct-one'}},
  '/internal-chat/messages/list':{data:{messages:[{messageRef:'message-1',direction:'incoming',text:'Привет'}]}},
  '/internal-chat/messages/read':{data:{read:true}}
};
const messenger=scope.ITUS_MESSENGER.create({api:scope.ITUS_API,call:async(method,payload)=>{
  calls.push({method,payload});if(failRead && method.endsWith('/messages/read'))throw Error('Read rejected');if(!mock[method])throw new Error('Unexpected '+method);return mock[method];
},onRead:receipt=>receipts.push(receipt),user:()=>({name:'Тест'}),allowed:()=>['staff'],toast(){},pickFile(){},photo(){},filePayload(){},closeSheet(){},sheet(){},settings(){}});
await messenger.enter();
assert.match(app.innerHTML,/Передача смены/);
await messenger.handle('msg-open',{dataset:{ref:'shift'}});
assert.equal(calls.find(x=>x.method==='/internal-chat/messages/read').payload.messageRefs[0],'message-1');
assert.equal(receipts[0].previousUnread,2);assert.equal(receipts[0].remainingUnread,0);
await messenger.handle('msg-back',{dataset:{}});
assert.match(app.innerHTML,/Новый чат с сотрудником/);
await messenger.handle('msg-new-chat',{dataset:{}});
assert.match(app.innerHTML,/Анна/);
assert.doesNotMatch(app.innerHTML,/Нет входа/);
await messenger.handle('msg-open',{dataset:{ref:'one'}});
assert.equal(calls.find(x=>x.method==='/internal-chat/direct/open').payload.employeeRef,'one');
console.log('Messenger: shift group, authorized contacts, direct conversation and read receipt OK');

const before=receipts.length;failRead=true;await messenger.handle('msg-refresh-messages',{dataset:{}});assert.equal(receipts.length,before);
console.log('Read failure: no badge callback before a successful receipt.');
