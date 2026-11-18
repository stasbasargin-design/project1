import assert from 'node:assert/strict';import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {createServer} from 'node:http';import {spawn} from 'node:child_process';import {fileURLToPath} from 'node:url';
const folder=mkdtempSync(join(tmpdir(),'imax-preferences-http-')),calls=[];
const upstream=createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);calls.push({route:req.url,body});let data={};
  if(req.url==='/auth/max')data={user:{name:'Synthetic',employeeRef:'employee-'+body.userId}};
  if(req.url==='/clients/topics/list')data={topics:[{topicRef:'allowed'}]};
  if(req.url==='/internal-chat/groups/list')data={groups:[{groupRef:'allowed'}]};
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify({success:true,data}));});await new Promise(r=>upstream.listen(0,'127.0.0.1',r));
const child=spawn(process.execPath,[fileURLToPath(new URL('../server.mjs',import.meta.url))],{env:{...process.env,PORT:'18392',LISTEN_HOST:'127.0.0.1',APP_BASE_PATH:'/p/max-service',ONE_C_TARGET:'http://127.0.0.1:'+upstream.address().port,ONE_C_TOKEN:'offline',LOG_PROXY_REQUESTS:'false',MEDIA_BUFFER_ENABLED:'true',MEDIA_STATE_DIR:join(folder,'media'),MEDIA_CONTEXT:'test',MEDIA_S3_BUCKET:'offline',MEDIA_S3_ACCESS_KEY:'offline',MEDIA_S3_SECRET_KEY:'offline',PUSH_INSTALLATIONS_DIR:join(folder,'push'),PUSH_INTERNAL_TOKEN:'offline',GOOGLE_APPLICATION_CREDENTIALS:''},stdio:['ignore','pipe','pipe']});let logs='';child.stderr.on('data',b=>logs+=b);
const base='http://127.0.0.1:18392/p/max-service';
async function call(path,body,token){const response=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{'X-ITUS-Device':token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:response.status,data:await response.json()};}
try{
  await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error(logs||'Server startup timeout')),12000);child.stdout.on('data',b=>{if(String(b).includes('ИТУС запущен')){clearTimeout(timeout);resolve();}});child.once('exit',()=>{clearTimeout(timeout);reject(Error(logs));});});
  // Listening does not mean asynchronous media-store initialization finished.
  // Wait for readiness, then still require the unauthenticated request to fail.
  let mediaReady=false;
  for(let attempt=0;attempt<100;attempt++){
    const config=await call('/api/media/config');
    if(config.status===200&&config.data.data?.enabled===true){mediaReady=true;break;}
    await new Promise(resolve=>setTimeout(resolve,50));
  }
  assert.equal(mediaReady,true,logs||'Synthetic media service did not become ready');
  assert.equal((await call('/api/push/chat-preferences')).status,401);
  const session=(await call('/api/media/session',{userId:'111',maxUserId:'111',authId:'111',authMode:'manual'})).data.data;
  const token=session.token;assert.ok(token);
  assert.deepEqual((await call('/api/push/chat-preferences',undefined,token)).data.data.muted,[]);
  assert.equal((await call('/api/push/chat-preferences',{source:'clients',ref:'forbidden',muted:true},token)).status,403);
  assert.equal((await call('/api/push/chat-preferences',{source:'clients',ref:'allowed',muted:'true'},token)).status,400);
  assert.equal((await call('/api/push/chat-preferences',{source:'clients',ref:'allowed',muted:true,userId:'222'},token)).status,200);
  assert.deepEqual((await call('/api/push/chat-preferences',undefined,token)).data.data.muted,[{source:'clients',ref:'allowed'}]);
  assert.equal(calls.find(x=>x.route==='/clients/topics/list').body.userId,'111','owner is taken from authenticated device, not posted userId');
  const installation={platform:'android',clientInstanceId:'synthetic-installation',token:'synthetic-token'};
  const row=(await call('/api/push/installation',{...installation,action:'begin'},token)).data.data;
  assert.equal((await call('/api/push/installation',{...installation,action:'bind',activationId:row.activationId},token)).status,200);
  const dispatch=async data=>{const r=await fetch(base+'/api/push/dispatch',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer offline'},body:JSON.stringify({tokens:['synthetic-token'],body:'Synthetic',data})});return {status:r.status,data:await r.json()};};
  const muted=await dispatch({type:'new_messages',topicRef:'allowed'});assert.equal(muted.status,200);assert.equal(muted.data.data.sent,0);assert.equal(muted.data.data.skipped,1);
  assert.equal((await dispatch({type:'executor_assigned',orderRef:'allowed'})).status,503,'non-chat events still reach the unchanged FCM sender (unconfigured in this fixture)');
  const subscription={endpoint:'https://fcm.googleapis.com/fcm/send/synthetic-never-send',keys:{p256dh:Buffer.concat([Buffer.from([4]),Buffer.alloc(64,1)]).toString('base64url'),auth:Buffer.alloc(16,1).toString('base64url')}};
  const web={platform:'web',clientInstanceId:'synthetic-web-installation',subscription};
  const webRow=(await call('/api/push/installation',{...web,action:'begin'},token)).data.data;
  assert.equal((await call('/api/push/installation',{...web,action:'bind',activationId:webRow.activationId},token)).status,200);
  const response=await fetch(base+'/api/push/web/dispatch',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer offline'},body:JSON.stringify({subscriptions:[subscription],body:'Synthetic',data:{type:'new_messages',topicRef:'allowed'}})});
  assert.equal(response.status,200);const filtered=await response.json();assert.equal(filtered.data.skipped,1);assert.equal(filtered.data.sent,0,'muted Web Push never reaches provider');
  await call('/api/push/chat-preferences',{source:'clients',ref:'allowed',muted:false},token);
  assert.equal((await dispatch({type:'new_messages',topicRef:'allowed'})).status,503,'unmuting restores normal FCM path');
  assert.ok(calls.every(x=>['/auth/max','/clients/topics/list','/internal-chat/groups/list'].includes(x.route)),'no 1C document/message writes');
  console.log('Chat preferences HTTP: authenticated owner, membership checks, server-owned persistence, FCM/Web filtering before delivery, unrelated events and unmute passed.');
}finally{child.kill();upstream.closeAllConnections();upstream.close();rmSync(folder,{recursive:true,force:true});}
