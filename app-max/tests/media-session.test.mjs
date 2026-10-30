import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createServer} from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {webcrypto} from 'node:crypto';
import {MediaStore} from '../media-store.mjs';
import {createMediaService} from '../media-service.mjs';
const folder=await mkdtemp(join(tmpdir(),'imax-media-session-'));
const calls=[];
const upstream=createServer(async(req,res)=>{
 const chunks=[];for await(const chunk of req)chunks.push(chunk);const data=JSON.parse(Buffer.concat(chunks));calls.push({url:req.url,data});res.setHeader('Content-Type','application/json');
 assert.equal(req.headers['x-itus-request-id'],data.requestId);
 if(data.userId==='999'){res.writeHead(403);return res.end(JSON.stringify({success:false,error:{code:'DENIED'}}));}
 if(data.userId==='888')return res.end(JSON.stringify({success:true,data:{}}));
 if(data.userId==='777')return res.end(JSON.stringify({success:true,data:{user:{name:'Wrong identity',maxUserId:'123'}}}));
 if(data.userId==='666')return res.end(JSON.stringify({success:true,data:{user:{name:'Disabled',active:false}}}));
 return res.end(JSON.stringify({success:true,data:[{user:[{employeeRef:'synthetic-'+data.userId,name:'Synthetic employee',maxUserId:data.userId}]},{availableTabs:['orders']}]}));
});await new Promise(r=>upstream.listen(0,'127.0.0.1',r));
const service=createMediaService({env:{MEDIA_BUFFER_ENABLED:'true',MEDIA_STATE_DIR:folder,MEDIA_CONTEXT:'test',MEDIA_S3_BUCKET:'private',MEDIA_S3_ACCESS_KEY:'test',MEDIA_S3_SECRET_KEY:'test',ONE_C_TARGET:`http://127.0.0.1:${upstream.address().port}`},upstreamHeaders:()=>({'Content-Type':'application/json'}),json:(res,status,body)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(body));},s3Factory:async()=>({})});await service.init();
const server=createServer(async(req,res)=>{await service.handle(req,res,req.url);});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}/api`,store=new MediaStore(folder);
let user='111',generation=0,connections=0,held=false,started,release;const records=new Map();
const storage={getItem:key=>records.get(key)||null,setItem:(key,value)=>records.set(key,value),removeItem:key=>records.delete(key)};
const context=vm.createContext({localStorage:storage,Date,JSON,AbortController,DOMException,setTimeout,clearTimeout,
 fetch:async(url,options)=>{if(String(url).endsWith('/session')){connections++;if(held){started?.();await new Promise(r=>release=r);}}return fetch(url,options);}});context.window=context;
vm.runInContext(fs.readFileSync(new URL('../assets/media-buffer.js',import.meta.url),'utf8'),context);
const makeClient=()=>{const captured=generation;return context.ITUS_MEDIA_BUFFER.create({base:base+'/1c',userId:()=>user,auth:()=>({userId:user,maxUserId:user,authId:user,max:{userId:user},authMode:'manual',version:'i-max-2.8.2'}),guard:()=>{if(captured!==generation)throw Object.assign(Error('Session changed'),{queuePaused:true,code:'SESSION_CHANGED'});}});};
async function post(body){const r=await fetch(base+'/media/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,data:await r.json()};}
try{
 const config=await(await fetch(base+'/media/config')).json();assert.equal(config.data.pairingRequired,false);assert.equal(config.data.automaticSession,true);
 for(const [id,status] of [['999',403],['888',403],['777',403],['666',403],['',401]]){const result=await post({userId:id});assert.equal(result.status,status);assert.equal(result.data.data?.token,undefined);}
 const before=calls.length;assert.equal((await post({userId:'111',maxUserId:'222'})).status,403);assert.equal(calls.length,before,'identity mismatch must be rejected before 1C');
 const client=makeClient();await Promise.all([client.connect(),client.connect(),client.connect()]);assert.equal(connections,1);assert.equal(client.connected(),true);
 const first=JSON.parse([...records.values()][0]);assert.equal((await store.authenticate(first.token)).userId,'111');await client.connect();assert.equal(connections,1,'valid credential reused');
 await store.remove('devices',(await store.authenticate(first.token)).device);const status=await client.request('/device');assert.equal(status.userId,'111');assert.equal(connections,2,'revoked credential transparently replaced');
 const fresh=JSON.parse([...records.values()][0]);await store.put('devices',(await store.authenticate(fresh.token)).device,{userId:'111',expires:Date.now()-1});await client.request('/device');assert.equal(connections,3,'expired server session refreshed');
 await client.revoke();assert.equal(records.size,0);assert.equal(client.connected(),false);
 held=true;const launched=new Promise(r=>started=r),stale=client.connect(),rejected=assert.rejects(stale,error=>error.code==='SESSION_CHANGED');await launched;generation++;user='222';release();await rejected;assert.equal(records.size,0,'old login response must not save a new-user credential');held=false;
 const other=makeClient();await other.connect();assert.equal((await other.request('/device')).userId,'222');assert.ok([...records.keys()].every(x=>x.endsWith(':222')));
 const scoped=context.ITUS_MEDIA_BUFFER.create({base:base+'/other/api/1c',userId:()=>user,storage,auth:()=>({userId:user})});assert.equal(scoped.connected(),false,'another API contour must not reuse token');
 assert.ok(calls.some(x=>x.url==='/auth/max'),'server independently confirms employee in 1C');
 const source=fs.readFileSync(new URL('../assets/app.js',import.meta.url),'utf8');assert.ok(!source.includes('mediaDeviceCode'));assert.ok(!source.includes('media-device-pair'));assert.ok(source.includes('mediaClient(session)?.connect()'));
 // Exercise the delivered app, including direct small-file renewal. Its
 // requestId/clientEntryId and wire body must survive the renewal unchanged.
 const fixtureUrl=new URL('./acceptance-regression.test.mjs',import.meta.url);
 let fixture=fs.readFileSync(fixtureUrl,'utf8').split('const app=context.testApp;')[0].replace(/^import .*;\r?\n/gm,'').replaceAll('import.meta.url',JSON.stringify(fixtureUrl.href));
 fixture=fixture.replace('firstMainView};','firstMainView,setAuth,call1C};');
 const scenario=`const app=context.testApp;app.setAuth('111','manual');let currentToken='old',renewals=0;context.ITUS_MEDIA_BUFFER={create:()=>({connected:()=>true,headers:()=>({'X-ITUS-Device':currentToken}),connect:async(options)=>{if(options?.force){renewals++;currentToken='fresh';}}})};const sent=[];context.fetch=async(url,options)=>{sent.push({body:options.body,header:{...options.headers}});return {ok:sent.length>1,status:sent.length>1?200:401,text:async()=>JSON.stringify(sent.length>1?{success:true,data:{saved:true}}:{success:false,error:{code:'DEVICE_REQUIRED'}})};};await app.call1C('/defects/entries/add',{documentRef:'test-doc',clientEntryId:'same-entry',entry:{type:'text',text:'synthetic'}},{requestId:'same-request',timestamp:'2026-10-30T00:00:00Z',envelopeContext:{}});assert.equal(renewals,1);assert.equal(sent.length,2);assert.equal(sent[0].body,sent[1].body);assert.equal(sent[0].header['X-ITUS-Request-Id'],sent[1].header['X-ITUS-Request-Id']);assert.equal(sent[1].header['X-ITUS-Device'],'fresh');`;
 await new (Object.getPrototypeOf(async function(){}).constructor)('assert','fs','vm','webcrypto',fixture+scenario)(assert,fs,vm,webcrypto);
 console.log('Automatic media session: server-side 1C verification, no code UI, single-flight, renewal/revocation, stale-login guard and employee/contour isolation passed');
}finally{service.close();await Promise.all([new Promise(r=>server.close(r)),new Promise(r=>upstream.close(r))]);await rm(folder,{recursive:true,force:true});}
