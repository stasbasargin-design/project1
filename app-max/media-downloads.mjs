import streamJson from 'stream-json';
import {Readable} from 'node:stream';
import {mkdtemp,open,rm,statfs,mkdir,readdir,stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomBytes} from 'node:crypto';
import {mediaError} from './media-store.mjs';

// Consume one targeted attachment response. Binary content goes straight to a
// private disk file; only bounded metadata is assembled. A response containing
// another file/message is rejected before it can be served to the browser.
export async function extractAttachment(stream,path,{fileRef,messageRef='',maxBytes,signal}={}){
  const parser=streamJson.parser({packKeys:true,packStrings:false,packNumbers:true,streamKeys:false,streamNumbers:false,streamStrings:true});
  const source=stream?.getReader?Readable.fromWeb(stream):stream;source.pipe(parser);
  const sourceError=error=>parser.destroy(error);source.on('error',sourceError);
  const output=await open(path,'wx',0o600),stack=[];
  let metadata,chars=0,nodes=0,string='',binary=false,binaryObject=null,ancestors=[],carry='',bytes=0,padded=false,padding=0,stringStarted=false;
  const attach=value=>{if(++nodes>20000)throw mediaError('Ответ содержит слишком много записей',502,'MEDIA_METADATA_LIMIT');const parent=stack.at(-1);if(!parent){metadata=value;return;}if(Array.isArray(parent.value))parent.value.push(value);else parent.value[parent.key]=value;};
  async function decode(value,final=false){
    value=value.replace(/[\r\n]/g,'');
    if(!/^[A-Za-z0-9+/]*={0,2}$/.test(value)||padded&&/[^=]/.test(value))throw mediaError('Неверное содержимое файла',502,'MEDIA_BAD_BASE64');
    padding+=(value.match(/=/g)||[]).length;if(padding>2)throw mediaError('Неверное содержимое файла',502,'MEDIA_BAD_BASE64');
    if(value.includes('='))padded=true;
    carry+=value;const count=final?carry.length:Math.max(0,Math.floor(carry.length/4)*4-(padded?4:0));
    if(final&&carry.length%4)throw mediaError('Файл передан не полностью',502,'MEDIA_BAD_BASE64');
    if(count){const buffer=Buffer.from(carry.slice(0,count),'base64');carry=carry.slice(count);bytes+=buffer.length;if(bytes>maxBytes)throw mediaError('Недостаточно места или размер файла изменился',507,'MEDIA_DOWNLOAD_CAPACITY');await output.writeFile(buffer);}
  }
  try{
    for await(const token of parser){
      signal?.throwIfAborted();
      if(token.name==='startObject'||token.name==='startArray'){if(stack.length>=100)throw mediaError('Слишком глубокий ответ',502);const value=token.name==='startObject'?Object.create(null):[];attach(value);stack.push({value,key:''});}
      else if(token.name==='endObject'||token.name==='endArray')stack.pop();
      else if(token.name==='keyValue'){chars+=token.value.length;if(chars>2*1024*1024)throw mediaError('Слишком большие метаданные',502);stack.at(-1).key=token.value;}
      else if(token.name==='startString'){string='';binary=['contentBase64','base64'].includes(stack.at(-1)?.key);carry='';padded=false;padding=0;stringStarted=false;}
      else if(token.name==='stringChunk'){
        if(binary){if(!stringStarted&&token.value.length){if(binaryObject)throw mediaError('1С вернула содержимое нескольких файлов',502,'MEDIA_NOT_TARGETED');binaryObject=stack.at(-1).value;ancestors=stack.map(x=>x.value);stringStarted=true;}await decode(token.value);}
        else{chars+=token.value.length;if(chars>2*1024*1024)throw mediaError('Слишком большие метаданные',502,'MEDIA_METADATA_LIMIT');string+=token.value;}
      }else if(token.name==='endString'){if(binary){await decode('',true);attach('');}else attach(string);}
      else if(['numberValue','trueValue','falseValue','nullValue'].includes(token.name))attach(token.name==='numberValue'?Number(token.value):token.value);
    }
    if(metadata?.success===false)throw mediaError('1С не вернула файл',422,'ONE_C_ATTACHMENT_REJECTED');
    if(!binaryObject||!bytes||String(binaryObject.fileRef||binaryObject.ref||binaryObject.id)!==String(fileRef))throw mediaError('1С вернула другой файл',502,'MEDIA_FILE_MISMATCH');
    if(messageRef&&!ancestors.some(x=>String(x.messageRef||x.messageId||x.ref||'')===String(messageRef)))throw mediaError('1С вернула другое сообщение',502,'MEDIA_MESSAGE_MISMATCH');
    const declared=Number(binaryObject.sizeBytes||binaryObject.size||0);if(declared&&declared!==bytes)throw mediaError('Размер файла не совпадает',502,'MEDIA_FILE_SIZE_MISMATCH');
    return {size:bytes,fileName:String(binaryObject.fileName||binaryObject.name||'attachment'),mimeType:String(binaryObject.mimeType||binaryObject.contentType||'application/octet-stream')};
  }finally{source.off('error',sourceError);source.destroy?.();parser.destroy();await output.close();}
}

export class MediaDownloads {
  constructor({authorize,fetchAttachment,directory=process.env.MEDIA_TEMP_DIR||(process.platform==='linux'?'/var/tmp':tmpdir())}){Object.assign(this,{authorize,fetchAttachment,directory});this.entries=new Map();this.active=0;this.reserved=0;}
  async prepare(userId,route,envelope,expectedBytes=0){
    if(!['/clients/messages/list','/internal-chat/messages/list','/defects/start'].includes(route)||!envelope.attachmentRef||!(route==='/defects/start'?envelope.documentRef&&envelope.existingDocumentRef:envelope.messageRef))throw mediaError('Нужны точные ссылки на документ/сообщение и файл');
    if(this.active>=2)throw mediaError('Другой файл ещё подготавливается. Повторите позже.',503,'MEDIA_DOWNLOAD_BUSY');
    this.active++;let folder,budget=0,reservation=0;
    try{
      await this.authorize(userId,route,envelope);
      const disk=await statfs(this.directory),free=Number(disk.bavail)*Number(disk.bsize)-256*1024*1024-this.reserved;
      budget=expectedBytes>0?expectedBytes:Math.max(0,Math.floor(free/2));
      if(budget<1||budget>free)throw mediaError('Недостаточно временного места',507,'MEDIA_DOWNLOAD_CAPACITY');reservation=budget;this.reserved+=reservation;
      folder=await mkdtemp(join(this.directory,'itus-download-'));const path=join(folder,'file');
      const response=await this.fetchAttachment(route,envelope);
      if(response.status!==200){await response.body?.cancel?.();throw mediaError('Не удалось получить файл из 1С',response.status,'ONE_C_ATTACHMENT_ERROR');}
      const metadata=await extractAttachment(response.body,path,{fileRef:envelope.attachmentRef,messageRef:envelope.messageRef,maxBytes:budget});
      const ticket=randomBytes(24).toString('hex');this.entries.set(ticket,{...metadata,userId,path,folder,expires:Date.now()+10*60*1000});
      return {ticket,...metadata};
    }catch(error){if(folder)await rm(folder,{recursive:true,force:true});throw error;}
    finally{this.active--;this.reserved-=reservation;}
  }
  serve(req,res,ticket){
    const entry=this.entries.get(ticket);if(!entry||entry.expires<Date.now())throw mediaError('Ссылка истекла. Откройте файл заново.',410,'MEDIA_LINK_EXPIRED');
    let start=0,end=entry.size-1,status=200;
    if(req.headers.range){const match=String(req.headers.range).match(/^bytes=(\d*)-(\d*)$/);if(!match||!match[1]&&!match[2]){res.writeHead(416,{'Content-Range':`bytes */${entry.size}`});res.end();return;}
      if(!match[1])start=Math.max(0,entry.size-Number(match[2]));else start=Number(match[1]);if(match[2]&&match[1])end=Math.min(end,Number(match[2]));
      if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||start>=entry.size){res.writeHead(416,{'Content-Range':`bytes */${entry.size}`});res.end();return;}status=206;
    }
    const safeType=/^(?:image\/(?:jpeg|png|gif|webp)|video\/[\w.+-]+|audio\/[\w.+-]+|application\/pdf)$/i.test(entry.mimeType)?entry.mimeType:'application/octet-stream';
    res.writeHead(status,{'Content-Type':safeType,'Content-Length':end-start+1,'Accept-Ranges':'bytes','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Disposition':`inline; filename*=UTF-8''${encodeURIComponent(entry.fileName).replace(/'/g,'%27')}`,...(status===206?{'Content-Range':`bytes ${start}-${end}/${entry.size}`}:{})});
    if(req.method==='HEAD'){res.end();return;}
    const stream=createReadStream(entry.path,{start,end});stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());stream.pipe(res);
  }
  async cleanup(){
    for(const [key,entry] of this.entries)if(entry.expires<Date.now()){await rm(entry.folder,{recursive:true,force:true});this.entries.delete(key);}
    for(const item of await readdir(this.directory,{withFileTypes:true})){if(!item.isDirectory()||!/^itus-download-[A-Za-z0-9]{6}$/.test(item.name))continue;const folder=join(this.directory,item.name),info=await stat(folder);if(typeof process.getuid==='function'&&info.uid!==process.getuid())continue;if(Date.now()-info.mtimeMs>60*60*1000)await rm(folder,{recursive:true,force:true});}
  }
}
