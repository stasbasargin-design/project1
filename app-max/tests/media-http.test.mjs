import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {Readable} from 'node:stream';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {MediaStore} from '../media-store.mjs';
import {createMediaService} from '../media-service.mjs';
const folder=await mkdtemp(join(tmpdir(),'imax-media-http-'));
let release;const held=new Promise(r=>release=r),calls=[],parts=new Map();
const bytes=Buffer.alloc(10*1024*1024+3,39);
const upstream=createServer(async(req,res)=>{
 const chunks=[];for await(const chunk of req)chunks.push(chunk);const data=JSON.parse(Buffer.concat(chunks));
 res.setHeader('Content-Type','application/json');
 if(req.url==='/orders/get')return res.end(JSON.stringify({success:true,data:{order:{orderRef:'test-order',defectDocumentRef:'document-one'}}}));
 if(req.url==='/defects/start'){assert.equal(req.headers['x-itus-request-id'],data.requestId,'legacy 1C requires matching header and body identity');return res.end(JSON.stringify({success:true,data:{entries:[{entryRef:'selected-entry',file:{fileRef:'selected-file',contentBase64:'dGVzdA==',sizeBytes:4,mimeType:'image/png'}}]}}));}
 calls.push({route:req.url,data});
 if(req.url==='/defects/entries/add'){assert.equal(Buffer.from(data.entry.file.contentBase64,'base64').compare(bytes),0);await held;}
 res.end(JSON.stringify({success:true,data:{saved:true}}));
});await new Promise(r=>upstream.listen(0,'127.0.0.1',r));
const s3={async create(){return 'upload-one';},async upload(_key,_id,number,length,body){const chunks=[];for await(const c of body)chunks.push(Buffer.from(c));const buffer=Buffer.concat(chunks);assert.equal(buffer.length,length);parts.set(number,buffer);},async parts(){return [...parts].map(([PartNumber,body])=>({PartNumber,Size:body.length,ETag:'etag-'+PartNumber}));},async complete(){},async head(){return {ContentLength:bytes.length};},async read(){return Readable.from([...parts.entries()].sort(([a],[b])=>a-b).map(([,body])=>body));}};
const json=(res,status,body)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(body));};
const service=createMediaService({env:{MEDIA_BUFFER_ENABLED:'true',MEDIA_STATE_DIR:folder,MEDIA_CONTEXT:'test',MEDIA_S3_BUCKET:'private',MEDIA_S3_ACCESS_KEY:'test',MEDIA_S3_SECRET_KEY:'test',ONE_C_TARGET:`http://127.0.0.1:${upstream.address().port}`},upstreamHeaders:()=>({'Content-Type':'application/json'}),json,s3Factory:async()=>s3});await service.init();
const server=createServer(async(req,res)=>{if(req.url==='/health')return json(res,200,{success:true});if(!await service.handle(req,res,req.url))json(res,404,{});});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}/api/media`;
let token='';
async function request(path,body,auth=token){const response=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(auth?{'X-ITUS-Device':auth}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:response.status,...await response.json()};}
async function until(check){for(let i=0;i<300;i++){if(await check())return;await new Promise(r=>setTimeout(r,20));}throw Error('Expected job state not reached');}
try{
 assert.equal((await request('/jobs',{})).status,401);
 assert.equal((await request('/config')).data.enabled,true);
 const store=new MediaStore(folder),code=await store.issueCode('111');
 assert.equal((await request('/pair',{userId:'222',code})).status,401);
 token=(await request('/pair',{userId:'111',code})).data.token;
 assert.equal((await request('/pair',{userId:'111',code})).status,401);
 const envelope={requestId:'http-file-one',userId:'111',maxUserId:'111',orderRef:'test-order',documentRef:'document-one',clientEntryId:'http-entry-one',entry:{type:'video',file:{fileName:'test.mp4',mimeType:'video/mp4',sizeBytes:bytes.length,clientFileId:'http-file-id',transport:'s3'}}};
 assert.equal((await request('/jobs',{route:'/defects/entries/add',envelope:{...envelope,userId:'222'}})).status,403);
 const job=(await request('/jobs',{route:'/defects/entries/add',envelope})).data;
 const complete=(await request('/jobs',{route:'/acceptance/complete',envelope:{userId:'111',requestId:'http-complete-one',documentRef:'document-one',orderRef:'test-order'},complete:true,dependencies:[envelope.requestId,'http-small-file']})).data;
 assert.equal((await request('/jobs/'+job.id+'/uploaded',{})).status,409,'partial multipart upload cannot be imported');
 for(let number=1;number<=Math.ceil(bytes.length/job.partSize);number++){
   const signed=(await request('/jobs/'+job.id+'/sign',{number})).data;assert.equal(signed.relay,true);
   const chunk=bytes.subarray((number-1)*job.partSize,number*job.partSize);
   const response=await fetch(base+signed.path,{method:'POST',headers:{'X-ITUS-Device':token,'Content-Type':'application/octet-stream'},body:chunk});assert.equal(response.status,200,await response.text());
 }
 await request('/jobs/'+job.id+'/uploaded',{});await until(()=>calls.some(x=>x.route==='/defects/entries/add'));
 assert.equal((await request('/jobs/'+job.id)).data.state,'importing');
 const start=performance.now();assert.equal((await fetch(base.replace('/api/media','/health'))).status,200);assert.ok(performance.now()-start<1000);
 assert.equal(calls.filter(x=>x.route==='/acceptance/complete').length,0);
 release();await until(async()=> (await request('/jobs/'+job.id)).data.state==='confirmed');
 assert.equal(calls.filter(x=>x.route==='/acceptance/complete').length,0,'local direct file still needs acknowledgement');
 await service.receipt({userId:'111'},{requestId:'http-small-file',documentRef:'document-one'},{success:true});
 await until(async()=> (await request('/jobs/'+complete.id)).data.state==='confirmed');
 assert.equal(calls.filter(x=>x.route==='/acceptance/complete').length,1);
 assert.equal((await request('/jobs',{route:'/defects/entries/add',envelope})).data.state,'confirmed');
 assert.equal(calls.filter(x=>x.route==='/defects/entries/add').length,1);
 const selected=await request('/attachment',{route:'/defects/start',envelope:{userId:'111',requestId:'read-selected-file',orderRef:'test-order',documentRef:'document-one',existingDocumentRef:'document-one',attachmentRef:'selected-file',entryRef:'selected-entry'},expectedBytes:4});assert.equal(selected.status,200);assert.equal(selected.data.size,4);
 const other=(await request('/pair',{userId:'222',code:await store.issueCode('222')},'')).data.token;
 assert.equal((await request('/jobs/'+job.id,undefined,other)).status,404);
 console.log('Media HTTP: authenticated relay, exact chunk bytes, resume/status, other-user isolation, independent health, durable mixed package and one completion passed');
}finally{release();service.close();await Promise.all([new Promise(r=>server.close(r)),new Promise(r=>upstream.close(r))]);await rm(folder,{recursive:true,force:true});}
