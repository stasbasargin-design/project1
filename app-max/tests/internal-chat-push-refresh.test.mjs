import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const app={innerHTML:'',querySelector(){return null;},querySelectorAll(){return [];}};
const calls=[],pendingA=[];
let holdA=false;
const scope={
  URL,location:{origin:'https://example.test'},
  document:{baseURI:'https://example.test/',hidden:false,body:{classList:{toggle(){},remove(){}}},getElementById:id=>id==='app'?app:null,querySelector(){return null;},addEventListener(){}},
  innerHeight:800,addEventListener(){},ITUS_FEATURES:{dateTime:()=>''},crypto:{randomUUID:()=> 'test-id'}
};
scope.window=scope;
vm.createContext(scope);
vm.runInContext(readFileSync(new URL('../assets/api-normalizers.js',import.meta.url),'utf8'),scope);
vm.runInContext(readFileSync(new URL('../assets/messenger.js',import.meta.url),'utf8'),scope);

const responseFor=ref=>({data:{messages:[{messageRef:`${ref}-message`,direction:'incoming',text:`${ref}-fresh`,createdAt:'2026-10-23T10:00:00Z'}]}});
const messenger=scope.ITUS_MESSENGER.create({
  api:scope.ITUS_API,
  call(method,payload){
    calls.push({method,payload});
    if(method==='/internal-chat/groups/list')return Promise.resolve({data:{groups:[{groupRef:'a',title:'A'},{groupRef:'b',title:'B'}]}});
    if(method==='/internal-chat/messages/list'&&payload.groupRef==='a'&&holdA)return new Promise(resolve=>pendingA.push(resolve));
    if(method==='/internal-chat/messages/list')return Promise.resolve(responseFor(payload.groupRef));
    throw Error(`Unexpected ${method}`);
  },
  user:()=>({id:'user'}),allowed:()=>['staff'],toast(){},pickFile(){},photo(){},filePayload(){},closeSheet(){},sheet(){},settings(){}
});
const historyCalls=()=>calls.filter(call=>call.method==='/internal-chat/messages/list');
const flush=()=>new Promise(resolve=>setTimeout(resolve,0));

await messenger.enter('staff');
await messenger.openThread('staff','a');
const initial=historyCalls().length;
assert.equal(messenger.refreshInternalThreadFromPush('b'),false,'another internal chat must not refresh');
assert.equal(historyCalls().length,initial);

holdA=true;
assert.equal(messenger.refreshInternalThreadFromPush('a'),true,'the visible matching chat refreshes');
assert.equal(messenger.refreshInternalThreadFromPush('a'),true,'a repeated event is coalesced');
await flush();
assert.equal(historyCalls().length,initial+1,'only one request is active');
pendingA.shift()(responseFor('a'));
await flush();
assert.equal(historyCalls().length,initial+2,'events during a request schedule one follow-up refresh');
holdA=false;
pendingA.shift()(responseFor('a'));
await flush();

holdA=true;
assert.equal(messenger.refreshInternalThreadFromPush('a'),true);
await flush();
await messenger.openThread('staff','b');
pendingA.shift()(responseFor('a'));
await flush();
assert.match(app.innerHTML,/b-fresh/);
assert.doesNotMatch(app.innerHTML,/a-fresh/,'a late response must not replace the visible b thread');

await messenger.handle('msg-back',{dataset:{}});
assert.equal(messenger.refreshInternalThreadFromPush('b'),false,'the chat list must not refresh a thread');
scope.document.hidden=true;
assert.equal(messenger.refreshInternalThreadFromPush('b'),false,'a hidden app must not refresh a thread');
console.log('Internal chat Push refresh: filtering, request coalescing and switch protection OK.');
