import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync,mkdtempSync,rmSync,mkdirSync} from 'node:fs';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {join,resolve,extname} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url)),calls=[],held=[];
const image='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6Z1sAAAAASUVORK5CYII=';
const entries=Array.from({length:36},(_,i)=>({entryRef:'entry-'+i,type:'text',text:'Synthetic defect '+i,verified:false}));
entries.splice(1,0,{entryRef:'photo-entry',type:'photo',text:'',file:{fileRef:'photo-ref',fileName:'original.png',mimeType:'image/png',sizeBytes:Buffer.from(image,'base64').length}});
entries.splice(2,0,{entryRef:'video-entry',type:'video',file:{fileRef:'video-ref',fileName:'sample.mp4',mimeType:'video/mp4',contentBase64:'AAAA',sizeBytes:3}});
const order={orderRef:'order-one',orderNumber:'Synthetic order',defectDocumentRef:'defect-one'};
const server=createServer(async(req,res)=>{
  const path=new URL(req.url,'http://synthetic.invalid').pathname;
  if(path==='/api/media/download/'+'b'.repeat(48)){res.setHeader('Content-Type','image/png');res.end(Buffer.from(image,'base64'));return;}
  if(path.includes('/api/')){
    let raw='';for await(const chunk of req)raw+=chunk;let body={};try{body=JSON.parse(raw||'{}');}catch{}
    calls.push({path,body});let data={};
    if(path.endsWith('/environments/config'))data={test:true,production:true,isolatedPush:true};
    else if(path.endsWith('/push/web/config')||path.endsWith('/push/installation'))data={enabled:false};
    else if(path.endsWith('/auth/max'))data={user:{name:'Synthetic employee',roleName:'admin'},availableTabs:['orders','mp','executor','tech','clients','chat']};
    else if(path.endsWith('/orders/list'))data={orders:[order]};
    else if(path.endsWith('/orders/get'))data={order};
    else if(path.endsWith('/defects/start'))data={documentRef:'defect-one',entries};
    else if(path.endsWith('/topics/list'))data={topics:[{topicRef:'client-one',title:'Synthetic client one',orderRef:order.orderRef,orderNumber:order.orderNumber},{topicRef:'client-two',title:'Synthetic client two'}]};
    else if(path.endsWith('/groups/list'))data={groups:[{groupRef:'staff-one',title:'Передача смены',isCommon:true}]};
    else if(path.endsWith('/messages/list'))data={messages:Array.from({length:55},(_,i)=>({messageRef:'message-'+i,text:'Synthetic history line '+i,authorName:'Synthetic author',createdAt:'2026-11-13T08:'+String(i).padStart(2,'0')+':00Z'}))};
    else if(path.endsWith('/contacts/list'))data={contacts:[]};
    else if(path.endsWith('/media/session'))data={token:'a'.repeat(64),expires:Date.now()+3600000};
    else if(path.endsWith('/media/attachment'))data={ticket:'b'.repeat(48)};
    else if(path.endsWith('/notifications/poll'))data={events:[],unreadCount:0};
    else if(/\/(files|messages)\/send$/.test(path)){held.push(res);return;}
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify({success:true,data}));return;
  }
  const file=path==='/'?join(root,'index.html'):resolve(root,'.'+path);
  if(!file.startsWith(root)||!existsSync(file)){res.writeHead(404).end();return;}
  res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.png':'image/png'}[extname(file)]||'text/plain'));
  res.end(readFileSync(file));
});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=[process.env.CHROME_PATH,'/usr/bin/google-chrome','/usr/bin/chromium','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean).find(existsSync);assert.ok(browser);
const profile=mkdtempSync(join(tmpdir(),'imax-chat-defect-')),child=spawn(browser,['--headless=new','--disable-gpu','--no-first-run','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:['ignore','ignore','pipe']});let socket,stderr='';child.stderr.on('data',b=>stderr+=b);
try{
  const portFile=join(profile,'DevToolsActivePort');for(let n=0;n<200&&!existsSync(portFile);n++)await new Promise(r=>setTimeout(r,50));assert.ok(existsSync(portFile),stderr);
  const port=readFileSync(portFile,'utf8').split('\n')[0],pages=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();socket=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);await new Promise((r,j)=>{socket.onopen=r;socket.onerror=j;});
  let sequence=0;const waiting=new Map();socket.onmessage=e=>{const m=JSON.parse(e.data),w=waiting.get(m.id);if(!w)return;waiting.delete(m.id);clearTimeout(w.timer);m.error?w.reject(Error(JSON.stringify(m.error))):w.resolve(m.result);};
  const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>reject(Error('Browser timeout '+method)),15000);waiting.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));});
  const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
  const wait=expression=>evaluate('new Promise((resolve,reject)=>{const t=setInterval(()=>{if('+expression+'){clearInterval(t);resolve(true)}},25);setTimeout(()=>{clearInterval(t);reject(Error("Missing state: "+'+JSON.stringify(expression)+'))},8000)})');
  const click=selector=>evaluate('document.querySelector('+JSON.stringify(selector)+').click()');
  const settle=()=>evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  const draft=async value=>{await evaluate('(()=>{const t=document.getElementById("msgDraft");t.value='+JSON.stringify(value)+';t.dispatchEvent(new Event("input",{bubbles:true}));})()');await settle();return evaluate('document.getElementById("msgDraft").getBoundingClientRect().height');};
  const queue=()=>evaluate("new Promise((resolve,reject)=>{const r=indexedDB.open('itus-operation-queue');r.onsuccess=()=>{const db=r.result,q=db.transaction('operations','readonly').objectStore('operations').getAll();q.onsuccess=()=>{resolve(q.result.map(x=>({id:x.id,requestId:x.requestId,body:x.body,scope:x.scope,method:x.method})));db.close()};q.onerror=()=>reject(q.error)}})");
  const screenshot=async name=>{if(process.env.CHAT_DEFECT_ARTIFACT_DIR){mkdirSync(process.env.CHAT_DEFECT_ARTIFACT_DIR,{recursive:true});writeFileSync(join(process.env.CHAT_DEFECT_ARTIFACT_DIR,name+'.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));}};
  await send('Page.enable');await send('Emulation.setDeviceMetricsOverride',{width:393,height:852,deviceScaleFactor:1,mobile:true});
  await send('Page.addScriptToEvaluateOnNewDocument',{source:"window.__ITUS_API_BASE__=location.origin+'/api/1c';localStorage.setItem('itus.environment:'+location.origin,'test');"});
  await send('Page.navigate',{url:'http://127.0.0.1:'+server.address().port+'/'});await wait('document.querySelector("#authUserId")');await evaluate('document.getElementById("authUserId").value="111"');await click('[data-action="login"]');await wait('document.querySelector("#orderSearch")');
  // The same composer implementation serves both messengers. Input growth must
  // preserve its DOM node, caret and a history position away from the bottom.
  await click('[data-view="chat"]');await wait('document.querySelector("[data-action=msg-source]")');
  for(const source of ['staff','clients']){
    await click('[data-action="msg-source"][data-source="'+source+'"]');await wait('document.querySelector("[data-action=msg-open]")');await click('[data-action="msg-open"]');await wait('document.querySelector("#msgDraft")');await wait('document.querySelectorAll(".msg-bubble").length>10');
    const initial=await draft('');await evaluate('window.__draftNode=document.getElementById("msgDraft");document.querySelector(".msg-history").scrollTop=120;window.__historyTop=document.querySelector(".msg-history").scrollTop');
    const expanded=await draft('Первая строка\nВторая строка\nТретья строка');assert.ok(expanded>initial+20,source+' multiline growth');
    assert.equal(await evaluate('__draftNode===document.getElementById("msgDraft")'),true);
    assert.equal(await evaluate('Math.abs(document.querySelector(".msg-history").scrollTop-__historyTop)<2'),true,'reading position preserved');
    assert.ok(await draft('Слова с переносом '.repeat(16))>initial,'wrapped text also grows');
    const capped=await draft(Array(30).fill('Строка').join('\n'));assert.ok(capped<250);assert.equal(await evaluate('getComputedStyle(__draftNode).overflowY'), 'auto');
    await evaluate('__draftNode.focus();__draftNode.setSelectionRange(3,3)');await send('Emulation.setDeviceMetricsOverride',{width:393,height:470,deviceScaleFactor:1,mobile:true});await settle();
    assert.equal(await evaluate('document.getElementById("msgDraft").selectionStart'),3);
    assert.equal(await evaluate('document.querySelector(".msg-compose").getBoundingClientRect().bottom<=innerHeight+1'),true,'composer above keyboard');
    await send('Emulation.setDeviceMetricsOverride',{width:393,height:852,deviceScaleFactor:1,mobile:true});await settle();assert.ok(await draft('Коротко')<=initial+2);
    await draft('Сохранённый\nчерновик');await click('[data-action="msg-back"]');await click('[data-action="msg-open"]');await wait('document.querySelector("#msgDraft")');assert.equal(await evaluate('document.getElementById("msgDraft").value'),'Сохранённый\nчерновик');
    await screenshot('composer-'+source);await draft('');await click('[data-action="msg-back"]');
  }
  // Each role opens an existing document. Media is an independent top layer,
  // never a replacement of the defect sheet or its unsent draft.
  for(const role of ['mp','executor','tech']){
    await click('[data-view="'+role+'"]');await wait('document.querySelector("[data-action=open-defect-chat]")');await click('[data-action="open-defect-chat"]');await wait('document.querySelector(".defect-history .entry")');
    assert.equal(await evaluate('Boolean(document.querySelector("[data-action=select-defect-forward]"))'),role==='mp');
    assert.equal(await evaluate('Boolean(document.querySelector("[data-action=verify-defect-entry]"))'),role==='tech');
    await evaluate('window.__historyNode=document.querySelector(".defect-history");document.getElementById("defectText").value="Unsent defect draft";document.getElementById("sheetBody").scrollTop=140;window.__sheetTop=document.getElementById("sheetBody").scrollTop');
    const before=calls.filter(x=>x.path.endsWith('/defects/start')).length;
    for(const index of [1,2]){
      await click('[data-action="defect-media"][data-index="'+index+'"]');await wait('document.querySelector("#documentMediaViewer[open]")');
      if(index===1)await click('#documentMediaViewer button');else assert.equal(await evaluate('ITUS_BACK()'),true);
      await settle();assert.equal(await evaluate('__historyNode===document.querySelector(".defect-history")'),true);
      assert.equal(await evaluate('document.getElementById("defectText").value'),'Unsent defect draft');
      assert.equal(await evaluate('Math.abs(document.getElementById("sheetBody").scrollTop-__sheetTop)<2'),true);
      assert.equal(await evaluate('document.getElementById("overlay").classList.contains("hidden")'),false);
    }
    assert.equal(calls.filter(x=>x.path.endsWith('/defects/start')).length,before,'closing media never reloads/creates a document');
    await click('#closeSheetButton');
  }
  await click('[data-view="mp"]');await click('[data-action="open-defect-chat"]');await wait('document.querySelector("[data-action=select-defect-forward]")');
  await click('[data-action="select-defect-forward"][data-index="0"]');await click('[data-action="select-defect-forward"][data-index="1"]');
  await evaluate('window.__historyNode=document.querySelector(".defect-history");document.getElementById("defectText").value="Keep this draft";document.getElementById("sheetBody").scrollTop=160');
  await click('[data-action="defect-media"][data-index="1"]');await wait('document.querySelector("#documentMediaViewer[open]")');await click('#documentMediaViewer button');
  assert.equal(await evaluate('document.querySelectorAll("[data-action=select-defect-forward]:checked").length'),2);
  await click('[data-action="defect-forward"]');await wait('document.querySelector("[data-forward-action=topics]")');
  assert.equal(held.length,0);await click('[data-forward-action="topics"]');await wait('document.querySelectorAll("[data-forward-action=recipient]").length===2');
  assert.equal(await evaluate('document.querySelector("[data-forward-action=send]")===null'),true,'no implicit recipient');
  await click('[data-forward-action="recipient"][data-ref="client-two"]');assert.equal(held.length,0);
  await evaluate('(()=>{const button=document.querySelector("[data-forward-action=send]");button.click();button.click();})()');
  await wait('!document.querySelector("#defectForwardDialog").open');
  for(let n=0;n<160&&held.length<2;n++)await new Promise(r=>setTimeout(r,25));assert.equal(held.length,2);
  const saved=await queue();assert.equal(saved.length,2,'entire mixed package saved before HTTP response');
  assert.equal(new Set(saved.map(x=>x.requestId)).size,2);assert.equal(new Set(saved.map(x=>x.body.clientMessageId)).size,2);
  assert.ok(saved.every(x=>x.body.topicRef==='client-two'&&x.scope.includes('111')));
  assert.equal(saved.find(x=>x.body.text).body.text,'Synthetic defect 0');
  assert.equal(saved.find(x=>x.body.file).body.file.contentBase64,image,'photo bytes are not recompressed');
  assert.equal(saved.find(x=>x.body.file).body.file.fileName,'original.png');
  const attachment=calls.filter(x=>x.path.endsWith('/media/attachment')).at(-1).body;
  assert.equal(attachment.route,'/defects/start');assert.equal(attachment.envelope.orderRef,'order-one');assert.equal(attachment.envelope.documentRef,'defect-one');assert.equal(attachment.envelope.attachmentRef,'photo-ref');assert.equal(attachment.envelope.entryRef,'photo-entry');
  assert.ok(saved.every(x=>!('authorName' in x.body)&&!('documentRef' in x.body)));
  assert.equal(await evaluate('document.getElementById("defectText").value'),'Keep this draft');
  assert.equal(await evaluate('__historyNode===document.querySelector(".defect-history")'),true);
  assert.equal(await evaluate('document.querySelectorAll("[data-action=select-defect-forward]:checked").length'),0);
  assert.equal(calls.filter(x=>/\/(entries\/add|complete|entries\/verify)$/.test(x.path)).length,0,'forwarding cannot alter the source document');
  await screenshot('defect-selection-saved');for(const response of held)response.end('{"success":true,"data":{}}');
  await wait('document.querySelector("[data-defect-forward-count]").textContent.includes("0")');
  // Preparation failure must never enqueue the earlier text part. Retrying
  // within this confirmation keeps the same IDs; switching owner cancels it.
  await evaluate(`window.__fakeContext={session:{scope:'test|owner',generation:1},orderRef:'o',documentRef:'d',orderNumber:'TEST',entries:[{entryRef:'e',text:'Selected',type:'photo',file:{fileName:'photo.png',mimeType:'image/png'}}]};window.__prepCalls=0;window.__enqueued=[];window.__forwardIds=[];window.__testForward=ITUS_DEFECT_FORWARDING.create({id:()=>{const id='id-'+(__forwardIds.length+1);__forwardIds.push(id);return id;},context:()=>__fakeContext,valid:c=>c===__fakeContext,topics:async()=>[{ref:'client',title:'Synthetic client'}],photo:async(c,e,s,id)=>{__prepCalls++;if(__prepCalls===1)throw Error('Synthetic read failure');return {fileName:'photo.png',contentBase64:'YQ==',clientFileId:id};},enqueue:async(c,items)=>{__enqueued.push(items);},toast(){}});__testForward.toggle(0,true);__testForward.open();`);
  await click('#defectForwardDialog[open] [data-forward-action="topics"]');await wait('document.querySelector("#defectForwardDialog[open] [data-forward-action=recipient]")');await click('#defectForwardDialog[open] [data-forward-action="recipient"]');await click('#defectForwardDialog[open] [data-forward-action="send"]');await wait('document.querySelector("#defectForwardDialog[open] [role=alert]")');
  assert.equal(await evaluate('__enqueued.length'),0);const ids=await evaluate('__forwardIds.slice()');
  await click('#defectForwardDialog[open] [data-forward-action="send"]');await wait('__enqueued.length===1');const forwarded=await evaluate('__enqueued[0]');assert.equal(forwarded.length,2);assert.equal(forwarded[0].clientMessageId,ids[0]);assert.equal(forwarded[0].requestId,ids[1]);assert.equal(forwarded[1].file.clientFileId,ids[2]);
  await evaluate('__testForward.toggle(0,true);__testForward.open();__fakeContext={...__fakeContext,session:{scope:"test|another",generation:2}}');await click('#defectForwardDialog[open] [data-forward-action="topics"]');await wait('document.querySelector("#defectForwardDialog[open] [role=alert]")');assert.equal(await evaluate('__enqueued.length'),1);await evaluate('__testForward.close()');
  console.log('Chat/defect browser: both composers grow/shrink and preserve cursor/history/draft; media retains document in MP/executor/tech; explicit client forwarding saves exact selected bytes once, preserves IDs on preparation failure and blocks owner changes.');
  await send('Browser.close');socket.close();
}finally{socket?.close();child.kill();for(const response of held)response.destroy();server.closeAllConnections();server.close();try{rmSync(profile,{recursive:true,force:true,maxRetries:3,retryDelay:100});}catch{}}
