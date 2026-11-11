import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {oneCEnvironments,environmentRoute,mediaEnvironment} from '../one-c-environments.mjs';
import {PushInstallations} from '../push-installations.mjs';
const folder=await mkdtemp(join(tmpdir(),'imax-environments-'));
const connections=oneCEnvironments({ONE_C_TARGET:'https://test.example/hs/app',ONE_C_PRODUCTION_TARGET:'https://production.example/hs/app'});
assert.equal(environmentRoute('/api/1c/orders/get',connections).connection.id,'test');
assert.equal(environmentRoute('/contours/production/api/1c/orders/get',connections).connection.id,'production');
assert.equal(environmentRoute('/contours/evil/api/1c/orders/get',connections),null);
assert.notEqual(mediaEnvironment({MEDIA_STATE_DIR:folder},connections.test).MEDIA_STATE_DIR,mediaEnvironment({MEDIA_STATE_DIR:folder},connections.production).MEDIA_STATE_DIR);
const registry=new PushInstallations(join(folder,'registry'));
const installation={platform:'android',clientInstanceId:'same-installation'};
const first=await registry.begin('111','test',installation);
await registry.bind('111','test',{...installation,activationId:first.activationId,token:'same-token'});
assert.equal((await registry.recipient('android','same-token','test')).environment,'test');
assert.equal(await registry.recipient('android','same-token','production'),null);
const otherProcess=new PushInstallations(join(folder,'registry'));
const second=await otherProcess.begin('111','production',installation);
await assert.rejects(registry.bind('111','test',{...installation,activationId:first.activationId,token:'late-old-token'}),{status:409});
assert.equal(await registry.recipient('android','same-token','test'),null);
await otherProcess.bind('111','production',{...installation,activationId:second.activationId,token:'same-token'});
assert.equal((await registry.recipient('android','same-token','production')).activationId,second.activationId);
await assert.rejects(registry.pause('111','test',{...installation,activationId:first.activationId}),{status:409});
await otherProcess.pause('111','production',{...installation,activationId:second.activationId});
assert.equal(await registry.recipient('android','same-token','production'),null);
assert.equal(await registry.recipient('android','same-token','test'),null);
assert.equal(await registry.recipient('android','unregistered','production'),null);

const calls=[];
async function upstream(environment){const server=createServer(async(req,res)=>{
  let raw='';for await(const chunk of req)raw+=chunk;
  const body=JSON.parse(raw);calls.push({environment,path:req.url,body,headers:req.headers});
  res.setHeader('Content-Type','application/json');
  res.end(JSON.stringify({success:true,data:{user:{employeeRef:'employee-'+environment,name:'Synthetic'},environment,order:{orderRef:'order',defectDocumentRef:'doc'},messages:[{messageRef:'same-id',text:environment}]}}));
});await new Promise(r=>server.listen(0,'127.0.0.1',r));return server;}
const test=await upstream('test'),production=await upstream('production');
const child=spawn(process.execPath,[fileURLToPath(new URL('../server.mjs',import.meta.url))],{env:{...process.env,PORT:'18290',LISTEN_HOST:'127.0.0.1',APP_BASE_PATH:'/p/max-service',ONE_C_TARGET:'http://127.0.0.1:'+test.address().port,ONE_C_TOKEN:'test-secret',ONE_C_PRODUCTION_TARGET:'http://127.0.0.1:'+production.address().port,ONE_C_PRODUCTION_TOKEN:'production-secret',MEDIA_BUFFER_ENABLED:'true',MEDIA_STATE_DIR:join(folder,'media'),MEDIA_CONTEXT:'test',MEDIA_S3_BUCKET:'offline',MEDIA_S3_ACCESS_KEY:'offline',MEDIA_S3_SECRET_KEY:'offline',PUSH_INSTALLATIONS_DIR:join(folder,'http-registry'),PUSH_INTERNAL_TOKEN:'offline-push',GOOGLE_APPLICATION_CREDENTIALS:''},stdio:['ignore','pipe','pipe']});
let logs='';child.stdout.on('data',c=>logs+=c);child.stderr.on('data',c=>logs+=c);
const base='http://127.0.0.1:18290/p/max-service';
async function post(path,body,headers={}){const r=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};}
try{
  for(let n=0;n<200;n++){try{if((await fetch(base+'/health')).ok)break;}catch{}await new Promise(r=>setTimeout(r,50));}
  const configuration=await(await fetch(base+'/api/environments/config')).json();assert.equal(configuration.data.production,true);assert.equal(configuration.data.isolatedPush,true);
  await new Promise(r=>setTimeout(r,600));
  const owner={userId:'111',maxUserId:'111',authId:'111'};
  for(const [path,expected,token] of [['','test','test-secret'],['/contours/production','production','production-secret']]){
    for(const route of ['/orders/get','/internal-chat/messages/list']){
      const response=await post(path+'/api/1c'+route,{...owner,requestId:'request-identity',includeAttachmentContent:false},{'x-itus-request-id':'request-identity','X-ITUS-Token':'forged'});
      assert.equal(response.status,200,logs);assert.equal(response.body.data.environment,expected);
      assert.equal(calls.at(-1).headers['x-itus-token'],token);
      assert.equal(calls.at(-1).headers['x-itus-request-id'],'request-identity');
    }
  }
  assert.equal((await post('/contours/unknown/api/1c/orders/get',owner)).status,404);
  const sessionTest=await post('/api/media/session',owner),sessionProduction=await post('/contours/production/api/media/session',owner);
  assert.equal(sessionTest.status,200,logs);assert.equal(sessionProduction.status,200,logs);
  const authTest={'X-ITUS-Device':sessionTest.body.data.token},authProduction={'X-ITUS-Device':sessionProduction.body.data.token};
  assert.equal((await post('/contours/production/api/push/installation',{...installation,action:'begin'},authTest)).status,401);
  const begin=await post('/api/push/installation',{...installation,action:'begin'},authTest);assert.equal(begin.status,200);
  assert.equal((await post('/api/push/installation',{...installation,action:'bind',activationId:begin.body.data.activationId,token:'synthetic-token'},authTest)).status,200);
  const switchBegin=await post('/contours/production/api/push/installation',{...installation,action:'begin'},authProduction);assert.equal(switchBegin.status,200);
  assert.equal((await post('/api/push/installation',{...installation,action:'bind',activationId:begin.body.data.activationId,token:'synthetic-token'},authTest)).status,409);
  const blocked=await post('/api/push/dispatch',{tokens:['synthetic-token'],body:'Test'},{Authorization:'Bearer offline-push'});assert.equal(blocked.status,200);assert.equal(blocked.body.data.sent,0);assert.equal(blocked.body.data.skipped,1);
  assert.equal((await post('/contours/production/api/push/installation',{...installation,action:'bind',activationId:switchBegin.body.data.activationId,token:'synthetic-token'},authProduction)).status,200);
  const wrong=await post('/api/push/dispatch',{tokens:['synthetic-token'],body:'Test'},{Authorization:'Bearer offline-push'});assert.equal(wrong.body.data.skipped,1);
  const right=await post('/contours/production/api/push/dispatch',{tokens:['synthetic-token'],body:'Production'},{Authorization:'Bearer offline-push'});assert.equal(right.status,503,'right environment reaches disabled offline Firebase');
  console.log('1C environments: distinct upstreams/credentials/media stores, late registration rejection, switched Push filtering and legacy queue paths passed');
}finally{child.kill();await Promise.all([new Promise(r=>test.close(r)),new Promise(r=>production.close(r))]);await rm(folder,{recursive:true,force:true});}

const development={ITUS_VITE_DEV:true,ITUS_CONFIG:{ONE_C_API_BASE_URL:'/api/1c'}};
vm.runInNewContext(readFileSync(new URL('../assets/environments.js',import.meta.url),'utf8'),{window:development});
assert.equal(development.ITUS_ENVIRONMENTS,undefined,'Vite keeps its existing test-only proxy without enabling unavailable server routes');
assert.equal(development.ITUS_CONFIG.ONE_C_API_BASE_URL,'/api/1c');
const vite=await import('../vite.config.js');
const developmentPlugin=vite.default.plugins.find(p=>p.name==='itus-development-test-api');
assert.equal(developmentPlugin.apply,'serve');
assert.match(developmentPlugin.transformIndexHtml()[0].children,/ITUS_VITE_DEV=true/);
const storage=new Map([['itus.maxUserId','111']]),nativeStates=[],clientCalls=[];
let serverRevision=0;
function client(){
  let reloaded=false;
  const root={ITUS_CONFIG:{ONE_C_API_BASE_URL:'https://imax.example/p/max-service/api/1c',ONE_C_PUBLIC_BASE_URL:'https://1c.example/test'},crypto:webcrypto,AbortSignal,URL,
    localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
    addEventListener(){},location:{reload(){reloaded=true;}},Capacitor:{isNativePlatform:()=>true,registerPlugin:()=>({setPushContext:async value=>nativeStates.push(value)})},
    fetch:async(url,options)=>{
      clientCalls.push(url);
      if(url.endsWith('/config'))return {ok:true,json:async()=>({success:true,data:{test:true,production:true,isolatedPush:true}})};
      const body=JSON.parse(options.body),environment=url.includes('/contours/production/')?'production':'test';
      const data=body.action==='begin'?{environment,userId:'111',activationId:'activation-'+(++serverRevision),enabled:false}:{enabled:body.action==='bind'};
      return {ok:true,json:async()=>({success:true,data})};
    }};
  vm.runInNewContext(readFileSync(new URL('../assets/environments.js',import.meta.url),'utf8'),{window:root,AbortSignal,URL,Error,JSON,Promise});
  return {env:root.ITUS_ENVIRONMENTS,config:root.ITUS_CONFIG,reloaded:()=>reloaded};
}
const media={connect:async()=>{},headers:()=>({'X-ITUS-Device':'offline'})};
const upgraded=client();assert.equal(upgraded.env.id,'production','new install/upgrade defaults to the real production 1C');
assert.equal(upgraded.env.initialUserId(),'111','upgrade may reuse MAX ID only, not an old authenticated session');
assert.match(upgraded.config.ONE_C_API_BASE_URL,/\/contours\/production\/api\/1c$/);
assert.equal(client().env.initialUserId(),'','later reloads cannot restore a logged-out production user from test credentials');
storage.set('itus.environment:https://imax.example/p/max-service','test');
const firstClient=client();await firstClient.env.load();await firstClient.env.begin(media);await firstClient.env.bind(media,{token:'token'});
const oldActivation=firstClient.env.activationId();
assert.equal(firstClient.env.accepts({environment:'test',activationId:oldActivation}),true);
assert.equal(firstClient.env.accepts({environment:'production',activationId:oldActivation}),false);
await firstClient.env.pause(media);firstClient.env.select('production','111');assert.equal(firstClient.reloaded(),true);
assert.equal(nativeStates.at(-1).enabled,false);
const secondClient=client();assert.equal(secondClient.env.id,'production');assert.notEqual(secondClient.env.authKey,firstClient.env.authKey);
assert.notEqual(firstClient.env.cacheOwner('111'),secondClient.env.cacheOwner('111'));
assert.match(secondClient.config.ONE_C_API_BASE_URL,/\/contours\/production\/api\/1c$/);
await secondClient.env.load();await secondClient.env.bind(media,{token:'token'});
assert.equal(secondClient.env.accepts({environment:'test',activationId:oldActivation}),false);
assert.equal(secondClient.env.accepts({environment:'production',activationId:secondClient.env.activationId()}),true);
await secondClient.env.pause(media);secondClient.env.select('test','111');
assert.equal(client().config.ONE_C_API_BASE_URL,firstClient.config.ONE_C_API_BASE_URL,'returning to test must preserve old queue namespace');

const notifications=[],handlers={};let workerState={environment:'production',activationId:'current',enabled:true};
const indexedDB={open(){const request={};queueMicrotask(()=>{
  request.result={transaction(){return {objectStore(){return {get(){const read={};queueMicrotask(()=>{read.result=workerState;read.onsuccess();});return read;}};}};},close(){}};
  request.onsuccess();
});return request;}};
vm.runInNewContext(readFileSync(new URL('../notification-sw.js',import.meta.url),'utf8'),{URL,self:{indexedDB,addEventListener:(name,fn)=>handlers[name]=fn,registration:{scope:'https://imax.example/',showNotification:async(...args)=>notifications.push(args)},clients:{matchAll:async()=>[]}}});
async function deliver(data){let pending;handlers.push({data:{json:()=>({title:'Synthetic',data})},waitUntil:p=>pending=p});await pending;}
await deliver({environment:'test',activationId:'current'});await deliver({environment:'production',activationId:'old'});await deliver({});assert.equal(notifications.length,0);
await deliver({environment:'production',activationId:'current'});assert.equal(notifications.length,1);
workerState={...workerState,enabled:false};await deliver({environment:'production',activationId:'current'});assert.equal(notifications.length,1);
console.log('Environment client and Service Worker: distinct caches/auth, full restart, paused and stale Push suppression passed');
const appSource=readFileSync(new URL('../assets/app.js',import.meta.url),'utf8');
const unsubscribeSource=appSource.slice(appSource.indexOf('  async function unregisterWebPush('),appSource.indexOf('  async function startNativePush('));
let removed=0,unregistered=0;
const subscription={unsubscribe:async()=>{removed++;}};
const unsubscribeContext=vm.createContext({webPushRegistered:true,navigator:{serviceWorker:{getRegistration:async()=>({pushManager:{getSubscription:async()=>subscription}})}},URL,document:{baseURI:'https://imax.example/'},state:{userId:'111'},call1C:async()=>{unregistered++;},pushPayload:()=>({}),console});
vm.runInContext(unsubscribeSource,unsubscribeContext);
await vm.runInContext('unregisterWebPush({destroy:false})',unsubscribeContext);assert.equal(unregistered,1);assert.equal(removed,0,'switch retains subscription for automatic binding in the selected database');
await vm.runInContext('unregisterWebPush()',unsubscribeContext);assert.equal(removed,1,'logout destroys the subscription');
