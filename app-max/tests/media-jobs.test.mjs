import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import {MediaStore} from '../media-store.mjs';
import {MediaJobs,DIRECT_FILE_BYTES} from '../media-jobs.mjs';
const folder=await mkdtemp(join(tmpdir(),'imax-media-jobs-'));
try{
 const store=new MediaStore(folder);await store.init();
 const code=await store.issueCode('111');await assert.rejects(store.redeem('222',code),error=>error.status===401);
 const results=await Promise.allSettled([store.redeem('111',code),store.redeem('111',code)]);
 assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
 const device=results.find(x=>x.status==='fulfilled').value;assert.equal((await store.authenticate(device.token)).userId,'111');
 const restoredStore=new MediaStore(folder);await restoredStore.init();assert.equal((await restoredStore.authenticate(device.token)).userId,'111');
 const size=DIRECT_FILE_BYTES+1,bytes=Buffer.alloc(size,37),sent=[];let imports=0;
 const s3={async create(){return 'upload';},async parts(){return [{PartNumber:1,Size:8*1024*1024,ETag:'one'},{PartNumber:2,Size:size-8*1024*1024,ETag:'two'}];},async complete(){},async head(){return {ContentLength:size};},async read(){return Readable.from([bytes]);},async sign(){return 'https://private.invalid/part';}};
 const options={store,s3,scope:'test',authorize:async()=>{},send:async(route,request)=>{
   let body='';if(typeof request.body==='string')body=request.body;else for await(const chunk of request.body)body+=chunk;
   assert.equal(Buffer.byteLength(body),request.byteLength);const data=JSON.parse(body);sent.push({route,data});
   if(data.entry?.file){assert.equal(Buffer.from(data.entry.file.contentBase64,'base64').compare(bytes),0);imports++;}
   return {status:200,body:Readable.from([JSON.stringify({success:true,data:{saved:true}})])};
 }};
 const jobs=new MediaJobs(options);jobs.stopped=true;
 const envelope={requestId:'request-file-1',userId:'111',maxUserId:'111',authId:'111',documentRef:'doc',orderRef:'order',clientEntryId:'entry-1',entry:{type:'video',file:{fileName:'synthetic.mp4',mimeType:'video/mp4',sizeBytes:size,clientFileId:'file-1',transport:'s3'}}};
 const job=await jobs.create('111','/defects/entries/add',envelope);assert.equal(job.state,'uploading');
 assert.equal((await jobs.create('111','/defects/entries/add',structuredClone(envelope))).id,job.id);
 await assert.rejects(jobs.create('111','/auth/max',envelope));
 await assert.rejects(jobs.create('222','/defects/entries/add',envelope),error=>error.status===403);
 await assert.rejects(jobs.owned('222',job.id),error=>error.status===404);
 await assert.rejects(jobs.sign('111',job.id,3));
 await assert.rejects(jobs.create('111','/defects/entries/add',{...envelope,entry:{...envelope.entry,file:{...envelope.entry.file,fileName:'changed.mp4'}}}),error=>error.code==='MEDIA_ID_CONFLICT');
 const completion=await jobs.create('111','/acceptance/complete',{requestId:'request-complete-1',userId:'111',documentRef:'doc',orderRef:'order'},{complete:true,dependencies:[envelope.requestId,'request-small-file']});
 await jobs.uploaded('111',job.id);
 // A newly constructed worker, with no browser/client object, resumes the job.
 const worker=new MediaJobs({...options,store:restoredStore});worker.active=true;
 await worker.drain();assert.equal(imports,1);assert.equal((await worker.owned('111',completion.id)).state,'ready');
 await worker.receipt('111',{requestId:'request-small-file',documentRef:'another-doc'},{success:true});
 await worker.drain();assert.equal(sent.filter(x=>x.route==='/acceptance/complete').length,0);
 await worker.receipt('111',{requestId:'request-small-file',documentRef:'doc'},{success:true});await worker.drain();
 assert.equal(sent.at(-1).route,'/acceptance/complete');assert.equal(sent.filter(x=>x.route==='/acceptance/complete').length,1);
 assert.equal((await worker.create('111','/defects/entries/add',envelope)).state,'confirmed');await worker.drain();assert.equal(imports,1);
 // 422 remains invalid. 409 is uncertain. Neither is silently resubmitted.
 for(const status of [422,409]){
   const e={...envelope,requestId:'rejected-file-'+status},j=await jobs.create('111','/defects/entries/add',e);await jobs.uploaded('111',j.id);
   const rejected=new MediaJobs({...options,send:async()=>({status,body:Readable.from([JSON.stringify({success:false,error:{code:'TEST_REJECTION'}})])})});rejected.active=true;
   await rejected.drain();const saved=await rejected.owned('111',j.id);assert.equal(saved.state,status===422?'invalid':'uncertain');await rejected.drain();assert.equal((await rejected.owned('111',j.id)).attempts,1);await assert.rejects(rejected.retry('111',j.id));
 }
 // Restart after an ambiguous response retains the same IDs, and five failures
 // stop the worker without losing the job or its file.
 const e={...envelope,requestId:'lost-response-file'},j=await jobs.create('111','/defects/entries/add',e);await jobs.uploaded('111',j.id);let attempts=0;
 const failures=new MediaJobs({...options,send:async(_route,request)=>{attempts++;assert.equal(request.requestId,e.requestId);throw Error('Synthetic network failure');}});failures.active=true;
 for(let i=0;i<5;i++){let current=await failures.owned('111',j.id);current.nextAt=0;await failures.save(current);await failures.drain();}
 assert.equal(attempts,5);assert.equal((await failures.owned('111',j.id)).state,'failed');
 console.log('Media jobs: private pairing, durable recovery, multipart validation, byte-exact full import, mixed dependencies, one completion, stable IDs, 422/409 and retry cap passed');
}finally{await rm(folder,{recursive:true,force:true});}
