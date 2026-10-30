import {digest,mediaError,assertMediaIdentity} from './media-store.mjs';
export const WRITE_ROUTES=new Set(['/defects/entries/add','/clients/files/send','/internal-chat/files/send','/clients/messages/send','/internal-chat/messages/send','/acceptance/complete','/defects/complete']);
const volatile=new Set(['requestId','timestamp','userId','maxUserId','authId','authMode','max','miniApp','version','source','clientBotId','serviceBotId']);
function fingerprint(route,envelope,binaryDigest){
  const body=Object.fromEntries(Object.entries(envelope).filter(([key])=>!volatile.has(key)));
  if(body.entry)body.entry={...body.entry};
  const file=body.entry?.file||body.file;
  if(file){
    const copy={...file};delete copy.clientFileId;delete copy.contentBlob;delete copy.transport;
    copy.contentBase64=file.transport==='s3'?'immutable-buffer':binaryDigest||digest(Buffer.from(String(file.contentBase64||'').replace(/^data:[^,]*,/,''),'base64'));
    if(body.entry?.file)body.entry.file=copy;else body.file=copy;
  }
  return digest(JSON.stringify({route,body},(_key,value)=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b))):value));
}
const uncertain=()=>mediaError('Ответ 1С не подтверждён. Пакет сохранён; перед повтором нужна сверка по requestId.',409,'ONE_C_RESULT_UNCERTAIN');
export class WriteLedger {
  constructor({store,scope}){Object.assign(this,{store,scope});}
  async run(userId,route,envelope,send,{binaryDigest,manual=false}={}){
    assertMediaIdentity(userId,envelope);
    const logicalId=envelope.clientEntryId||envelope.entry?.clientEntryId||envelope.clientMessageId||envelope.requestId;
    const object=envelope.documentRef||envelope.topicRef||envelope.groupRef||envelope.orderRef||'';
    if(!logicalId||!envelope.requestId)throw mediaError('Не указан идентификатор операции');
    const key=digest([this.scope,userId,route,object,logicalId].join('|')),signature=fingerprint(route,envelope,binaryDigest);
    return this.store.locked('write:'+key,async()=>{
      let record=await this.store.get('writes',key);
      if(record&&record.signature!==signature)throw mediaError('ID уже связан с другим содержимым',409,'WRITE_ID_CONFLICT');
      if(record?.state==='confirmed')return new Response(record.raw,{status:200,headers:{'Content-Type':record.contentType}});
      if(record&&['sending','uncertain'].includes(record.state))throw uncertain();
      if(record?.state==='rejected'&&!manual)return new Response(record.raw,{status:record.status,headers:{'Content-Type':record.contentType}});
      record={key,signature,userId,route,requestId:envelope.requestId,logicalId,documentRef:envelope.documentRef||'',state:'sending',startedAt:new Date().toISOString()};
      await this.store.put('writes',key,record);
      try{
        const response=await send(),chunks=[];let bytes=0;
        for await(const chunk of response.body||[]){bytes+=chunk.length;if(bytes>1024*1024)throw uncertain();chunks.push(Buffer.from(chunk));}
        const raw=Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/,'');let data;
        try{data=raw.trim()?JSON.parse(raw):{success:true};}catch{throw uncertain();}
        const confirmed=response.status===200&&data.success!==false;
        if(response.status>=500)throw uncertain();
        record={...record,state:confirmed?'confirmed':'rejected',status:response.status,raw,contentType:response.headers?.get?.('content-type')||'application/json; charset=utf-8',updatedAt:new Date().toISOString()};
        await this.store.put('writes',key,record);
        return new Response(raw||null,{status:response.status,headers:{'Content-Type':record.contentType}});
      }catch(error){
        // Only a failed connection before HTTP can be retried without the 1C
        // idempotency guarantee. A lost response may follow a committed write.
        const preconnect=['ECONNREFUSED','ENOTFOUND','EAI_AGAIN'].includes(error.cause?.code);
        await this.store.put('writes',key,{...record,state:preconnect?'pending':'uncertain',updatedAt:new Date().toISOString()});
        if(preconnect)throw Object.assign(error,{status:503,code:'ONE_C_CONNECT_FAILED'});
        throw uncertain();
      }
    });
  }
}
