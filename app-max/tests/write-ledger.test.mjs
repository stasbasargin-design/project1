import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {MediaStore} from '../media-store.mjs';
import {WriteLedger} from '../write-ledger.mjs';
const folder=await mkdtemp(join(tmpdir(),'imax-write-ledger-'));
try{
 const store=new MediaStore(folder);await store.init();const ledger=new WriteLedger({store,scope:'test'});
 const body={userId:'111',maxUserId:'111',requestId:'request-stable',timestamp:'original',authMode:'manual',clientEntryId:'entry-stable',documentRef:'document-one',entry:{type:'photo',file:{fileName:'test.png',mimeType:'image/png',contentBase64:'YQ==',sizeBytes:1}}};
 let writes=0;const send=async()=>{writes++;await new Promise(r=>setTimeout(r,10));return new Response(JSON.stringify({success:true,data:{fileRef:'file-'+writes}}),{status:200});};
 const responses=await Promise.all([ledger.run('111','/defects/entries/add',body,send),ledger.run('111','/defects/entries/add',structuredClone(body),send)]);
 assert.equal(writes,1);assert.equal((await responses[0].json()).data.fileRef,(await responses[1].json()).data.fileRef);
 await ledger.run('111','/defects/entries/add',{...body,requestId:'another-request',timestamp:'new',authMode:'max',version:'future'},send);assert.equal(writes,1,'same clientEntryId must use original receipt even with a new requestId');
 await assert.rejects(ledger.run('111','/defects/entries/add',{...body,entry:{...body.entry,file:{...body.entry.file,contentBase64:'Yg=='}}},send),error=>error.code==='WRITE_ID_CONFLICT');
 const restored=new WriteLedger({store:new MediaStore(folder),scope:'test'});await restored.run('111','/defects/entries/add',body,send);assert.equal(writes,1,'receipt must survive process recreation');
 const lost={...body,requestId:'lost-response',clientEntryId:'lost-entry'};let lostCalls=0;
 await assert.rejects(ledger.run('111','/defects/entries/add',lost,async()=>{lostCalls++;throw Object.assign(new TypeError('Synthetic lost reply'),{cause:{code:'ECONNRESET'}});}),error=>error.code==='ONE_C_RESULT_UNCERTAIN');
 await assert.rejects(restored.run('111','/defects/entries/add',lost,async()=>{lostCalls++;return new Response('{}');}),error=>error.code==='ONE_C_RESULT_UNCERTAIN');assert.equal(lostCalls,1,'ambiguous write must not be sent a second time');
 const rejected={...body,requestId:'rejected',clientEntryId:'rejected-entry'};let checks=0,valid=false;
 const validation=async()=>{checks++;return new Response(JSON.stringify({success:valid}),{status:valid?200:422});};
 assert.equal((await ledger.run('111','/defects/entries/add',rejected,validation)).status,422);await ledger.run('111','/defects/entries/add',rejected,validation);assert.equal(checks,1);
 valid=true;assert.equal((await ledger.run('111','/defects/entries/add',rejected,validation,{manual:true})).status,200);assert.equal(checks,2);
 const connect={...body,requestId:'connect-failure',clientEntryId:'connect-entry'};let connects=0;
 const connection=async()=>{if(!connects++)throw Object.assign(new TypeError('Connect refused'),{cause:{code:'ECONNREFUSED'}});return new Response('{}');};
 await assert.rejects(ledger.run('111','/defects/entries/add',connect,connection),error=>error.code==='ONE_C_CONNECT_FAILED');await ledger.run('111','/defects/entries/add',connect,connection);assert.equal(connects,2);
 console.log('Write ledger: broken upstream deduplicated, logical IDs, concurrency/restart, payload conflict, lost reply held, checked 422 retry and safe preconnect retry passed');
}finally{await rm(folder,{recursive:true,force:true});}
