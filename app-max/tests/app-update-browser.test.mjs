import assert from 'node:assert/strict';import {readFileSync,existsSync,mkdtempSync,rmSync,writeFileSync,mkdirSync} from 'node:fs';
import {createServer} from 'node:http';import {spawn} from 'node:child_process';import {join,resolve,extname} from 'node:path';import {tmpdir} from 'node:os';import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url)),calls=[],held=[];
const server=createServer(async(req,res)=>{
  const path=new URL(req.url,'http://local.test').pathname;
  if(path.includes('/api/')){
    let raw='';for await(const c of req)raw+=c;let body={};try{body=JSON.parse(raw||'{}');}catch{}calls.push({path,body});let data={};
    if(path.endsWith('/environments/config'))data={test:true,production:true,isolatedPush:true};
    else if(path.endsWith('/push/web/config'))data={enabled:false};
    else if(path.endsWith('/auth/max'))data={user:{name:'Synthetic employee',roleName:'admin'},availableTabs:['orders','mp','executor','tech','chat']};
    else if(path.endsWith('/orders/list'))data={orders:[{orderRef:'synthetic-order',orderNumber:'Synthetic order'}]};
    else if(path.endsWith('/groups/list'))data={groups:[{groupRef:'synthetic-group',title:'Передача смены',isCommon:true}]};
    else if(path.endsWith('/messages/list'))data={messages:[]};
    else if(path.endsWith('/contacts/list'))data={contacts:[]};
    else if(path.endsWith('/media/session'))data={token:'a'.repeat(64),expires:Date.now()+3600000};
    else if(path.endsWith('/push/installation'))data={enabled:false};
    else if(path.endsWith('/notifications/poll'))data={events:[],unreadCount:0};
    else if(path.endsWith('/files/send')){held.push(res);return;}
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify({success:true,data}));return;
  }
  const file=path==='/'?join(root,'index.html'):resolve(root,'.'+path);
  if(!file.startsWith(root)||!existsSync(file)){res.writeHead(404).end();return;}
  res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.png':'image/png'}[extname(file)]||'text/plain'));
  const content=readFileSync(file);res.end(file.endsWith(join('assets','app.js'))?content.toString().replace('  if (state.userId) initialize();',"  window.__updateGate=()=>({busy:state.busy,queueResume:Boolean(queueResumeJob),requests:sessionRequests.size,pendingActions:[...pendingActions],operations:state.queuedOperations,overlay:$('overlay').className});\n  if (state.userId) initialize();"):content);
});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=[process.env.CHROME_PATH,'/usr/bin/google-chrome','/usr/bin/chromium','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean).find(existsSync);assert.ok(browser);
const profile=mkdtempSync(join(tmpdir(),'imax-update-browser-')),child=spawn(browser,['--headless=new','--disable-gpu','--no-first-run','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:['ignore','ignore','pipe']});let socket,stderr='';child.stderr.on('data',b=>stderr+=b);
try{
  const portFile=join(profile,'DevToolsActivePort');for(let n=0;n<200&&!existsSync(portFile);n++)await new Promise(r=>setTimeout(r,50));assert.ok(existsSync(portFile),stderr);
  const port=readFileSync(portFile,'utf8').split('\n')[0],pages=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();socket=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);await new Promise((r,j)=>{socket.onopen=r;socket.onerror=j;});
  let sequence=0;const waiting=new Map();socket.onmessage=e=>{const m=JSON.parse(e.data),w=waiting.get(m.id);if(!w)return;waiting.delete(m.id);clearTimeout(w.timer);m.error?w.reject(Error(JSON.stringify(m.error))):w.resolve(m.result);};
  const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>reject(Error('Browser timeout '+method)),15000);waiting.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));});
  const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
  const wait=expression=>evaluate('new Promise((resolve,reject)=>{const t=setInterval(()=>{if('+expression+'){clearInterval(t);resolve(true)}},25);setTimeout(()=>{clearInterval(t);reject(Error("Missing state: "+'+JSON.stringify(expression)+'+JSON.stringify(window.__updateGate?.())))},8000)})');
  const click=selector=>evaluate('document.querySelector('+JSON.stringify(selector)+').click()');
  const queue=()=>evaluate("new Promise((resolve,reject)=>{const r=indexedDB.open('itus-operation-queue');r.onsuccess=()=>{const db=r.result,q=db.transaction('operations','readonly').objectStore('operations').getAll();q.onsuccess=()=>{resolve(q.result.map(x=>({id:x.id,requestId:x.requestId,body:x.body,scope:x.scope})));db.close()};q.onerror=()=>reject(q.error)}})");
  await send('Page.enable');await send('Emulation.setDeviceMetricsOverride',{width:393,height:852,deviceScaleFactor:1,mobile:true});await send('Page.addScriptToEvaluateOnNewDocument',{source:`window.__ITUS_API_BASE__=location.origin+'/api/1c';window.__updateNotes=['<img src=x onerror="window.UNSAFE=true">Обновления'];window.__updates={checks:0,downloads:0,installs:0,permission:false};window.Capacitor={isNativePlatform:()=>true,getPlatform:()=> 'android',Plugins:{Environment:{setPushContext:async()=>{}},AppUpdate:{check:async()=>{__updates.checks++;return {available:true,version:'2.9.1',versionCode:2901,bytes:1024,notes:__updateNotes};},download:()=>{__updates.downloads++;return new Promise((resolve,reject)=>{window.__finishDownload=resolve;window.__failDownload=reject;});},install:async()=>{__updates.installs++;return {status:__updates.permission?'installer_opened':'permission_required'};},addListener:async(name,fn)=>{window.__updateProgress=fn;return {remove(){}};}}}};localStorage.setItem('itus.environment:'+location.origin,'test');`});
  await send('Page.navigate',{url:'http://127.0.0.1:'+server.address().port+'/'});await wait('document.querySelector("#authUserId")');
  assert.equal(await evaluate('__updates.checks'),0,'no update/identity calls before login');
  await evaluate('document.getElementById("authUserId").value="111"');await click('[data-action="login"]');await wait('document.querySelector("#orderSearch")');await wait('document.querySelector("#appUpdateDialog[open]")');
  assert.equal(await evaluate('__updates.checks'),1);assert.equal(await evaluate('Boolean(window.UNSAFE)'),false);assert.equal(await evaluate('document.querySelector("#appUpdateDialog img")!==null'),false,'release notes are plain text');
  await evaluate('__updateNotes.splice(0,1,"Обновление приложения напрямую с Timeweb")');
  await click('[data-update-primary]');await click('[data-update-primary]');assert.equal(await evaluate('__updates.downloads'),1,'double click joins one download');
  await evaluate('__updateProgress({received:512,total:1024})');assert.equal(await evaluate('document.querySelector("#appUpdateDialog progress").value'),50);
  await click('[data-update-close]');await click('[data-view="chat"]');await wait('document.querySelector("[data-action=msg-open]")');await click('[data-action="msg-open"]');await wait('document.querySelector("#msgDraft")');
  await click('[data-action="msg-attach"]');await wait('document.querySelector("[data-action=msg-file]")');await click('[data-action="msg-file"]');
  await evaluate("(()=>{const input=document.getElementById('filePicker'),t=new DataTransfer();t.items.add(new File(['immutable data'],'fixture.txt',{type:'text/plain'}));input.files=t.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()");
  for(let n=0;n<120&&!held.length;n++)await new Promise(r=>setTimeout(r,50));assert.equal(held.length,1);
  const before=await queue();assert.equal(before.length,1);
  await evaluate('__finishDownload({ready:true})');await click('#userPanel');await wait('document.querySelector("[data-action=check-app-update]")');await click('[data-action="check-app-update"]');await wait('document.querySelector("#appUpdateDialog[open]")');
  await click('[data-update-primary]');await wait('document.querySelector("[data-update-status]").textContent.includes("активную отправку")');assert.equal(await evaluate('__updates.installs'),0,'installer blocked by in-flight file');assert.deepEqual(await queue(),before,'all operation IDs and payload remain unchanged');
  held[0].end('{"success":true,"data":{}}');await wait('!document.querySelector(".is-pending")');
  await click('[data-update-close]');await evaluate('document.getElementById("msgDraft").value="Черновик, который нельзя потерять"');
  await click('#userPanel');await click('[data-action="check-app-update"]');await click('[data-update-primary]');await wait('document.querySelector("[data-update-status]").textContent.includes("редактор")');assert.equal(await evaluate('__updates.installs'),0,'draft preserved before installation');
  await evaluate('document.getElementById("msgDraft").value=""');await wait('__updateGate().requests===0&&!__updateGate().queueResume&&__updateGate().pendingActions.length===0');await click('[data-update-primary]');await wait('__updates.installs===1');await wait('document.querySelector("[data-update-status]").textContent.includes("Разрешите установку")');
  await evaluate('__updates.permission=true');await click('[data-update-primary]');await wait('__updates.installs===2');await wait('document.querySelector("[data-update-status]").textContent.includes("системном окне")');
  assert.equal(calls.filter(x=>x.path.endsWith('/auth/max')).length,1,'updating never reauthenticates 1C');
  assert.equal(calls.filter(x=>/\/(files\/send|messages\/send|entries\/add|complete)$/.test(x.path)).length,1,'only the intentional file was sent, no write replay');
  if(process.env.UPDATE_ARTIFACT_DIR){mkdirSync(process.env.UPDATE_ARTIFACT_DIR,{recursive:true});writeFileSync(join(process.env.UPDATE_ARTIFACT_DIR,'update-dialog.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));}
  assert.equal(await evaluate('ITUS_BACK()'),true);assert.equal(await evaluate('document.querySelector("#appUpdateDialog").open'),false,'Android Back closes updater before other navigation');
  await evaluate(`(async()=>{ITUS_APP_UPDATE_CLIENT.destroy();Capacitor.Plugins.AppUpdate.check=async()=>{throw Object.assign(Error('offline'),{code:'UPDATE_NETWORK_ERROR'})};window.__isolatedUpdater=ITUS_APP_UPDATE.create();await __isolatedUpdater.check();})()`);
  assert.equal(await evaluate('document.querySelector("#appUpdateDialog")===null'),true,'unavailable update server does not block the app');
  await evaluate('__isolatedUpdater.check({manual:true})');await wait('document.querySelector("[data-update-status]").textContent.includes("интернет")');
  await evaluate(`(async()=>{__isolatedUpdater.destroy();Capacitor.Plugins.AppUpdate.check=async()=>({available:false,installedCode:2900});window.__isolatedUpdater=ITUS_APP_UPDATE.create();await __isolatedUpdater.check({manual:true});})()`);
  assert.equal(await evaluate('document.querySelector("[data-update-status]").textContent.includes("актуальная")'),true);
  await evaluate(`(async()=>{__isolatedUpdater.destroy();Capacitor.Plugins.AppUpdate.check=async()=>({available:true,version:'2.9.1',versionCode:2901,bytes:1024,notes:[]});Capacitor.Plugins.AppUpdate.download=async()=>{throw Object.assign(Error('hash'),{code:'UPDATE_HASH_MISMATCH'})};window.__isolatedUpdater=ITUS_APP_UPDATE.create();await __isolatedUpdater.check({manual:true});})()`);
  await click('[data-update-primary]');await wait('document.querySelector("[data-update-status]").textContent.includes("повреждён")');assert.equal(await evaluate('document.querySelector("[data-update-primary]").disabled'),false,'download can be retried after failure');
  assert.equal(await evaluate('__updates.installs'),2,'damaged download cannot launch installer');
  await evaluate('__isolatedUpdater.destroy()');
  console.log('Update browser journey: automatic/manual checks, safe release notes, progress, background UI, duplicate click, intact queue/draft, install permission and no 1C replay passed.');
  await send('Browser.close');socket.close();
}finally{socket?.close();child.kill();for(const response of held)response.destroy();server.closeAllConnections();server.close();try{rmSync(profile,{recursive:true,force:true,maxRetries:3,retryDelay:100});}catch{}}
