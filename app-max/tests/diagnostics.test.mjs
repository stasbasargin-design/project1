import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createDiagnostics,hashDiagnosticPassword,diagnosticDeviceStatus} from '../diagnostics-server.mjs';

const directory=await mkdtemp(join(tmpdir(),'imax-diagnostics-')),password='Synthetic-fixture-password-288';
const env={DIAGNOSTICS_STATE_DIR:join(directory,'unit'),DIAGNOSTICS_ADMIN_USER:'test-admin',DIAGNOSTICS_ADMIN_PASSWORD_HASH:await hashDiagnosticPassword(password),DIAGNOSTICS_INGEST_SECRET:'synthetic-ingest-key-'.repeat(3)};
let now=Date.now();const diag=createDiagnostics({env,clock:()=>now});await diag.initialization;
const auth={userId:'111',maxUserId:'111'},reply={success:true,data:{user:{name:'Synthetic <script> person',employeeRef:'employee-111',maxUserId:'111'}}};
const token=diag.mint(auth,reply,'production');assert.ok(token);const identity=diag.owner(token,'production');
assert.equal(identity.userId,'111');assert.throws(()=>diag.owner(token,'test'),{status:401});assert.throws(()=>diag.owner(token+'tampered','production'),{status:401});
assert.equal(diag.mint(auth,{success:false},'production'),null);assert.equal(diag.mint(auth,{success:true,data:{user:{name:'Other',maxUserId:'222'}}},'production'),null);
const installationId=randomUUID(),event={id:randomUUID(),kind:'api-error',at:new Date(now).toISOString(),route:'/worktime/packages/list',status:422,code:'VALIDATION_ERROR',message:'NEVER_STORE_MESSAGE',token:'NEVER_STORE_TOKEN',text:'NEVER_STORE_CHAT',fileName:'NEVER_STORE_FILE'};
const payload={installationId,platform:'android',browser:'WebView',os:'Android 16',version:'i-max-2.8.8',userId:'FORGED_USER',name:'FORGED_NAME',environment:'test',ready:true,visibility:'visible',lastRequest:{route:'/worktime/packages/list',status:422,ok:false,code:'VALIDATION_ERROR'},lastSuccess:{route:'/orders/list',status:200,ok:true},queue:{pending:3,failed:1},events:[event]};
await diag.ingest(identity,payload);await diag.ingest(identity,payload);
const fakeResponse=()=>({headers:{},setHeader(k,v){this.headers[k]=v;},writeHead(){},end(){}});
const basic='Basic '+Buffer.from('test-admin:'+password).toString('base64');
let answer;
const context={environment:'production',basePath:'/p/max-service',json:(res,status,data)=>{answer={status,data,headers:res.headers};},servePanel:()=>{},allowOrigin:()=>{}};
await diag.handle({method:'GET',headers:{authorization:basic},socket:{remoteAddress:'127.0.0.1'}},fakeResponse(),'/diagnostics/api/devices',context);
assert.equal(answer.status,200);const row=answer.data.data.devices[0];assert.equal(row.userId,'111');assert.equal(row.environment,'production');assert.equal(row.errorCount,1);assert.equal(row.status,'operation-error');assert.equal(row.queue.pending,3);assert.notEqual(row.name,'FORGED_NAME');
await diag.handle({method:'GET',headers:{authorization:basic},socket:{remoteAddress:'127.0.0.1'}},fakeResponse(),'/diagnostics/api/devices/'+row.id,context);
const serialized=JSON.stringify(answer);for(const forbidden of ['NEVER_STORE_','FORGED_USER','FORGED_NAME','installationId','"seen"'])assert.equal(serialized.includes(forbidden),false,forbidden);
assert.equal(answer.data.data.events.length,1);
assert.equal(diagnosticDeviceStatus({...row,visibility:'hidden'},now),'background');assert.equal(diagnosticDeviceStatus(row,now+121000),'no-signal');assert.equal(diagnosticDeviceStatus({...row,uiBlocked:true},now),'app-error');
await diag.ingest(identity,{...payload,platform:'web',events:[]});
const testToken=diag.mint(auth,reply,'test');await diag.ingest(diag.owner(testToken,'test'),{...payload,events:[]});
await diag.handle({method:'GET',headers:{authorization:basic},socket:{remoteAddress:'127.0.0.1'}},fakeResponse(),'/diagnostics/api/devices',context);assert.equal(answer.data.data.devices.length,3,'same employee has independent devices/contours');
for(const authorization of [undefined,'Bearer '+token,'Basic '+Buffer.from('test-admin:wrong').toString('base64')]){
 await diag.handle({method:'GET',headers:{authorization},socket:{remoteAddress:'127.0.0.1'}},fakeResponse(),'/diagnostics/api/devices',context);assert.equal(answer.status,401);
}
await diag.close();const restored=createDiagnostics({env,clock:()=>now});await restored.initialization;
await restored.handle({method:'GET',headers:{authorization:basic},socket:{remoteAddress:'127.0.0.1'}},fakeResponse(),'/diagnostics/api/devices',context);assert.equal(answer.data.data.devices.length,3);await restored.close();

const calls=[];
const upstream=createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);calls.push(req.url);res.setHeader('Content-Type','application/json');if(req.url==='/auth/max')res.end(JSON.stringify({success:true,data:{user:{employeeRef:'synthetic',name:'Synthetic person',maxUserId:body.userId}}}));else if(req.url==='/orders/get')res.end(JSON.stringify({success:false,error:{code:'VALIDATION_ERROR',message:'PRIVATE_ERROR_CONTENT'}}));else if(req.url==='/orders/list')res.end(JSON.stringify({success:true,data:{orders:[],padding:'x'.repeat(200000)}}));else res.end(JSON.stringify({success:true,data:{}}));});
await new Promise(r=>upstream.listen(0,'127.0.0.1',r));
const child=spawn(process.execPath,[fileURLToPath(new URL('../server.mjs',import.meta.url))],{env:{...process.env,...env,DIAGNOSTICS_STATE_DIR:join(directory,'http'),PORT:'18388',LISTEN_HOST:'127.0.0.1',APP_BASE_PATH:'/p/max-service',ONE_C_TARGET:'http://127.0.0.1:'+upstream.address().port,ONE_C_PRODUCTION_TARGET:'http://127.0.0.1:'+upstream.address().port+'/production',LOG_PROXY_REQUESTS:'false',MEDIA_BUFFER_ENABLED:'false'},stdio:['ignore','pipe','pipe']});
let logs='';child.stdout.on('data',x=>logs+=x);child.stderr.on('data',x=>logs+=x);
const base='http://127.0.0.1:18388/p/max-service';
const get=async(path,authorization)=>fetch(base+path,{headers:authorization?{Authorization:authorization}:{}});
const post=async(path,body,headers={})=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
try{
 for(let n=0;n<200;n++){try{if((await get('/health')).ok)break;}catch{}await new Promise(r=>setTimeout(r,50));}
 for(let n=0;n<100;n++){const response=await get('/diagnostics/');if(response.status===401)break;await new Promise(r=>setTimeout(r,30));}
 for(const path of ['/diagnostics/','/diagnostics.html','/diagnostics/api/devices']){const response=await get(path);assert.equal(response.status,401,path);assert.match(response.headers.get('www-authenticate'),/Basic/);assert.equal(response.headers.get('cache-control'),'no-store');}
 const page=await get('/diagnostics/',basic);assert.equal(page.status,200);assert.match(page.headers.get('content-security-policy'),/frame-ancestors 'none'/);assert.equal(page.headers.get('cache-control'),'no-store');
 const login=await post('/api/1c/auth/max',{userId:'111',maxUserId:'111'},{Origin:'capacitor://localhost'});assert.equal(login.status,200);const scoped=login.headers.get('x-itus-diagnostics-token');assert.ok(scoped);assert.match(login.headers.get('access-control-expose-headers'),/X-ITUS-Diagnostics-Token/);assert.equal((await login.json()).success,true);
 assert.equal((await post('/api/diagnostics/events',payload)).status,401);
 assert.equal((await post('/contours/production/api/diagnostics/events',payload,{'X-ITUS-Diagnostics-Token':scoped})).status,401);
 const preflight=await fetch(base+'/api/diagnostics/events',{method:'OPTIONS',headers:{Origin:'capacitor://localhost'}});assert.equal(preflight.status,204);assert.match(preflight.headers.get('access-control-allow-headers'),/X-ITUS-Diagnostics-Token/);
 assert.equal((await post('/api/diagnostics/events',payload,{'X-ITUS-Diagnostics-Token':scoped,Origin:'capacitor://localhost'})).status,200);
 assert.equal((await get('/diagnostics/api/devices','Bearer '+scoped)).status,401);
 const badBusiness=await post('/api/1c/orders/get',{userId:'111'});assert.equal(badBusiness.status,200);assert.equal((await badBusiness.json()).success,false);
 const large=await post('/api/1c/orders/list',{userId:'111'});assert.equal((await large.json()).data.padding.length,200000,'observer never truncates business JSON');
 const data=await(await get('/diagnostics/api/devices',basic)).json();assert.equal(data.data.devices.length,1);assert.ok(data.data.server.errors.some(e=>e.status===200&&e.code==='VALIDATION_ERROR'));assert.equal(JSON.stringify(data).includes('PRIVATE_ERROR_CONTENT'),false);
 const oversized=await post('/api/diagnostics/events',{...payload,padding:'x'.repeat(30000)},{'X-ITUS-Diagnostics-Token':scoped});assert.equal(oversized.status,413);assert.equal((await get('/health')).status,200);
 for(let n=0;n<5;n++)await get('/diagnostics/api/devices','Basic '+Buffer.from('test-admin:wrong').toString('base64'));
 assert.equal((await get('/diagnostics/api/devices',basic)).status,429,'brute force limited');
 console.log('Diagnostics: admin-only access, scoped ingest, contour/device isolation, deduplication, sanitization, persistence, CORS, unchanged streaming, JSON failures and bounded body passed');
}finally{child.kill();await new Promise(r=>upstream.close(r));await rm(directory,{recursive:true,force:true});}
