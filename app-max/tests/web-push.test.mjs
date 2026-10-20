import assert from 'node:assert/strict';
import {createECDH, randomBytes} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import webpush from 'web-push';
import {deliverWebPush, validateSubscription} from '../web-push.mjs';

const vapid = webpush.generateVAPIDKeys();
const env = {WEB_PUSH_VAPID_PUBLIC_KEY:vapid.publicKey,WEB_PUSH_VAPID_PRIVATE_KEY:vapid.privateKey,WEB_PUSH_VAPID_SUBJECT:'mailto:offline@example.com'};
const ecdh = createECDH('prime256v1'); ecdh.generateKeys();
const subscription = {endpoint:'https://web.push.apple.com/test',keys:{p256dh:ecdh.getPublicKey().toString('base64url'),auth:randomBytes(16).toString('base64url')}};
for (const endpoint of ['http://web.push.apple.com/test','https://127.0.0.1/test','https://web.push.apple.com.evil.test/test','https://user:pass@web.push.apple.com/test','https://web.push.apple.com:8080/test']) assert.throws(()=>validateSubscription({...subscription,endpoint}));
assert.throws(()=>validateSubscription({...subscription,keys:{p256dh:'bad',auth:'bad'}}));
assert.equal(validateSubscription(subscription).endpoint,subscription.endpoint);
await assert.rejects(()=>deliverWebPush([subscription],{}, {env:{}}),/WEB_PUSH_NOT_CONFIGURED/);
await assert.rejects(()=>deliverWebPush([subscription,subscription],{}, {env}),/DUPLICATE/);
await assert.rejects(()=>deliverWebPush([subscription],{body:'я'.repeat(4000)}, {env}),/PAYLOAD_TOO_LARGE/);
let requestDetails;
const result = await deliverWebPush([subscription,{...subscription,endpoint:'https://fcm.googleapis.com/test'}], {title:'I-MAX',body:'Тест',data:{type:'new_messages',topicRef:'topic'}}, {
  env,
  send: async (value,payload,options) => {
    // Real library validates keys and encrypts data; no provider network request.
    requestDetails = webpush.generateRequestDetails(value,payload,options);
    assert.equal(requestDetails.headers['Content-Encoding'],'aes128gcm');
    assert.ok(requestDetails.body.length > 0);
    if (value.endpoint.includes('googleapis')) throw {statusCode:410,body:'sensitive provider response'};
  }
});
assert.equal(result.sent,1); assert.equal(result.failed,1);
assert.deepEqual(result.invalidSubscriptionIndexes,[1]);
assert.doesNotMatch(JSON.stringify(result),/sensitive|endpoint|privateKey/);
for (const status of [429,503,401]) {
  const result = await deliverWebPush([subscription],{}, {env,send:async()=>{throw {statusCode:status};}});
  assert.deepEqual(result.retryableSubscriptionIndexes,status===401?[]:[0]);
}

// Exercise public config, internal auth, and unchanged Android endpoint over HTTP.
const child = spawn(process.execPath,[fileURLToPath(new URL('../server.mjs',import.meta.url))], {
  env:{...process.env,...env,PORT:'18096',APP_BASE_PATH:'/p/max-service',PUSH_INTERNAL_TOKEN:'offline-only',GOOGLE_APPLICATION_CREDENTIALS:''},stdio:['ignore','pipe','pipe']
});
try {
  await new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(Error('Startup timeout')),10000);
    child.stdout.on('data',chunk=>{if(String(chunk).includes('ИТУС запущен')){clearTimeout(timeout);resolve();}});
    child.once('exit',()=>{clearTimeout(timeout);reject(Error('Server exited'));});
  });
  const base='http://127.0.0.1:18096/p/max-service';
  let response=await fetch(base+'/api/push/web/config');
  const config=await response.json();
  assert.equal(config.data.publicKey,vapid.publicKey);
  assert.equal(config.data.enabled,true);
  assert.ok(!JSON.stringify(config).includes(vapid.privateKey));
  response=await fetch(base+'/manifest.webmanifest');
  assert.equal(response.status,200);
  assert.match(response.headers.get('content-type'),/application\/manifest\+json/);
  assert.equal((await response.json()).display,'standalone');
  response=await fetch(base+'/api/push/web/dispatch',{method:'POST',body:'{}'}); assert.equal(response.status,401);
  const post=body=>({method:'POST',headers:{Authorization:'Bearer offline-only','Content-Type':'application/json'},body:JSON.stringify(body)});
  response=await fetch(base+'/api/push/web/dispatch',post({body:'test',subscriptions:[{...subscription,endpoint:'https://127.0.0.1/test'}]})); assert.equal(response.status,400);
  response=await fetch(base+'/api/push/dispatch',post({tokens:['offline'],body:'Android'}));
  assert.equal(response.status,503); assert.equal((await response.json()).error.code,'FIREBASE_NOT_CONFIGURED');
} finally { child.kill(); }

// Execute Service Worker, including cold launch and rejection of external URL injection.
const handlers={}, notifications=[],opened=[];
const scope='https://example.com/p/max-service/';
vm.runInNewContext(readFileSync(new URL('../notification-sw.js',import.meta.url),'utf8'), {
  URL,self:{addEventListener:(type,fn)=>handlers[type]=fn,registration:{scope,showNotification:async(title,options)=>notifications.push({title,options})},clients:{matchAll:async()=>[],openWindow:async url=>opened.push(url)}}
});
let pending;
handlers.push({data:{json:()=>({title:'Test',body:'Text',data:{eventId:'e1',type:'new_messages',topicRef:'t1',url:'https://evil.test'}})},waitUntil:p=>pending=p});
await pending;
assert.equal(notifications[0].options.tag,'imax:e1');
assert.equal(new URL(notifications[0].options.data.url).searchParams.get('topicRef'),'t1');
handlers.notificationclick({notification:{close(){},data:notifications[0].options.data},waitUntil:p=>pending=p}); await pending;
assert.equal(new URL(opened[0]).origin,'https://example.com');
handlers.notificationclick({notification:{close(){},data:{url:'https://evil.test/'}},waitUntil:p=>pending=p}); await pending;
assert.equal(opened[1],scope);

// Permission is requested in the click's synchronous turn, before any await/network.
const order=[];
const clientRoot={isSecureContext:true,Notification:{permission:'default',requestPermission:()=>{order.push('permission');return Promise.resolve('granted');}},PushManager:{},matchMedia:()=>({matches:false})};
const fakeSubscription={options:{},toJSON:()=>subscription};
const registration={pushManager:{getSubscription:async()=>null,subscribe:async options=>{assert.equal(options.userVisibleOnly,true);order.push('subscribe');return fakeSubscription;}}};
const navigator={userAgent:'Yandex Windows',platform:'Win32',serviceWorker:{register:async()=>registration,ready:Promise.resolve(registration)}};
const context={window:clientRoot,navigator,document:{baseURI:scope},URL,Uint8Array,AbortController,setTimeout,clearTimeout,atob:value=>Buffer.from(value,'base64').toString('binary'),fetch:async()=>({ok:true,json:async()=>({data:{enabled:true,publicKey:vapid.publicKey}})})};
vm.runInNewContext(readFileSync(new URL('../assets/web-push-client.js',import.meta.url),'utf8'),context);
await clientRoot.ITUS_WEB_PUSH.prepare();
const subscribed=clientRoot.ITUS_WEB_PUSH.subscribe();
assert.deepEqual(order,['permission']); await subscribed;
assert.deepEqual(order,['permission','subscribe']);
navigator.userAgent='iPhone'; navigator.standalone=false;
assert.match(clientRoot.ITUS_WEB_PUSH.reason(),/На экран/);
await assert.rejects(()=>clientRoot.ITUS_WEB_PUSH.subscribe(),/На экран/);
navigator.standalone=true; assert.equal(clientRoot.ITUS_WEB_PUSH.reason(),'');
clientRoot.Notification.permission='denied'; assert.match(clientRoot.ITUS_WEB_PUSH.reason(),/запрещены/);

// Regression: native bridge and Android notification channel/resources are not replaced by Web Push.
const appSource=readFileSync(new URL('../assets/app.js',import.meta.url),'utf8');
assert.match(appSource,/if \(!window\.ITUS_NATIVE_PUSH\?\.supported\?\.\(\)\)/);
assert.match(appSource,/window\.ITUS_NATIVE_PUSH\?\.supported\?\.\(\) \|\| !window\.ITUS_WEB_PUSH/);
console.log('Web Push: real encryption, auth, config secrecy, SSRF validation, expiry/retries, SW routing and gesture permission OK (offline).');
