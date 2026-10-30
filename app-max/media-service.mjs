import './assets/api-normalizers.js';
import {MediaStore,digest,mediaError,assertMediaIdentity} from './media-store.mjs';
import {MediaJobs,DIRECT_FILE_BYTES} from './media-jobs.mjs';
import {createMediaS3} from './media-s3.mjs';
import {Transform} from 'node:stream';
import {randomUUID} from 'node:crypto';
import {MediaDownloads} from './media-downloads.mjs';
import {WriteLedger,WRITE_ROUTES} from './write-ledger.mjs';

async function limitedJson(stream,limit=256*1024){const chunks=[];let size=0;for await(const chunk of stream){size+=chunk.length;if(size>limit)throw mediaError('Запрос слишком велик',413);chunks.push(Buffer.from(chunk));}try{return JSON.parse(Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/,''));}catch(error){if(error.status)throw error;throw mediaError('Нужен JSON');}}
export function createMediaService({env=process.env,upstreamHeaders,json,log=()=>{},s3Factory=createMediaS3}){
  const enabled=env.MEDIA_BUFFER_ENABLED==='true';
  let store,jobs,downloads,ledger,ready=false,initializing,timer,cleanupTimer;
  const pairingAttempts=new Map();
  const sessionAttempts=new Map();let sessionChecks=0;
  const target=String(env.ONE_C_TARGET||'').replace(/\/+$/,'');
  const scope=digest([env.MEDIA_CONTEXT||'',target].join('|')).slice(0,24);
  async function read(route,envelope){
    const requestId=randomUUID();
    const response=await fetch(target+route,{method:'POST',headers:{...upstreamHeaders(),'x-itus-request-id':requestId},body:JSON.stringify({...envelope,requestId}),signal:AbortSignal.timeout(35000)});
    const data=await limitedJson(response.body,2*1024*1024);
    if(response.status!==200||data.success===false)throw mediaError('Не удалось подтвердить права на объект',403,'MEDIA_ACCESS_DENIED');return data;
  }
  async function authorize(userId,route,envelope){
    const identity={userId,maxUserId:userId,authId:userId,authMode:envelope.authMode||'manual',source:'ITUS_MAX',max:envelope.max||{},miniApp:'ITUS',version:envelope.version};
    if(route.startsWith('/defects/')||route.startsWith('/acceptance/')){
      const data=await read('/orders/get',{...identity,orderRef:envelope.orderRef,orderId:envelope.orderRef});
      const order=globalThis.ITUS_API.mapOrder(data.order||data.data?.order||data.data||data);
      if(String(order.orderRef||order.id)!==String(envelope.orderRef))throw mediaError('Заказ-наряд недоступен',403,'MEDIA_ACCESS_DENIED');
      const refs=[order.defectDocumentRef,order.acceptanceDocumentRef,order._acceptance?.documentRef].filter(Boolean).map(String);
      if(route==='/defects/start'&&String(order.defectDocumentRef)!==String(envelope.documentRef))throw mediaError('Нет подтверждения существующего документа',403,'MEDIA_DOCUMENT_MISMATCH');
      if(refs.length&&!refs.includes(String(envelope.documentRef)))throw mediaError('Документ не принадлежит заказ-наряду',403,'MEDIA_DOCUMENT_MISMATCH');
    }else{
      const clients=route.startsWith('/clients/'),data=await read(clients?'/clients/topics/list':'/internal-chat/groups/list',{...identity,limit:1000});
      const items=globalThis.ITUS_API.extractItems(data,clients?['topics']:['groups']);
      const ref=String(clients?envelope.topicRef:envelope.groupRef);
      if(!items.some(x=>String(x.topicRef||x.groupRef||x.ref||x.id)===ref))throw mediaError('Нет доступа к переписке',403,'MEDIA_ACCESS_DENIED');
    }
  }
  async function init(){
    if(!enabled)return;
    if(initializing)return initializing;
    initializing=(async()=>{
      for(const key of ['MEDIA_STATE_DIR','MEDIA_CONTEXT','MEDIA_S3_BUCKET','MEDIA_S3_ACCESS_KEY','MEDIA_S3_SECRET_KEY','ONE_C_TARGET'])if(!env[key])throw Error('Missing media configuration: '+key);
      if(!['test','production'].includes(env.MEDIA_CONTEXT))throw Error('Invalid media context');
      store=new MediaStore(env.MEDIA_STATE_DIR);await store.init();
      ledger=new WriteLedger({store,scope});
      const s3=await s3Factory(env);
      downloads=new MediaDownloads({authorize,fetchAttachment:(route,envelope)=>fetch(target+route,{method:'POST',headers:{...upstreamHeaders(),'x-itus-request-id':envelope.requestId},body:JSON.stringify({...envelope,includeAttachmentContent:true}),signal:AbortSignal.timeout(20*60*1000)})});
      jobs=new MediaJobs({store,s3,scope,authorize,capacityBytes:Number(env.MEDIA_BUFFER_CAPACITY_BYTES)||50*1024**3,log,
        send:(route,{body,byteLength,requestId,envelope,manual})=>ledger.run(String(envelope.userId),route,envelope,()=>fetch(target+route,{method:'POST',headers:{...upstreamHeaders(),'Content-Length':String(byteLength),'x-itus-request-id':requestId},body,...(typeof body==='string'?{}:{duplex:'half'}),signal:AbortSignal.timeout(Number(env.MEDIA_IMPORT_TIMEOUT_MS)||20*60*1000)}),{manual})});
      await jobs.recover();ready=true;
      timer=setInterval(()=>jobs.wake(),1000);timer.unref();
      cleanupTimer=setInterval(()=>void Promise.all([jobs.cleanup(),downloads.cleanup()]).catch(error=>log({event:'cleanup-error',code:error.code||error.name})),60000);cleanupTimer.unref();
    })();
    return initializing;
  }
  const token=req=>String(req.headers['x-itus-device']||'');
  async function automaticSession(req){
    const envelope=await limitedJson(req,32*1024),userId=String(envelope.userId||'');
    if(!/^\d{1,30}$/.test(userId))throw mediaError('Требуется вход в приложение',401,'MEDIA_AUTH_REQUIRED');
    assertMediaIdentity(userId,envelope);
    const row=sessionAttempts.get(userId)||{count:0,start:Date.now()};
    if(Date.now()-row.start>15*60*1000){row.count=0;row.start=Date.now();}
    if(row.count>=20)throw mediaError('Подключение файлов временно ограничено. Повторите позже.',429,'MEDIA_SESSION_RATE_LIMIT');
    if(sessionChecks>=16)throw mediaError('Подключение файлов занято. Повторите позже.',503,'MEDIA_SESSION_BUSY');
    row.count++;sessionAttempts.set(userId,row);if(sessionAttempts.size>20000)sessionAttempts.delete(sessionAttempts.keys().next().value);
    sessionChecks++;
    try{
      // This retains the application's existing ID-based 1C access model.
      // A client assertion of a successful login never grants a media session.
      const auth=await read('/auth/max',envelope);
      const data=Array.isArray(auth.data)?Object.assign({},...auth.data.filter(x=>x&&typeof x==='object'&&!Array.isArray(x))):(auth.data||{});
      const candidates=[auth.user,data.user,data.profile,data.employee,auth.employee,data,auth].map(globalThis.ITUS_API.normalizeUser).filter(Boolean);
      const identity=candidates.find(x=>x.employeeRef||x.userRef||x.name);
      if(!identity||auth.authorized===false||data.authorized===false||identity.authorized===false||identity.active===false)throw mediaError('1С не подтвердила доступ сотрудника',403,'MEDIA_AUTH_REJECTED');
      for(const field of ['maxUserId','authId'])if(identity[field]&&String(identity[field])!==userId)throw mediaError('Ответ 1С относится к другому сотруднику',403,'MEDIA_AUTH_MISMATCH');
      return store.issueDevice(userId);
    }finally{sessionChecks--;}
  }
  async function device(req){if(!enabled||!ready)throw mediaError('Буфер файлов пока не подключён',503,'MEDIA_NOT_CONFIGURED');return store.authenticate(token(req));}
  async function handle(req,res,path){
    if(!path.startsWith('/api/media/'))return false;
    try{
      if(req.method==='OPTIONS'){res.writeHead(204);res.end();return true;}
      if(path==='/api/media/config'&&req.method==='GET'){json(res,200,{success:true,data:{enabled:enabled&&ready,thresholdBytes:DIRECT_FILE_BYTES,pairingRequired:false,automaticSession:true}});return true;}
      if(!enabled||!ready)throw mediaError('Буфер файлов пока не подключён',503,'MEDIA_NOT_CONFIGURED');
      if(path==='/api/media/session'&&req.method==='POST'){json(res,200,{success:true,data:await automaticSession(req)});return true;}
      const download=path.match(/^\/api\/media\/download\/([a-f0-9]{48})$/);
      if(download&&['GET','HEAD'].includes(req.method)){downloads.serve(req,res,download[1]);return true;}
      if(path==='/api/media/pair'&&req.method==='POST'){
        const ip=req.socket.remoteAddress||'',row=pairingAttempts.get(ip)||{count:0,start:Date.now()};
        if(Date.now()-row.start>15*60*1000){row.count=0;row.start=Date.now();}row.count++;pairingAttempts.set(ip,row);
        if(pairingAttempts.size>2000)pairingAttempts.delete(pairingAttempts.keys().next().value);
        if(row.count>20)throw mediaError('Слишком много попыток. Повторите позже.',429,'PAIR_RATE_LIMIT');
        const input=await limitedJson(req,4096),result=await store.redeem(String(input.userId||''),input.code);json(res,200,{success:true,data:result});return true;
      }
      const owner=await device(req);
      if(path==='/api/media/attachment'&&req.method==='POST'){
        const input=await limitedJson(req);
        assertMediaIdentity(owner.userId,input.envelope);
        const result=await downloads.prepare(owner.userId,input.route,input.envelope,Number(input.expectedBytes)||0);json(res,200,{success:true,data:result});return true;
      }
      if(path==='/api/media/device'&&req.method==='GET'){json(res,200,{success:true,data:{userId:owner.userId,expires:owner.expires}});return true;}
      if(path==='/api/media/device/revoke'&&req.method==='POST'){await store.remove('devices',owner.device);json(res,200,{success:true});return true;}
      if(path==='/api/media/jobs'&&req.method==='POST'){
        const input=await limitedJson(req);const job=await jobs.create(owner.userId,input.route,input.envelope,{complete:input.complete===true,dependencies:input.dependencies||[]});json(res,200,{success:true,data:job});return true;
      }
      const chunk=path.match(/^\/api\/media\/jobs\/([a-f0-9]{64})\/chunk\/(\d{1,5})$/);
      if(chunk&&req.method==='POST'){
        const size=Number(req.headers['content-length']),controller=new AbortController();let received=0;
        const stream=new Transform({transform(data,_encoding,callback){received+=data.length;if(received>size)callback(mediaError('Размер части превышен'));else callback(null,data);}});
        const abort=()=>controller.abort();req.once('aborted',abort);req.pipe(stream);
        try{await jobs.uploadPart(owner.userId,chunk[1],Number(chunk[2]),size,stream,controller.signal);if(received!==size)throw mediaError('Неполная часть файла');json(res,200,{success:true});}
        finally{req.off('aborted',abort);req.unpipe(stream);stream.destroy();}
        return true;
      }
      const match=path.match(/^\/api\/media\/jobs\/([a-f0-9]{64})(?:\/(parts|sign|uploaded|retry|file))?$/);
      if(!match)throw mediaError('Маршрут не найден',404);
      const [,id,action]=match;
      let data;
      if(!action&&req.method==='GET')data=jobs.view(await jobs.owned(owner.userId,id));
      else if(action==='parts'&&req.method==='GET')data=await jobs.parts(owner.userId,id);
      else if(action==='sign'&&req.method==='POST'){const input=await limitedJson(req,4096);if(env.MEDIA_UPLOAD_MODE==='direct')data={url:await jobs.sign(owner.userId,id,input.number)};else{await jobs.owned(owner.userId,id);data={relay:true,path:'/jobs/'+id+'/chunk/'+input.number};}}
      else if(action==='uploaded'&&req.method==='POST')data=await jobs.uploaded(owner.userId,id);
      else if(action==='retry'&&req.method==='POST')data=await jobs.retry(owner.userId,id);
      else if(action==='file'&&req.method==='POST'){
        const job=await jobs.owned(owner.userId,id);
        if(job.state!=='confirmed'||job.kind!=='file'||job.bufferRemoved)throw mediaError('Откройте файл из истории 1С',410,'BUFFER_EXPIRED');
        data={url:await jobs.s3.readUrl(job.key)};
      }else throw mediaError('Метод не поддерживается',405);
      json(res,200,{success:true,data});
    }catch(error){if(!res.headersSent)json(res,error.status||502,{success:false,error:{code:error.code||'MEDIA_SERVICE_ERROR',message:error.status&&error.status<500?error.message:'Не удалось выполнить операцию с буфером файлов'}});}
    return true;
  }
  return {init,handle,device,
    async write(route,envelope,send,options){
      if(!enabled||!WRITE_ROUTES.has(route)||!/^\d{1,30}$/.test(String(envelope?.userId||'')))return send();
      if(!ready)throw mediaError('Журнал отправки пока недоступен',503,'WRITE_LEDGER_NOT_READY');
      const response=await ledger.run(String(envelope.userId),route,envelope,send,options);
      if(response.status===200){const raw=await response.clone().text();const data=raw.trim()?JSON.parse(raw):{success:true};if(data.success!==false)await jobs.receipt(String(envelope.userId),envelope,data,route);}
      return response;
    },
    async receipt(owner,envelope,response){if(owner&&jobs)await jobs.receipt(owner.userId,envelope,response);},close(){jobs&&(jobs.stopped=true);clearInterval(timer);clearInterval(cleanupTimer);}};
}
