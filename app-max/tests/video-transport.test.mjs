import assert from 'node:assert/strict';
import {mkdtempSync,readdirSync,rmSync,mkdirSync,utimesSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import '../assets/video-transport.js';
import {prepareVideoRequest,cleanupStaleVideos} from '../media-proxy.mjs';

const transport=globalThis.ITUS_VIDEO_TRANSPORT;
const bytes=Buffer.alloc(40*1024*1024+5,37),digest=createHash('sha256').update(bytes).digest('hex');
const blob=new Blob([bytes],{type:'video/mp4'});
function envelope(route){const file={fileName:'synthetic.mp4',mimeType:'video/mp4',sizeBytes:blob.size,contentBlob:blob,clientFileId:'stable-file'};return {requestId:'stable-request',userId:'synthetic-user',clientMessageId:'stable-message',clientEntryId:'stable-entry',documentRef:'synthetic-document',...(route==='/defects/entries/add'?{entry:{type:'video',file,clientEntryId:'stable-entry'}}:{file})};}
let received=0;
const upstream=createServer(async(req,res)=>{
 try{
  const parts=[];for await(const c of req)parts.push(c);
  const raw=Buffer.concat(parts);assert.equal(raw.length,Number(req.headers['content-length']));
  assert.equal(req.headers['x-itus-request-id'],'stable-request');
  const data=JSON.parse(raw.toString()),file=data.entry?.file || data.file;
  const actual=Buffer.from(file.contentBase64,'base64');assert.equal(actual.length,bytes.length);
  assert.equal(createHash('sha256').update(actual).digest('hex'),digest);
  assert.equal(file.clientFileId,'stable-file');assert.equal(data.clientEntryId,'stable-entry');
  assert.equal(data.clientMessageId,'stable-message');assert.equal('contentBlob' in file,false);
  received++;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({success:true}));
 }catch(error){res.statusCode=500;res.end(JSON.stringify({error:String(error)}));}
});
await new Promise(r=>upstream.listen(0,'127.0.0.1',r));
const server=spawn(process.execPath,[fileURLToPath(new URL('../server.mjs',import.meta.url))],{env:{...process.env,PORT:'18138',LISTEN_HOST:'127.0.0.1',ONE_C_TARGET:`http://127.0.0.1:${upstream.address().port}`,MAX_REQUEST_BYTES:'31457280',LOG_PROXY_REQUESTS:'false'},stdio:['ignore','pipe','pipe']});
let logs='';server.stderr.on('data',c=>logs+=c);
try{
 await new Promise((r,j)=>{const timer=setTimeout(()=>j(Error('Proxy startup: '+logs)),10000);server.stdout.on('data',c=>{if(String(c).includes('ИТУС запущен')){clearTimeout(timer);r();}});server.once('exit',()=>{clearTimeout(timer);j(Error(logs));});});
 for(const route of ['/defects/entries/add','/clients/files/send','/internal-chat/files/send']){
  const request=transport.encode(route,envelope(route));assert.ok(request.body instanceof Blob);
  const response=await fetch('http://127.0.0.1:18138/api/1c'+route,{method:'POST',headers:{'Content-Type':request.contentType,'X-ITUS-Request-Id':'stable-request'},body:request.body});
  assert.equal(response.status,200,await response.text());
 }
 assert.equal(received,3);
 const unsupported=await fetch('http://127.0.0.1:18138/api/1c/auth/max',{method:'POST',headers:{'Content-Type':transport.contentType},body:'bad'});
 assert.equal(unsupported.status,400);
}finally{server.kill();await new Promise(r=>upstream.close(r));}

// Arbitrary network chunk boundaries, truncated bodies and cleanup are independent of HTTP buffering.
const folder=mkdtempSync(join(tmpdir(),'imax-video-test-'));
try{
 const small=new Blob([Buffer.from('0123456789')],{type:'video/mp4'});
 const e={...envelope('/clients/files/send'),file:{...envelope('/clients/files/send').file,sizeBytes:10,contentBlob:small}};
 const frame=Buffer.from(await transport.encode('/clients/files/send',e).body.arrayBuffer());
 const req=Readable.from([...frame].map(x=>Buffer.from([x])));req.headers={'x-itus-request-id':'stable-request'};
 const upload=await prepareVideoRequest(req,'/clients/files/send',{directory:folder});
 let json='';for await(const chunk of upload.body)json+=chunk;
 assert.equal(Buffer.from(JSON.parse(json).file.contentBase64,'base64').toString(),'0123456789');
 await upload.cleanup();await upload.cleanup();assert.deepEqual(readdirSync(folder),[]);
 const broken=Readable.from([frame.subarray(0,-1)]);broken.headers=req.headers;
 await assert.rejects(prepareVideoRequest(broken,'/clients/files/send',{directory:folder}),/не полностью/);
 assert.deepEqual(readdirSync(folder),[]);
 const stale=join(folder,'itus-video-Ab1234'),fresh=join(folder,'itus-video-Cd5678'),unrelated=join(folder,'unrelated');
 for(const path of [stale,fresh,unrelated])mkdirSync(path);
 const old=new Date(Date.now()-48*60*60*1000);utimesSync(stale,old,old);utimesSync(unrelated,old,old);
 await cleanupStaleVideos(folder);
 assert.deepEqual(readdirSync(folder).sort(),['itus-video-Cd5678','unrelated']);
}finally{rmSync(folder,{recursive:true,force:true});}
console.log('Video transport: 40 MiB+ through all three routes, byte-exact Base64, stable IDs, malformed/truncated input and cleanup OK.');
