import assert from 'node:assert/strict';import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {PushInstallations} from '../push-installations.mjs';
import {AndroidUpdateNotices,captureAndroidSubscription,olderAndroidVersion,androidSubscriptionActivation} from '../android-update-notices.mjs';
const directory=await mkdtemp(join(tmpdir(),'imax-release-notices-'));
const release={enabled:true,notify:true,packageName:'ru.eazia.imax',version:'2.9.8',versionCode:2908,sha256:'a'.repeat(64),commit:'b'.repeat(40)};
try{
 assert.equal(olderAndroidVersion('2.9.7','2.9.8'),true);assert.equal(olderAndroidVersion('2.9.10','2.9.8'),false);
 for(const value of ['','unknown','2.9','bad.9.1','99999999999999999999.1.0'])assert.equal(olderAndroidVersion(value,'2.9.8'),false);
 const registry=new PushInstallations(join(directory,'registry'));
 async function register(id,environment,version,platform='android'){
  const input={platform,clientInstanceId:'synthetic-'+id,userId:'111',version:'i-max-'+version,token:'token-'+id};
  const begun=await registry.begin('111',environment,input);
  const upstream=new Response(JSON.stringify({success:true,data:{registered:true}}));
  const activation=await androidSubscriptionActivation(registry,JSON.stringify(input),environment);
  const captured=await captureAndroidSubscription(registry,upstream,Buffer.from(JSON.stringify(input)),environment,activation);
  assert.deepEqual(await upstream.json(),{success:true,data:{registered:true}},'1C response remains unchanged');
  if(platform==='android')assert.equal(captured,true);else assert.equal(captured,false);
  await registry.bind('111',environment,{...input,activationId:begun.activationId,...(platform==='web'?{subscription:{endpoint:'https://synthetic.invalid/'+id}}:{})});
  return {...input,activationId:begun.activationId};
 }
 const old=await register('old','test','2.9.3');await register('equal','test','2.9.8');await register('newer','test','2.9.10');await register('prod','production','2.9.3');await register('web','test','2.9.3','web');
 const paused=await register('paused','test','2.9.3');await registry.pause('111','test',paused);
 const unknown={platform:'android',clientInstanceId:'synthetic-unknown',userId:'111',token:'token-unknown',version:'unknown'};await registry.begin('111','test',unknown);
 assert.equal(await captureAndroidSubscription(registry,new Response('{"success":true,"data":{"registered":true}}'),JSON.stringify(unknown),'test','invalid'),false);
 const unconfirmed={...old,clientInstanceId:'synthetic-unconfirmed',token:'token-unconfirmed'};await registry.begin('111','test',unconfirmed);
 assert.equal(await captureAndroidSubscription(registry,new Response('{"success":false,"data":{"registered":false}}'),JSON.stringify(unconfirmed),'test','invalid'),false);
 assert.equal(await captureAndroidSubscription(registry,new Response('{}',{status:422}),JSON.stringify(old),'test',old.activationId),false);
 // A delayed response from the previous login must not update a new activation.
 const delayed={...old,clientInstanceId:'synthetic-delayed',token:'token-delayed'};await registry.begin('111','test',delayed);
 const beforeRestart=await androidSubscriptionActivation(registry,JSON.stringify(delayed),'test');await registry.begin('111','test',delayed);
 assert.equal(await captureAndroidSubscription(registry,new Response('{"success":true,"data":{"registered":true}}'),JSON.stringify(delayed),'test',beforeRestart),false);
 const sent=[];let current=release,verified=0;
 const make=(environment='test',send=async message=>sent.push(message))=>new AndroidUpdateNotices({registry:new PushInstallations(registry.directory),environment,release:()=>current,verify:async()=>{verified++;},send});
 // Independent processes/instances use durable filesystem claims.
 await Promise.all(Array.from({length:6},()=>make().run()));
 assert.equal(sent.length,1);assert.equal(sent[0].token,old.token);assert.equal(sent[0].data.environment,'test');assert.equal(sent[0].data.versionCode,'2908');
 await make().run();assert.equal(sent.length,1,'restart/repeated release does not repeat');
 const rotated={...old,token:'new-token-old'};await registry.confirmedAndroidSubscription('test',rotated);await registry.bind('111','test',rotated);
 await make().run();assert.equal(sent.length,1,'token rotation retains per-installation receipt');
 await make('production').run();assert.equal(sent.length,2);assert.equal(sent[1].token,'token-prod');assert.equal(sent[1].data.environment,'production');
 current={...release,notify:false};await make().run();assert.equal(sent.length,2);
 current={...release,version:'2.9.9',versionCode:2909};await make().run();assert.deepEqual(sent.slice(2).map(x=>x.token).sort(),['new-token-old','token-equal']);
 assert.equal(new Set(sent.map(x=>x.data.eventId)).size,sent.length);
 current={...release,version:'2.9.11',versionCode:2911};let attempts=0;
 await make('test',async()=>{attempts++;throw Object.assign(Error('reply lost'),{code:'FCM_TIMEOUT'});}).run();const attempted=attempts;
 await make('test',async()=>{attempts++;}).run();assert.equal(attempts,attempted,'uncertain FCM response never replays');assert.ok(attempted>0);
 const other=new PushInstallations(join(directory,'switch'));const input={platform:'android',clientInstanceId:'synthetic-switch',userId:'111',version:'i-max-2.9.3',token:'switch-token'};
 let begun=await other.begin('111','test',input);await other.confirmedAndroidSubscription('test',input);await other.bind('111','test',{...input,activationId:begun.activationId});
 let switchSends=0;
 const switching=new AndroidUpdateNotices({registry:other,environment:'test',release:()=>release,verify:async()=>{
  begun=await other.begin('111','production',input);await other.confirmedAndroidSubscription('production',input);await other.bind('111','production',{...input,activationId:begun.activationId});
 },send:async()=>switchSends++});
 await switching.run();assert.equal(switchSends,0,'switch before claim suppresses old environment');
 const corrupt=new AndroidUpdateNotices({registry:other,environment:'production',release:()=>release,verify:async()=>{throw Error('hash mismatch');},send:async()=>switchSends++});
 await assert.rejects(corrupt.run(),/hash mismatch/);assert.equal(switchSends,0);
 const valid=new AndroidUpdateNotices({registry:other,environment:'production',release:()=>release,verify:async()=>{},send:async()=>switchSends++});await valid.run();assert.equal(switchSends,1,'invalid APK was not claimed or announced');
 let next={...release,version:'2.9.9',versionCode:2909,notify:false};
 const toggled=new AndroidUpdateNotices({registry:other,environment:'production',release:()=>next,verify:async()=>{},send:async()=>switchSends++});
 await toggled.run();assert.equal(switchSends,1,'deploy without notify never sends');next={...next,notify:true};await toggled.run();assert.equal(switchSends,2);
 console.log('APK release Push: only older confirmed Android registrations, equal/newer/unknown/web/paused skipped, durable concurrent deduplication, token rotation, lost FCM reply, environment switch and APK hash gate passed.');
}finally{await rm(directory,{recursive:true,force:true});}
