import {mkdtemp,open,rm,statfs,readdir,stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {Readable} from 'node:stream';

export const VIDEO_CONTENT_TYPE='application/vnd.itus.video';
export const MEDIA_ROUTES=new Set(['/defects/entries/add','/clients/files/send','/internal-chat/files/send']);
const MAX_HEADER=256*1024, DISK_RESERVE=256*1024*1024;
let active=0,reserved=0;
const failure=(message,status=400,code='INVALID_VIDEO')=>Object.assign(new Error(message),{status,code});
export async function cleanupStaleVideos(directory=tmpdir()){
  for(const item of await readdir(directory,{withFileTypes:true})){
    if(!item.isDirectory() || !/^itus-video-[A-Za-z0-9]{6}$/.test(item.name))continue;
    const path=join(directory,item.name);
    try{
      const info=await stat(path);
      if(typeof process.getuid==='function' && info.uid!==process.getuid())continue;
      if(Date.now()-info.mtimeMs>24*60*60*1000)await rm(path,{recursive:true,force:true});
    }catch(error){if(error.code!=='ENOENT')throw error;}
  }
}

// Only the transport changes. 1C receives the same JSON/file/contentBase64 contract.
// The temporary file is private, bounded by actual disk availability and always removed.
export async function prepareVideoRequest(req,route,{directory=tmpdir(),signal}={}){
  if(!MEDIA_ROUTES.has(route))throw failure('Видео нельзя отправить в этот метод');
  if(active>=2)throw failure('Сервер обрабатывает другие видео. Отправка будет повторена.',503,'MEDIA_BUSY');
  active++;
  let folder,handle,reservation=0,disposed=false;
  const abort=()=>req.destroy(Object.assign(new Error('Передача видео прервана'),{name:'AbortError'}));
  signal?.addEventListener('abort',abort,{once:true});
  const cleanup=async()=>{
    if(disposed)return;disposed=true;
    signal?.removeEventListener('abort',abort);
    await handle?.close().catch(()=>{});handle=null;
    try{if(folder)await rm(folder,{recursive:true,force:true});}
    finally{reserved-=reservation;active--;}
  };
  const iterator=req.iterator({destroyOnReturn:false});
  let remaining=Buffer.alloc(0);
  async function take(count){
    const pieces=[];let used=0;
    while(used<count){
      signal?.throwIfAborted();
      if(!remaining.length){const next=await iterator.next();if(next.done)throw failure('Передача видео прервана');remaining=Buffer.from(next.value);}
      const length=Math.min(count-used,remaining.length);pieces.push(remaining.subarray(0,length));remaining=remaining.subarray(length);used+=length;
    }
    return Buffer.concat(pieces,count);
  }
  try{
    const headerLength=(await take(4)).readUInt32BE();
    if(headerLength<2 || headerLength>MAX_HEADER)throw failure('Некорректный заголовок видео');
    let header;try{header=JSON.parse((await take(headerLength)).toString('utf8'));}catch{throw failure('Некорректные данные видео');}
    const envelope=header?.envelope;
    const file=route==='/defects/entries/add'?envelope?.entry?.file:envelope?.file;
    const size=header?.sizeBytes;
    if(!envelope || !file || !Number.isSafeInteger(size) || size<1 || file.sizeBytes!==size || !/^video\//i.test(file.mimeType || '') || file.contentBase64!=='' || 'contentBlob' in file)throw failure('Неверный размер или формат видео');
    const headerRequestId=String(req.headers?.['x-itus-request-id'] || '');
    if(!headerRequestId || envelope.requestId!==headerRequestId)throw failure('Идентификатор запроса видео не совпадает');
    const disk=await statfs(directory);
    const available=Number(disk.bavail)*Number(disk.bsize)-DISK_RESERVE-reserved;
    if(size>available)throw failure('На сервере недостаточно временного места для видео. Файл сохранён в очереди.',507,'MEDIA_STORAGE_FULL');
    reservation=size;reserved+=size;
    folder=await mkdtemp(join(directory,'itus-video-'));
    const path=join(folder,'body');handle=await open(path,'wx',0o600);
    let received=0;
    async function append(chunk){
      signal?.throwIfAborted();received+=chunk.length;
      if(received>size)throw failure('Размер видео отличается от указанного');
      await handle.writeFile(chunk);
    }
    if(remaining.length){await append(remaining);remaining=Buffer.alloc(0);}
    for(;;){signal?.throwIfAborted();const next=await iterator.next();if(next.done)break;await append(next.value);}
    if(received!==size)throw failure('Видео передано не полностью');
    await handle.close();handle=null;
    const marker=`ITUS_VIDEO_${randomUUID()}`;file.contentBase64=marker;
    const json=JSON.stringify(envelope),needle=JSON.stringify(marker),at=json.indexOf(needle);
    const prefix=Buffer.from(json.slice(0,at)+'"'),suffix=Buffer.from('"'+json.slice(at+needle.length));
    const body=Readable.from((async function*(){
      yield prefix;let carry=Buffer.alloc(0);
      for await(const chunk of createReadStream(path,{highWaterMark:192*1024})){
        signal?.throwIfAborted();const value=carry.length?Buffer.concat([carry,chunk]):chunk;
        const length=value.length-value.length%3;
        if(length)yield value.subarray(0,length).toString('base64');
        carry=Buffer.from(value.subarray(length));
      }
      if(carry.length)yield carry.toString('base64');
      yield suffix;
    })());
    return {body,byteLength:prefix.length+4*Math.ceil(size/3)+suffix.length,cleanup};
  }catch(error){await cleanup();throw error;}
}
