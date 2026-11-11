import assert from 'node:assert/strict';
import {readFileSync,existsSync,mkdtempSync,rmSync} from 'node:fs';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {join,resolve,extname} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url)),calls=[],held=[];
const nativeBridge=process.argv.includes('--native-bridge');
const server=createServer(async(req,res)=>{
  const path=new URL(req.url,'http://local.test').pathname;
  if(path.includes('/api/')){
    const environment=path.startsWith('/contours/production/')?'production':'test';
    let raw='';for await(const c of req)raw+=c;let body={};try{body=JSON.parse(raw||'{}');}catch{}
    calls.push({environment,path,body});res.setHeader('Content-Type','application/json');let data={};
    if(path.endsWith('/environments/config'))data={test:true,production:true,isolatedPush:true};
    else if(path.endsWith('/push/web/config'))data={enabled:false,publicKey:''};
    else if(path.endsWith('/auth/max'))data={user:{name:'Synthetic '+environment,employeeRef:'employee-'+environment,roleName:'admin'},availableTabs:['orders','mp','executor','tech','clients','chat']};
    else if(path.endsWith('/orders/list'))data={orders:[{orderRef:'same-order',orderNumber:environment+'-order'}]};
    else if(path.endsWith('/groups/list'))data={groups:[{groupRef:'same-group',title:'Передача смены',isCommon:true,subtitle:environment}]};
    else if(path.endsWith('/contacts/list'))data={contacts:[]};
    else if(path.endsWith('/topics/list'))data={topics:[]};
    else if(path.endsWith('/messages/list'))data={messages:[{messageRef:'same-message',text:environment+' message',authorName:'Synthetic',createdAt:'2026-11-11T06:00:00Z'}]};
    else if(path.endsWith('/notifications/poll'))data={events:[],unreadCount:0};
    else if(path.endsWith('/media/session'))data={token:(environment==='test'?'a':'b').repeat(64),expires:Date.now()+3600000};
    else if(path.endsWith('/push/installation'))data={enabled:false};
    else if(path.endsWith('/files/send')){held.push(res);return;}
    res.end(JSON.stringify({success:true,data}));return;
  }
  const file=path==='/'?join(root,'index.html'):resolve(root,'.'+path);
  if(!file.startsWith(root)||!existsSync(file)){res.writeHead(404).end();return;}
  res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.png':'image/png'}[extname(file)]||'text/plain'));res.end(readFileSync(file));
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=[process.env.CHROME_PATH,'/usr/bin/google-chrome','/usr/bin/chromium','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean).find(existsSync);assert.ok(browser);
const profile=mkdtempSync(join(tmpdir(),'imax-environment-browser-'));
const child=spawn(browser,['--headless=new','--disable-gpu','--no-first-run','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:['ignore','ignore','pipe']});
let socket;
try{
  const portFile=join(profile,'DevToolsActivePort');for(let n=0;n<200&&!existsSync(portFile);n++)await new Promise(r=>setTimeout(r,50));assert.ok(existsSync(portFile));
  const port=readFileSync(portFile,'utf8').split('\n')[0],pages=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();
  socket=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);await new Promise((r,j)=>{socket.onopen=r;socket.onerror=j;});
  let sequence=0;const waiting=new Map();socket.onmessage=e=>{const message=JSON.parse(e.data),call=waiting.get(message.id);if(!call)return;waiting.delete(message.id);clearTimeout(call.timer);message.error?call.reject(Error(JSON.stringify(message.error))):call.resolve(message.result);};
  const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>reject(Error('Browser timeout '+method)),15000);waiting.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));});
  const evaluate=async expression=>{const response=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(response.exceptionDetails)throw Error(JSON.stringify(response.exceptionDetails));return response.result.value;};
  const wait=selector=>evaluate('new Promise((resolve,reject)=>{const t=setInterval(()=>{if(document.querySelector('+JSON.stringify(selector)+')){clearInterval(t);resolve(true)}},25);setTimeout(()=>{clearInterval(t);reject(Error("Missing selector "+'+JSON.stringify(selector)+'))},8000)})');
  const click=selector=>evaluate('document.querySelector('+JSON.stringify(selector)+').click()');
  const settle=()=>evaluate('new Promise(resolve=>setTimeout(resolve,100))');
  const queues=()=>evaluate("new Promise((resolve,reject)=>{const request=indexedDB.open('itus-operation-queue');request.onsuccess=()=>{const db=request.result,tx=db.transaction('operations','readonly'),read=tx.objectStore('operations').getAll();read.onsuccess=()=>{resolve(read.result.map(x=>({id:x.id,scope:x.scope,requestId:x.requestId,clientMessageId:x.body.clientMessageId})));db.close()};read.onerror=()=>reject(read.error)}})");
  async function switchTo(id,label){
    await click('#userPanel');await wait('#environmentChoice');
    await evaluate('document.getElementById("environmentChoice").value='+JSON.stringify(id)+';document.querySelector('+JSON.stringify('[data-action="switch-environment"]')+').click()');
    for(let n=0;n<160;n++){
      try{
        await settle();
        if(await evaluate('document.getElementById("environmentBadge")?.textContent==='+JSON.stringify(label)+'&&Boolean(document.getElementById("orderSearch"))'))return;
      }catch(error){if(!/navigated|context.*destroyed|Cannot find context/.test(error.message))throw error;}
      await new Promise(resolve=>setTimeout(resolve,30));
    }
    throw Error('Environment switch failed '+id);
  }
  async function openChat(){
    await click('[data-view="chat"]');await settle();
    if(await evaluate('Boolean(document.querySelector('+JSON.stringify('[data-action="msg-source"][data-source="staff"]')+'))'))await click('[data-action="msg-source"][data-source="staff"]');
    try{await wait('[data-action="msg-open"]');}catch(error){console.error(await evaluate('document.getElementById("app").textContent'),calls.map(c=>c.path));throw error;}
    await click('[data-action="msg-open"]');await wait('#msgDraft');await wait('.msg-text');await settle();return evaluate('document.querySelector(".msg-history").textContent');
  }
  await send('Page.enable');
  await send('Page.addScriptToEvaluateOnNewDocument',{source:nativeBridge?
    "window.__ITUS_API_BASE__=location.origin+'/api/1c';window.__NATIVE_PUSH_CONTEXTS__=JSON.parse(localStorage.getItem('test.native.push-contexts')||'[]');window.Capacitor={isNativePlatform:()=>true,getPlatform:()=> 'android',Plugins:{Environment:{setPushContext:async value=>{window.__NATIVE_PUSH_CONTEXTS__.push(value);localStorage.setItem('test.native.push-contexts',JSON.stringify(window.__NATIVE_PUSH_CONTEXTS__))}}}};if(!localStorage.getItem('itus.environment:'+location.origin))localStorage.setItem('itus.environment:'+location.origin,'test');":
    "if(!localStorage.getItem('itus.environment:'))localStorage.setItem('itus.environment:','test');"});
  await send('Page.navigate',{url:'http://127.0.0.1:'+server.address().port+'/'});await wait('#authUserId');
  await evaluate('document.getElementById("authUserId").value="111"');await click('[data-action="login"]');await wait('#orderSearch');
  assert.ok((await openChat()).includes('test message'));
  await click('[data-action="msg-attach"]');await wait('[data-action="msg-file"]');await click('[data-action="msg-file"]');
  await evaluate("(()=>{const input=document.getElementById('filePicker'),transfer=new DataTransfer();transfer.items.add(new File(['retained file'],'offline.txt',{type:'text/plain'}));input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()");
  for(let n=0;n<100&&!held.length;n++)await new Promise(r=>setTimeout(r,50));assert.equal(held.length,1);
  const saved=await queues();assert.equal(saved.length,1);assert.equal(saved[0].requestId,calls.find(c=>c.path.endsWith('/files/send')).body.requestId);
  await switchTo('production','БОЕВАЯ 1С');
  if(nativeBridge){
    assert.equal(await evaluate('typeof Capacitor.registerPlugin'),'undefined');
    assert.equal(await evaluate("JSON.stringify(__NATIVE_PUSH_CONTEXTS__.at(-1))"),JSON.stringify({environment:'test',enabled:false,activationId:''}));
  }
  assert.deepEqual(await queues(),saved,'switch preserves original file and IDs');
  const productionHistory=await openChat();assert.ok(productionHistory.includes('production message'));assert.ok(!productionHistory.includes('test message'));
  assert.equal(calls.filter(c=>c.environment==='production'&&c.path.endsWith('/files/send')).length,0);
  await switchTo('test','ТЕСТОВАЯ 1С');assert.ok((await openChat()).includes('test message'));
  if(nativeBridge)assert.equal(await evaluate("JSON.stringify(__NATIVE_PUSH_CONTEXTS__.at(-1))"),JSON.stringify({environment:'production',enabled:false,activationId:''}));
  assert.deepEqual(await queues(),saved);assert.equal(calls.filter(c=>c.environment==='production'&&c.path.endsWith('/files/send')).length,0);
  console.log((nativeBridge?'Android injected bridge':'Environment browser')+': test → production → test, same-ID chats separated and pending file retained with original IDs passed');
  await send('Browser.close');socket.close();
}finally{socket?.close();child.kill();for(const response of held)response.destroy();server.close();try{rmSync(profile,{recursive:true,force:true,maxRetries:3,retryDelay:100});}catch{}}
