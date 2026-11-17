import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';import vm from 'node:vm';import {webcrypto} from 'node:crypto';
import {PushInstallations} from '../push-installations.mjs';
const policy=globalThis.ITUS_CHAT_POLICY,folder=mkdtempSync(join(tmpdir(),'imax-chat-preferences-'));
try{
  const registry=new PushInstallations(folder);
  async function install(user,platform,resource){const input={platform,clientInstanceId:platform+'-'+user+'-installation',...(platform==='android'?{token:resource}:{subscription:{endpoint:resource}})},row=await registry.begin(user,'test',input);await registry.bind(user,'test',{...input,activationId:row.activationId});}
  await install('111','android','token-one');await install('111','web','endpoint-one');await install('222','android','token-two');
  await registry.setMuted('111','test',{source:'clients',ref:'same-ref',muted:true});
  for(const [platform,resource] of [['android','token-one'],['web','endpoint-one']]){
    assert.equal(await registry.recipient(platform,resource,'test',{type:'new_messages',topicRef:'same-ref'}),null);
    assert.ok(await registry.recipient(platform,resource,'test',{type:'internal_chat_message',topicRef:'same-ref'}));
    assert.ok(await registry.recipient(platform,resource,'test',{type:'executor_assigned',orderRef:'same-ref'}));
    assert.ok(await registry.recipient(platform,resource,'test',{type:'new_messages',topicRef:'other'}));
  }
  assert.ok(await registry.recipient('android','token-two','test',{type:'new_messages',topicRef:'same-ref'}));
  assert.equal((await registry.preferences('111','production')).muted.length,0);
  const restarted=new PushInstallations(folder);assert.equal(await restarted.recipient('android','token-one','test',{type:'new_messages',topicRef:'same-ref'}),null);
  await Promise.all([registry.setMuted('111','test',{source:'staff',ref:'another',muted:true}),restarted.setMuted('111','test',{source:'clients',ref:'third',muted:true})]);
  assert.equal((await restarted.preferences('111','test')).muted.length,3);
  await restarted.setMuted('111','test',{source:'clients',ref:'same-ref',muted:false});assert.ok(await restarted.recipient('web','endpoint-one','test',{type:'new_messages',topicRef:'same-ref'}));
  await assert.rejects(registry.setMuted('111','test',{source:'unknown',ref:'x',muted:true}));
  const ordered=policy.sortTopics([{ref:'old',lastMessageAt:'2026-01-01T12:00:00Z'},{ref:'new-client',createdAt:'2026-02-01T12:00:00Z'},{ref:'recent-message',lastMessageAt:'2026-03-01T12:00:00Z'},{ref:'no-date'},{ref:'other-no-date'}],'clients');
  assert.deepEqual(ordered.map(x=>x.ref),['recent-message','new-client','old','no-date','other-no-date']);
  assert.equal(policy.sortTopics([{ref:'last',lastMessageAt:'2027-01-01'},{ref:'common',common:true}],'staff')[0].ref,'common');
  assert.equal(policy.sortTopics([{ref:'read-receipt',lastMessageAt:'2026-01-01',updatedAt:'2028-01-01'},{ref:'message',lastMessageAt:'2027-01-01'}],'clients')[0].ref,'message','read/status changes cannot outrank an actual newer message');
  assert.equal(policy.pushThread({type:'defect_complete',topicRef:'same-ref'}),null);
}finally{rmSync(folder,{recursive:true,force:true});}

const saved=new Map(),server=new Map();let current={scope:'test|111',generation:1,userId:'111',apiBase:'https://test.invalid/api/1c'},offline=false,hold=null;
const source=name=>readFileSync(new URL('../assets/'+name+'.js',import.meta.url),'utf8');
const root={crypto:webcrypto,AbortController,setTimeout,clearTimeout,localStorage:{getItem:k=>saved.get(k)||null,setItem:(k,v)=>saved.set(k,v)},fetch:async(url,options)=>{
  const owner=current.scope;if(offline)throw Error('offline');if(hold)await hold;
  let muted=server.get(owner)||[];
  if(options.body){const input=JSON.parse(options.body);muted=muted.filter(x=>x.source!==input.source||x.ref!==input.ref);if(input.muted)muted.push({source:input.source,ref:input.ref});server.set(owner,muted);}
  return {ok:true,json:async()=>({success:true,data:{muted}})};
}};root.window=root;vm.createContext(root);vm.runInContext(source('chat-policy'),root);vm.runInContext(source('chat-preferences'),root);
const preferences=root.ITUS_CHAT_PREFERENCES.create({context:()=>({...current}),media:()=>({connect:async()=>{},headers:()=>({'X-ITUS-Device':'synthetic'})})});
offline=true;let state=await preferences.set('clients','one',true);assert.equal(state.pending,true);assert.equal(state.confirmed,false);
current={...current,scope:'production|111',generation:2};assert.equal(preferences.status('clients','one').muted,false);
current={...current,scope:'test|222',userId:'222',generation:3};assert.equal(preferences.status('clients','one').muted,false);
current={...current,scope:'test|111',userId:'111',generation:4};assert.equal(preferences.status('clients','one').pending,true);
offline=false;await preferences.load();assert.equal(preferences.status('clients','one').confirmed,true);assert.equal(preferences.status('clients','one').pending,false);
assert.equal(preferences.suppress({type:'new_messages',topicRef:'one'}),true);assert.equal(preferences.suppress({type:'executor_assigned',orderRef:'one'}),false);
let release;hold=new Promise(r=>release=r);const pending=preferences.set('clients','two',true);await new Promise(r=>setTimeout(r,0));current={...current,scope:'test|222',userId:'222',generation:5};release();await assert.rejects(pending,error=>error.code==='SESSION_CHANGED');assert.equal(preferences.status('clients','two').muted,false);
console.log('Chat preferences: server filtering before FCM/Web Push, restart, atomic concurrent saves, chat/user/contour isolation, stable sorting, offline pending recovery and stale-session rejection passed.');
