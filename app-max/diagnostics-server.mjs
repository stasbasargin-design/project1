import {createHash,createHmac,randomBytes,scrypt,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
import {mkdir,readFile,readdir,writeFile,rename,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {Transform,Readable} from 'node:stream';
import './assets/api-normalizers.js';

const derive=promisify(scrypt),DAY=86400000;
const hash=value=>createHash('sha256').update(value).digest('hex');
const equal=(a,b)=>{const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);};
const failure=(code,status)=>Object.assign(Error(code),{code,status});
const numeric=(value,max)=>Math.max(0,Math.min(max,Math.round(Number(value)||0)));
const safeCode=value=>/^[A-Z][A-Z0-9_/-]{0,63}$/.test(String(value||''))?String(value):'APPLICATION_ERROR';
export function diagnosticRoute(value){
 const route=String(value||'').split('?')[0];
 return /^\/(?:auth|orders|notifications|internal-chat|clients|defects|acceptance|worktime|workshop|quality|checklists|posts|executors|service)(?:\/[a-z][a-z0-9-]{0,30}){1,3}$/.test(route)?route:'/other';
}
export async function hashDiagnosticPassword(password){const salt=randomBytes(16).toString('base64url');const key=await derive(password,salt,32);return `scrypt$${salt}$${key.toString('base64url')}`;}
async function verifyPassword(password,encoded){
 const [kind,salt,value,...extra]=String(encoded||'').split('$');
 if(kind!=='scrypt'||extra.length||!/^[-\w]{20,30}$/.test(salt||'')||!/^[-\w]{43}$/.test(value||'')||password.length>200)return false;
 return equal((await derive(password,salt,32)).toString('base64url'),value);
}
const codeOf=error=>safeCode(error?.code||error?.cause?.code||'PROXY_ERROR');
function networkFields(value={}){
 const type=x=>['wifi','cellular','ethernet','none','unknown'].includes(x)?x:'unknown';
 return {network:type(value.network),networkFrom:value.networkFrom?type(value.networkFrom):'',networkValidated:typeof value.networkValidated==='boolean'?value.networkValidated:null,networkMetered:typeof value.networkMetered==='boolean'?value.networkMetered:null,networkVpn:value.networkVpn===true,transport:['native','webview'].includes(value.transport)?value.transport:''};
}
function boundedTime(value,now){const time=Date.parse(value);return new Date(Number.isFinite(time)&&time>=now-7*DAY&&time<=now+60000?time:now).toISOString();}
function requestSummary(value,now){if(!value||typeof value!=='object')return null;return {route:diagnosticRoute(value.route),status:numeric(value.status,599),ok:value.ok===true,code:value.ok===true?'':safeCode(value.code),durationMs:numeric(value.durationMs,1200000),at:boundedTime(value.at,now),...networkFields(value)};}
function eventSummary(value,now){
 if(!value||!/^[-a-f0-9]{32,36}$/i.test(value.id||''))return null;
 const kinds=['api-error','network-error','app-error','resource-error','offline','online','background','foreground','logout','network-change','recovery'];
 if(!kinds.includes(value.kind))return null;
 return {id:value.id,kind:value.kind,at:boundedTime(value.at,now),route:diagnosticRoute(value.route),status:numeric(value.status,599),code:safeCode(value.code),durationMs:numeric(value.durationMs,1200000),file:/^[a-zA-Z0-9_.-]{1,80}\.js$/.test(value.file||'')?value.file:'',line:numeric(value.line,1000000),...networkFields(value),visibility:value.visibility==='hidden'?'hidden':'visible'};
}
export function diagnosticDeviceStatus(record,now=Date.now()){
 const age=now-Date.parse(record.lastSeen);
 if(age>120000)return 'no-signal';
 if(record.signedOut)return 'signed-out';
  if(record.visibility==='hidden')return 'background';
 if(record.uiBlocked)return 'app-error';
 if(record.recovering)return 'recovering';
 if(record.pending?.some(value=>value.elapsedMs+Math.max(0,age)>15000))return 'waiting';
 const failed=(record.routes||[]).find(value=>value.ok===false&&now-Date.parse(value.at)<900000);
 if(failed)return failed.status>0?'operation-error':'network-error';
 if(record.lastRequest?.ok===false)return record.lastRequest.status>0?'operation-error':'network-error';
 return record.ready?'online':'starting';
}
export function diagnosticDeviceView(record,now=Date.now()){
 const {seen,events=[],...row}=record;
 return {...row,status:diagnosticDeviceStatus(record,now),recentErrorCount:events.filter(e=>e.kind.endsWith('error')&&now-Date.parse(e.at)<900000).length,lastError:[...events].reverse().find(e=>e.kind.endsWith('error'))||null};
}

export function createDiagnostics({env=process.env,clock=Date.now}={}){
 const configured=Boolean(env.DIAGNOSTICS_STATE_DIR&&env.DIAGNOSTICS_ADMIN_USER&&env.DIAGNOSTICS_ADMIN_PASSWORD_HASH&&String(env.DIAGNOSTICS_INGEST_SECRET||'').length>=32);
 const devices=new Map(),locks=new Map(),attempts=new Map(),rates=new Map(),serverMinutes=new Map(),serverErrors=[];
 let ready=false,activeIngest=0,activeLogin=0,saveTimer=null,lastPrune=0,closed=false;
 const directory=env.DIAGNOSTICS_STATE_DIR,secret=env.DIAGNOSTICS_INGEST_SECRET;
 async function atomic(file,value){const temp=file+'.'+randomBytes(6).toString('hex')+'.tmp';await writeFile(temp,JSON.stringify(value),{mode:0o600});try{await rename(temp,file);}finally{await unlink(temp).catch(()=>{});}}
 const initialization=configured?(async()=>{
  await mkdir(join(directory,'devices'),{recursive:true,mode:0o700});
  const names=(await readdir(join(directory,'devices'))).filter(n=>/^[a-f0-9]{64}\.json$/.test(n));
  for(let offset=0;offset<names.length;offset+=16)await Promise.all(names.slice(offset,offset+16).map(async name=>{
   try{const row=JSON.parse(await readFile(join(directory,'devices',name),'utf8'));if(clock()-Date.parse(row.lastSeen)<30*DAY&&devices.size<2000)devices.set(name.slice(0,-5),row);else await unlink(join(directory,'devices',name));}catch{}
  }));
  try{const saved=JSON.parse(await readFile(join(directory,'server.json'),'utf8'));for(const row of saved.minutes||[])if(row.minute>clock()-3600000)serverMinutes.set(row.key,row);serverErrors.push(...(saved.errors||[]).slice(-100));}catch{}
  ready=true;
 })().catch(()=>{console.error('Diagnostics storage unavailable');}):Promise.resolve();
 const sign=payload=>{const body=Buffer.from(JSON.stringify(payload)).toString('base64url');return body+'.'+createHmac('sha256',secret).update(body).digest('base64url');};
 function owner(token,environment){
  if(!configured)throw failure('DIAGNOSTICS_DISABLED',503);
  const [body,signature,...extra]=String(token||'').split('.');
  if(extra.length||!body||!signature||body.length>1500||!equal(createHmac('sha256',secret).update(body).digest('base64url'),signature))throw failure('DIAGNOSTICS_UNAUTHORIZED',401);
  let value;try{value=JSON.parse(Buffer.from(body,'base64url'));}catch{throw failure('DIAGNOSTICS_UNAUTHORIZED',401);}
  if(value.kind!=='diagnostics-ingest'||value.environment!==environment||value.exp<clock()||value.exp>clock()+31*DAY||!/^\d{1,30}$/.test(value.userId||''))throw failure('DIAGNOSTICS_UNAUTHORIZED',401);
  return value;
 }
 function mint(auth,reply,environment){
  if(!ready||reply?.success!==true||reply.authorized===false)return null;
  const userId=String(auth?.userId||'');if(!/^\d{1,30}$/.test(userId)||['maxUserId','authId'].some(key=>auth[key]&&String(auth[key])!==userId))return null;
  const data=Array.isArray(reply.data)?Object.assign({},...reply.data.filter(x=>x&&typeof x==='object'&&!Array.isArray(x))):reply.data||{};
  if(data.authorized===false)return null;
  const identity=[reply.user,data.user,data.profile,data.employee,reply.employee,data,reply].map(globalThis.ITUS_API.normalizeUser).find(x=>x&&(x.employeeRef||x.userRef||x.name));
  if(!identity||identity.authorized===false||identity.active===false||['maxUserId','authId'].some(key=>identity[key]&&String(identity[key])!==userId))return null;
  return sign({kind:'diagnostics-ingest',userId,name:String(identity.name||'Сотрудник').replace(/[\u0000-\u001f]/g,'').slice(0,100),environment,exp:clock()+30*DAY});
 }
 async function authResponse(upstream,body,environment){
  const stream=Readable.fromWeb(upstream.body),iterator=stream[Symbol.asyncIterator](),chunks=[];let size=0;
  for(;;){const next=await iterator.next();if(next.done)break;chunks.push(next.value);size+=next.value.length;if(size>128*1024)return {body:Readable.from((async function*(){yield* chunks;for(;;){const part=await iterator.next();if(part.done)break;yield part.value;}})()),token:null};}
  let token=null;try{token=mint(JSON.parse(body.toString('utf8')),JSON.parse(Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/,'')),environment);}catch{}
  return {body:Readable.from(chunks),token};
 }
 function observer(){let chunks=[],size=0;return {stream:new Transform({transform(chunk,_encoding,callback){size+=chunk.length;if(size<=16384)chunks.push(Buffer.from(chunk));else chunks=[];callback(null,chunk);}}),result(){if(!chunks.length)return {};try{const data=JSON.parse(Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/,''));return {applicationSuccess:data.success,code:safeCode(data.error?.code)};}catch{return {code:'BAD_JSON'};}}};}
 function observe(environment,route,status,ms,outcome={}){
  if(!ready||closed)return;
  const now=clock(),minute=Math.floor(now/60000)*60000,key=environment+'|'+minute;
  const row=serverMinutes.get(key)||{key,minute,environment,count:0,failed:0,applicationErrors:0,totalMs:0,maxMs:0};
  row.count++;row.failed+=status>=500;row.applicationErrors+=outcome.applicationSuccess===false;row.totalMs+=numeric(ms,1200000);row.maxMs=Math.max(row.maxMs,numeric(ms,1200000));serverMinutes.set(key,row);
  for(const [k,value] of serverMinutes)if(value.minute<now-3600000)serverMinutes.delete(k);
  if(status>=400||outcome.applicationSuccess===false){serverErrors.push({at:new Date(now).toISOString(),environment,route:diagnosticRoute(route),status:numeric(status,599),code:safeCode(outcome.code),durationMs:numeric(ms,1200000)});if(serverErrors.length>100)serverErrors.shift();}
  if(!saveTimer){saveTimer=setTimeout(()=>{saveTimer=null;void atomic(join(directory,'server.json'),{minutes:[...serverMinutes.values()],errors:serverErrors}).catch(()=>{});},5000);saveTimer.unref?.();}
 }
 async function locked(key,fn){const previous=locks.get(key)||Promise.resolve();const job=previous.catch(()=>{}).then(fn);locks.set(key,job);try{return await job;}finally{if(locks.get(key)===job)locks.delete(key);}}
 async function ingest(identity,input){
  if(!ready)throw failure('DIAGNOSTICS_DISABLED',503);
  if(!/^[-a-f0-9]{32,36}$/i.test(input?.installationId||'')||!['web','android'].includes(input.platform)||!Array.isArray(input.events)||input.events.length>20)throw failure('DIAGNOSTICS_INVALID',400);
  const key=hash(identity.environment+'|'+identity.userId+'|'+input.platform+'|'+input.installationId),now=clock();
  const rate=rates.get(key)||{at:now,count:0};if(now-rate.at>60000){rate.at=now;rate.count=0;}rate.count++;rates.set(key,rate);if(rates.size>3000)rates.delete(rates.keys().next().value);
  if(rate.count>30||activeIngest>=4)throw failure('DIAGNOSTICS_RATE_LIMIT',429);
  activeIngest++;
  try{return await locked(key,async()=>{
   if(!devices.has(key)&&devices.size>=2000)throw failure('DIAGNOSTICS_CAPACITY',503);
   const old=devices.get(key)||{events:[],seen:[],errorCount:0};
   const events=input.events.map(event=>eventSummary(event,now)).filter(Boolean),seen=new Set(old.seen||[]),fresh=events.filter(event=>{if(seen.has(event.id))return false;seen.add(event.id);return true;});
   const record={id:key,userId:identity.userId,name:identity.name,environment:identity.environment,platform:input.platform,browser:['Yandex','Safari','Chrome','Edge','WebView','Other'].includes(input.browser)?input.browser:'Other',os:/^(Android|iOS|Windows|macOS|Linux)( \d{1,2})?$/.test(input.os||'')?input.os:'',version:/^(?:i-max-)?\d+\.\d+\.\d+(?:-[a-z0-9-]+)?$/.test(input.version||'')?input.version:'unknown',build:/^[a-f0-9]{40}$/i.test(input.build||'')?input.build:'',lastSeen:new Date(now).toISOString(),visibility:input.visibility==='hidden'?'hidden':'visible',ready:input.ready===true,uiBlocked:input.uiBlocked===true,signedOut:input.signedOut===true,...networkFields(input),recovering:input.recovering===true,routes:Array.isArray(input.routes)?input.routes.slice(-16).map(x=>requestSummary(x,now)).filter(Boolean):[],pending:Array.isArray(input.pending)?input.pending.slice(-8).map(x=>({route:diagnosticRoute(x.route),elapsedMs:numeric(x.elapsedMs,1200000),...networkFields(x)})):[],queue:{pending:numeric(input.queue?.pending,100000),failed:numeric(input.queue?.failed,100000)},lastRequest:requestSummary(input.lastRequest,now)||old.lastRequest||null,lastSuccess:requestSummary(input.lastSuccess,now)||old.lastSuccess||null,errorCount:(old.errorCount||0)+fresh.filter(e=>e.kind.endsWith('error')).length,events:[...(old.events||[]),...fresh].slice(-50),seen:[...seen].slice(-256)};
   await atomic(join(directory,'devices',key+'.json'),record);devices.set(key,record);
   if(now-lastPrune>3600000){lastPrune=now;for(const [id,row] of devices)if(now-Date.parse(row.lastSeen)>30*DAY){devices.delete(id);void unlink(join(directory,'devices',id+'.json')).catch(()=>{});}}
   return {accepted:events.map(e=>e.id),serverTime:record.lastSeen};
  });}finally{activeIngest--;}
 }
 async function admin(req,res){
  const ip=req.socket.remoteAddress||'local',now=clock(),rate=attempts.get(ip)||{at:now,count:0};if(now-rate.at>900000){rate.at=now;rate.count=0;}
  if(rate.count>=5||activeLogin>=4){res.setHeader('Retry-After','900');throw failure('DIAGNOSTICS_LOGIN_LIMIT',429);}
  const match=String(req.headers.authorization||'').match(/^Basic ([A-Za-z0-9+/=]{1,600})$/);let valid=false;
  if(match){activeLogin++;try{const plain=Buffer.from(match[1],'base64').toString('utf8'),split=plain.indexOf(':');valid=split>0&&equal(plain.slice(0,split),env.DIAGNOSTICS_ADMIN_USER)&&await verifyPassword(plain.slice(split+1),env.DIAGNOSTICS_ADMIN_PASSWORD_HASH);}finally{activeLogin--;}}
  if(!valid){if(match){rate.count++;attempts.set(ip,rate);if(attempts.size>2000)attempts.delete(attempts.keys().next().value);}res.setHeader('WWW-Authenticate','Basic realm="I-MAX diagnostics", charset="UTF-8"');throw failure('DIAGNOSTICS_ADMIN_REQUIRED',401);}
  attempts.delete(ip);
 }
 async function body(req){let length=0,chunks=[];for await(const chunk of req){length+=chunk.length;if(length>24576)throw failure('DIAGNOSTICS_TOO_LARGE',413);chunks.push(chunk);}try{return JSON.parse(Buffer.concat(chunks));}catch{throw failure('DIAGNOSTICS_INVALID',400);}}
 async function handle(req,res,path,{environment,basePath,json,servePanel,allowOrigin}){
  if(path!=='/api/diagnostics/events'&&path!=='/diagnostics'&&path!=='/diagnostics.html'&&!path.startsWith('/diagnostics/'))return false;
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
  try{
   if(!ready)throw failure('DIAGNOSTICS_DISABLED',503);
   if(path==='/api/diagnostics/events'){
    allowOrigin(req,res);res.setHeader('Access-Control-Allow-Headers','Content-Type, X-ITUS-Diagnostics-Token');
    if(req.method==='OPTIONS'){res.writeHead(204);res.end();return true;}
    if(req.method!=='POST')throw failure('METHOD_NOT_ALLOWED',405);
    const identity=owner(req.headers['x-itus-diagnostics-token'],environment);const data=await ingest(identity,await body(req));json(res,200,{success:true,data});return true;
   }
   if(req.method!=='GET'&&req.method!=='HEAD')throw failure('METHOD_NOT_ALLOWED',405);
   await admin(req,res);
   res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
   if(path==='/diagnostics'){res.writeHead(308,{Location:(basePath==='/'?'':basePath)+'/diagnostics/'});res.end();return true;}
   if(path==='/diagnostics/'||path==='/diagnostics.html'){servePanel(req,res);return true;}
   if(path==='/diagnostics/api/devices'){
    const rows=[...devices.values()].map(row=>diagnosticDeviceView(row,clock()));
    json(res,200,{success:true,data:{devices:rows,server:{minutes:[...serverMinutes.values()],errors:serverErrors},now:new Date(clock()).toISOString(),retentionDays:30}});return true;
   }
   const detail=path.match(/^\/diagnostics\/api\/devices\/([a-f0-9]{64})$/);
   if(detail&&devices.has(detail[1])){const record=devices.get(detail[1]);json(res,200,{success:true,data:{...diagnosticDeviceView(record,clock()),events:record.events}});return true;}
   throw failure('NOT_FOUND',404);
  }catch(error){json(res,error.status||503,{success:false,error:{code:error.status?error.code:'DIAGNOSTICS_UNAVAILABLE'}});return true;}
 }
 return {initialization,get enabled(){return ready;},mint,authResponse,observer,observe,ingest,owner,handle,codeOf,async close(){closed=true;if(saveTimer)clearTimeout(saveTimer);await Promise.allSettled([...locks.values()]);}};
}
