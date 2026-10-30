import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import {createServer} from 'node:http';
import {extractAttachment,MediaDownloads} from '../media-downloads.mjs';
const folder=await mkdtemp(join(tmpdir(),'imax-download-test-'));
const bytes=Buffer.alloc(3*1024*1024+1,57);
const response=(fileRef='file-one',messageRef='message-one')=>({success:true,data:{messages:[{messageRef,attachments:[{contentBase64:bytes.toString('base64'),mimeType:'video/mp4',sizeBytes:bytes.length,fileRef,fileName:'synthetic.mp4'}]}]}});
try{
 const raw=JSON.stringify(response()),path=join(folder,'exact');
 const stream=Readable.from((async function*(){for(let n=0;n<raw.length;n+=777)yield raw.slice(n,n+777);})());
 const metadata=await extractAttachment(stream,path,{fileRef:'file-one',messageRef:'message-one',maxBytes:bytes.length});
 assert.equal(metadata.size,bytes.length);assert.equal((await readFile(path)).compare(bytes),0);
 const wrapped=response();wrapped.data.messages[0].attachments[0].contentBase64=bytes.toString('base64').match(/.{1,76}/g).join('\r\n');
 const wrappedResult=await extractAttachment(Readable.from([JSON.stringify(wrapped)]),join(folder,'wrapped'),{fileRef:'file-one',messageRef:'message-one',maxBytes:bytes.length});assert.equal(wrappedResult.size,bytes.length);assert.equal((await readFile(join(folder,'wrapped'))).compare(bytes),0);
 await assert.rejects(extractAttachment(Readable.from([JSON.stringify(response('another'))]),join(folder,'wrong-file'),{fileRef:'file-one',messageRef:'message-one',maxBytes:bytes.length}),error=>error.code==='MEDIA_FILE_MISMATCH');
 await assert.rejects(extractAttachment(Readable.from([JSON.stringify(response('file-one','another'))]),join(folder,'wrong-message'),{fileRef:'file-one',messageRef:'message-one',maxBytes:bytes.length}),error=>error.code==='MEDIA_MESSAGE_MISMATCH');
 const many=response();many.data.messages[0].attachments.push({fileRef:'another',contentBase64:'YQ=='});
 const selected=await extractAttachment(Readable.from([JSON.stringify(many)]),join(folder,'many'),{fileRef:'file-one',messageRef:'message-one',maxBytes:bytes.length+1});assert.equal(selected.size,bytes.length);assert.equal((await readFile(join(folder,'many'))).compare(bytes),0);
 const downloads=new MediaDownloads({directory:folder,authorize:async()=>{},fetchAttachment:async()=>({status:200,body:Readable.from([raw])})});
 const prepared=await downloads.prepare('111','/internal-chat/messages/list',{messageRef:'message-one',attachmentRef:'file-one'},bytes.length);
 const server=createServer((req,res)=>{try{downloads.serve(req,res,req.url.slice(1));}catch(error){res.writeHead(error.status||500).end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{
   const url=`http://127.0.0.1:${server.address().port}/${prepared.ticket}`;
   const part=await fetch(url,{headers:{Range:'bytes=1-17'}});assert.equal(part.status,206);assert.equal(Number(part.headers.get('content-length')),17);assert.equal(Buffer.from(await part.arrayBuffer()).compare(bytes.subarray(1,18)),0);
   assert.equal((await fetch(url,{headers:{Range:'bytes=999999999-'}})).status,416);
   assert.equal((await fetch(url.replace(prepared.ticket,'0'.repeat(48)))).status,410);
   downloads.entries.get(prepared.ticket).expires=0;await downloads.cleanup();assert.equal((await fetch(url)).status,410);
 }finally{await new Promise(r=>server.close(r));}
 console.log('Binary attachment bridge: bounded streaming, exact IDs/bytes, selection among multiple files, Range, expiry and cleanup passed');
}finally{await rm(folder,{recursive:true,force:true});}
