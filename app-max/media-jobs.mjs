import {Readable} from 'node:stream';
import {digest,mediaError,assertMediaIdentity} from './media-store.mjs';

export const DIRECT_FILE_BYTES=10*1024*1024;
export const FILE_ROUTES=new Set(['/defects/entries/add','/clients/files/send','/internal-chat/files/send']);
const COMPLETE_ROUTES=new Set(['/acceptance/complete','/defects/complete']);
export const fileOf=body=>body?.entry?.file||body?.file;
const stable=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item);
const now=()=>new Date().toISOString();
const terminal=new Set(['confirmed','invalid','failed','uncertain']);
const responseLimit=512*1024;
const safeCode=value=>String(value||'ONE_C_ERROR').replace(/[^\w/.-]/g,'').slice(0,100);

// Base64 is generated in bounded chunks only on the worker. Neither the browser
// nor Node constructs a second full-size representation of a buffered file.
export function base64Envelope(envelope,stream){
  const body=structuredClone(envelope),file=fileOf(body),marker='ITUS_FILE_BODY_'+digest(body.requestId);
  file.contentBase64=marker;delete file.transport;
  const json=JSON.stringify(body),needle=JSON.stringify(marker),index=json.indexOf(needle);
  const prefix=Buffer.from(json.slice(0,index)+'"'),suffix=Buffer.from('"'+json.slice(index+needle.length));
  let bytes=0;
  return {byteLength:prefix.length+4*Math.ceil(file.sizeBytes/3)+suffix.length,
    body:Readable.from((async function*(){
      let carry=Buffer.alloc(0);yield prefix;
      for await(const chunk of stream){const buffer=Buffer.from(chunk);bytes+=buffer.length;if(bytes>file.sizeBytes)throw mediaError('Размер буфера не совпадает',409,'MEDIA_SIZE_CHANGED');const value=carry.length?Buffer.concat([carry,buffer]):buffer;const length=value.length-value.length%3;if(length)yield value.subarray(0,length).toString('base64');carry=Buffer.from(value.subarray(length));}
      if(bytes!==file.sizeBytes)throw mediaError('Файл в буфере неполный',409,'MEDIA_SIZE_CHANGED');
      if(carry.length)yield carry.toString('base64');yield suffix;
    })())};
}

export class MediaJobs {
  constructor({store,s3,scope,send,authorize,capacityBytes=50*1024**3,log=()=>{}}){Object.assign(this,{store,s3,scope,send,authorize,capacityBytes,log});this.active=false;this.stopped=false;}
  id(userId,requestId){return digest(this.scope+'|'+userId+'|'+requestId);}
  async owned(userId,id){const job=await this.store.get('jobs',id);if(!job||job.userId!==userId||job.scope!==this.scope)throw mediaError('Отправка не найдена',404,'MEDIA_NOT_FOUND');return job;}
  view(job){return {id:job.id,state:job.state,attempts:job.attempts,requestId:job.envelope.requestId,sizeBytes:fileOf(job.envelope)?.sizeBytes||0,partSize:job.partSize,error:job.error||null,response:job.state==='confirmed'?job.response:undefined,updatedAt:job.updatedAt};}
  async save(job){job.updatedAt=now();await this.store.put('jobs',job.id,job);return job;}
  validate(userId,route,envelope,complete){
    assertMediaIdentity(userId,envelope);
    if(!(complete?COMPLETE_ROUTES:FILE_ROUTES).has(route))throw mediaError('Метод недоступен для фоновой отправки');
    if(!/^[\w:-]{8,160}$/.test(envelope?.requestId||'')||String(envelope.userId)!==userId)throw mediaError('Пользователь или requestId не совпадает',403,'MEDIA_OWNER_MISMATCH');
    for(const field of ['maxUserId','authId'])if(envelope[field]&&String(envelope[field])!==userId)throw mediaError('Пользователь не совпадает',403,'MEDIA_OWNER_MISMATCH');
    if(envelope.max?.userId&&String(envelope.max.userId)!==userId)throw mediaError('Пользователь не совпадает',403,'MEDIA_OWNER_MISMATCH');
    if(Buffer.byteLength(JSON.stringify(envelope))>256*1024)throw mediaError('Слишком большой заголовок');
    if(complete){if(!envelope.documentRef||!envelope.orderRef)throw mediaError('Не указан документ');return;}
    const file=fileOf(envelope);
    if(!file||!Number.isSafeInteger(file.sizeBytes)||file.sizeBytes<=DIRECT_FILE_BYTES||file.sizeBytes>5*1024**4||file.contentBlob||file.contentBase64)throw mediaError('Неверные метаданные файла');
    if(!file.fileName||String(file.fileName).length>255||!/^[\w.+-]+\/[\w.+-]+$/.test(file.mimeType||''))throw mediaError('Неверное имя или тип файла');
    if(route==='/defects/entries/add'&&(!envelope.documentRef||!envelope.clientEntryId||!envelope.orderRef))throw mediaError('Не указан документ или clientEntryId');
    if(route!=='/defects/entries/add'&&(!envelope.clientMessageId||!(envelope.topicRef||envelope.groupRef)))throw mediaError('Не указаны чат или clientMessageId');
  }
  async create(userId,route,envelope,{complete=false,dependencies=[]}={}){
    this.validate(userId,route,envelope,complete);
    const id=this.id(userId,envelope.requestId),signature=digest(stable({route,envelope}));
    return this.store.locked('create-capacity',()=>this.store.locked(id,async()=>{
      let job=await this.store.get('jobs',id);
      if(job){if(job.signature!==signature)throw mediaError('requestId уже связан с другим содержимым',409,'MEDIA_ID_CONFLICT');if(job.state!=='creating')return this.view(job);}
      else{
        await this.authorize(userId,route,envelope);
        const all=await this.store.list('jobs'),pending=all.filter(x=>x.scope===this.scope&&x.state!=='confirmed');
        if(pending.filter(x=>x.userId===userId).length>=50||pending.length>=500)throw mediaError('Слишком много незавершённых отправок',429,'MEDIA_QUEUE_FULL');
        const size=fileOf(envelope)?.sizeBytes||0;
        if(size+all.filter(x=>x.scope===this.scope&&x.kind==='file'&&!x.bufferRemoved).reduce((n,x)=>n+(fileOf(x.envelope)?.sizeBytes||0),0)>this.capacityBytes)throw mediaError('Буфер заполнен: пакет остаётся на устройстве',507,'MEDIA_BUFFER_FULL');
        if(!Array.isArray(dependencies)||dependencies.length>1000||dependencies.some(x=>typeof x!=='string'||!/^[\w:-]{8,160}$/.test(x)))throw mediaError('Неверные зависимости пакета');
        job={id,scope:this.scope,userId,route,envelope,signature,kind:complete?'complete':'file',dependencies:[...new Set(dependencies)],state:complete?'ready':'creating',attempts:0,createdAt:now(),updatedAt:now(),partSize:Math.max(8*1024*1024,Math.ceil(size/10000/1024/1024)*1024*1024),key:`imax-buffer/${this.scope}/${id}`,nextAt:0};
        await this.save(job);
      }
      if(!complete){job.uploadId=await this.s3.create(job.key,fileOf(envelope).mimeType);job.state='uploading';await this.save(job);}
      this.wake();return this.view(job);
    }));
  }
  async parts(userId,id){return this.store.locked(id,async()=>{const job=await this.owned(userId,id);if(job.state!=='uploading')return [];await this.save(job);return (await this.s3.parts(job.key,job.uploadId)).map(({PartNumber,Size,ETag})=>({number:PartNumber,size:Size,etag:ETag}));});}
  async sign(userId,id,number){const job=await this.owned(userId,id),size=fileOf(job.envelope).sizeBytes,count=Math.ceil(size/job.partSize);if(job.state!=='uploading'||!Number.isInteger(number)||number<1||number>count)throw mediaError('Неверная часть файла');return this.s3.sign(job.key,job.uploadId,number,Math.min(job.partSize,size-(number-1)*job.partSize));}
  async uploadPart(userId,id,number,size,stream,signal){
    return this.store.locked(id,async()=>{
    const job=await this.owned(userId,id),total=fileOf(job.envelope).sizeBytes,count=Math.ceil(total/job.partSize),expected=Math.min(job.partSize,total-(number-1)*job.partSize);
    if(job.state!=='uploading'||!Number.isInteger(number)||number<1||number>count||size!==expected)throw mediaError('Неверные размер или номер части');
    const result=await this.s3.upload(job.key,job.uploadId,number,expected,stream,signal);await this.save(job);return result;
    });
  }
  async uploaded(userId,id){return this.store.locked(id,async()=>{
    const job=await this.owned(userId,id);if(job.state!=='uploading')return this.view(job);
    const size=fileOf(job.envelope).sizeBytes,count=Math.ceil(size/job.partSize);
    try{
      const parts=(await this.s3.parts(job.key,job.uploadId)).sort((a,b)=>a.PartNumber-b.PartNumber);
      if(parts.length!==count||parts.some((part,index)=>part.PartNumber!==index+1||part.Size!==Math.min(job.partSize,size-index*job.partSize)))throw mediaError('В буфере ещё не все части',409,'MEDIA_INCOMPLETE');
      await this.s3.complete(job.key,job.uploadId,parts);
    }catch(error){if(!['NoSuchUpload','NotFound'].includes(error.name))throw error;}
    const head=await this.s3.head(job.key);if(Number(head.ContentLength)!==size)throw mediaError('Размер буфера не совпадает',409,'MEDIA_INCOMPLETE');
    job.state='ready';await this.save(job);this.wake();return this.view(job);
  });}
  async receipt(userId,envelope,response,route=''){if(!envelope?.requestId)return;await this.store.put('receipts',this.id(userId,envelope.requestId),{scope:this.scope,userId,requestId:envelope.requestId,documentRef:envelope.documentRef||'',signature:route?digest(stable({route,envelope})):'',confirmedAt:now(),response});this.wake();}
  async dependenciesReady(job){for(const requestId of job.dependencies){const receipt=await this.store.get('receipts',this.id(job.userId,requestId));if(!receipt||receipt.userId!==job.userId||receipt.scope!==job.scope||receipt.documentRef!==job.envelope.documentRef)return false;}return true;}
  async retry(userId,id){return this.store.locked(id,async()=>{const job=await this.owned(userId,id);if(['invalid','uncertain'].includes(job.state))throw mediaError('Требуется сверка в 1С по requestId',409,'MEDIA_RECONCILIATION_REQUIRED');if(job.state==='failed'){if(job.error?.code==='UPLOAD_EXPIRED'){job.uploadId=await this.s3.create(job.key,fileOf(job.envelope).mimeType);job.bufferRemoved=false;job.state='uploading';}else job.state='ready';job.attempts=0;job.error=null;await this.save(job);this.wake();}return this.view(job);});}
  async recover(){for(const job of await this.store.list('jobs'))if(job.scope===this.scope&&job.state==='importing'){const receipt=await this.store.get('receipts',job.id);if(receipt?.signature===job.signature){job.state='confirmed';job.response=receipt.response;job.confirmedAt=receipt.confirmedAt;}else job.state=job.attempts>=5?'uncertain':'ready';await this.save(job);}this.wake();}
  wake(){if(this.active||this.stopped)return;this.active=true;void this.drain().catch(error=>this.log({event:'worker-error',code:safeCode(error.code||error.name)})).finally(()=>{this.active=false;});}
  async drain(){
    while(!this.stopped){
      const all=await this.store.list('jobs');let selected;
      for(const job of all.filter(x=>x.scope===this.scope&&x.state==='ready'&&x.nextAt<=Date.now()).sort((a,b)=>a.createdAt.localeCompare(b.createdAt))){if(job.kind==='complete'&&!await this.dependenciesReady(job))continue;selected=job;break;}
      if(!selected)return;
      await this.store.locked(selected.id,async()=>{
        const job=await this.store.get('jobs',selected.id);if(job.state!=='ready')return;
        job.state='importing';job.attempts++;await this.save(job);
        let stream;
        try{
          await this.authorize(job.userId,job.route,job.envelope);
          let body=JSON.stringify(job.envelope),byteLength=Buffer.byteLength(body);
          if(job.kind==='file'){const head=await this.s3.head(job.key);if(Number(head.ContentLength)!==fileOf(job.envelope).sizeBytes)throw mediaError('Размер файла изменился',409,'MEDIA_SIZE_CHANGED');stream=await this.s3.read(job.key);({body,byteLength}=base64Envelope(job.envelope,stream));}
          const response=await this.send(job.route,{body,byteLength,requestId:job.envelope.requestId});
          const chunks=[];let length=0;
          for await(const chunk of response.body){length+=chunk.length;if(length>responseLimit)throw mediaError('Ответ 1С слишком велик',502,'ONE_C_RESPONSE_LIMIT');chunks.push(Buffer.from(chunk));}
          let data;try{const raw=Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/,'').trim();data=raw?JSON.parse(raw):{success:true};}catch{throw mediaError('1С не подтвердила запись JSON-ответом',409,'ONE_C_BAD_JSON');}
          if(response.status!==200||data.success===false)throw mediaError('1С не подтвердила запись',response.status===200?422:response.status,safeCode(data.error?.code));
          job.state='confirmed';job.response=data;job.error=null;job.confirmedAt=now();
          await this.receipt(job.userId,job.envelope,data,job.route);
        }catch(error){
          const status=Number(error.status||0),retryable=!status||status>=500||status===429;
          job.state=status===422?'invalid':status===409?'uncertain':retryable&&job.attempts<5?'ready':'failed';
          job.nextAt=Date.now()+[0,2000,5000,15000,30000,60000][job.attempts];
          job.error={status,code:safeCode(error.code||error.name),requestId:job.envelope.requestId};
        }finally{stream?.destroy?.();await this.save(job);this.log({event:'media-job',id:job.id,requestId:job.envelope.requestId,route:job.route,state:job.state,attempt:job.attempts,code:job.error?.code});}
      });
    }
  }
  async cleanup(){for(const item of await this.store.list('jobs')){
    if(item.scope!==this.scope)continue;
    await this.store.locked(item.id,async()=>{
    const job=await this.store.get('jobs',item.id);
    if(job.state==='confirmed'&&job.kind==='file'&&!job.bufferRemoved&&Date.now()-Date.parse(job.confirmedAt)>24*60*60*1000){await this.s3.remove(job.key);job.bufferRemoved=true;await this.save(job);}
    if(job.state==='uploading'&&Date.now()-Date.parse(job.updatedAt)>48*60*60*1000){await this.s3.abort(job.key,job.uploadId);job.state='failed';job.bufferRemoved=true;job.error={code:'UPLOAD_EXPIRED',status:410};await this.save(job);}
    });
  }}
}
