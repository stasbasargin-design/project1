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
  res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.png':'image/png'}[extname(file)]||'text/plain'));res.end(file.endsWith(join('assets','app.js'))?readFileSync(file,'utf8').replace('  if (state.userId) initialize();','  window.__connectionFixture={call:call1C};\n  if (state.userId) initialize();'):readFileSync(file));
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

  await send('Page.enable');await send('Page.addScriptToEvaluateOnNewDocument',{source:"window.__ITUS_API_BASE__=location.origin+'/api/1c';window.__testOnline=true;window.__network={type:'wifi',connected:true,validated:true,generation:1};window.__nativeCalls=[];const underlyingFetch=window.fetch.bind(window);window.fetch=async(url,options)=>{if(String(url).includes('/api/1c/')&&/\\/(auth\\/max|orders\\/(list|get|search)|notifications\\/poll|internal-chat\\/groups\\/list|internal-chat\\/messages\\/list)$/.test(String(url)))throw new TypeError('Failed to fetch: synthetic WebView failure');return underlyingFetch(url,options)};window.Capacitor={isNativePlatform:()=>true,getPlatform:()=> 'android',Plugins:{Environment:{setPushContext:async()=>{}},Connection:{status:async()=>__network,addListener:async(name,fn)=>{window.__networkListener=fn;return {remove(){}}},cancel:async()=>{},read:async options=>{__nativeCalls.push(options.url);if(!__testOnline)throw Object.assign(new Error('offline'),{code:'NETWORK_OFFLINE'});const response=await underlyingFetch(options.url,{method:options.url.endsWith('/environments/config')?'GET':'POST',headers:options.headers,body:options.url.endsWith('/environments/config')?undefined:options.body});return {id:options.id,status:response.status,headers:Object.fromEntries(response.headers),body:await response.text(),network:__network}}}}};localStorage.setItem('itus.environment:'+location.origin,'test');"});
  await send('Page.navigate',{url:'http://127.0.0.1:'+server.address().port+'/'});await wait('#authUserId');
  await evaluate('document.getElementById("authUserId").value="111"');await click('[data-action="login"]');await wait('#orderSearch');
  assert.equal(await evaluate('ITUS_CONNECTION_CLIENT.native'),true);
  await click('[data-view="chat"]');await wait('[data-action="msg-open"]');await click('[data-action="msg-open"]');await wait('#msgDraft');await settle();
  await click('[data-action="msg-attach"]');await wait('[data-action="msg-file"]');await click('[data-action="msg-file"]');
  await evaluate("(()=>{const input=document.getElementById('filePicker'),transfer=new DataTransfer();transfer.items.add(new File(['immutable upload'],'pending.txt',{type:'text/plain'}));input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()");
  for(let n=0;n<100&&!held.length;n++)await new Promise(r=>setTimeout(r,50));assert.equal(held.length,1);
  const saved=await queues(),writes=calls.filter(c=>/\/(files\/send|messages\/send|entries\/add|complete)$/.test(c.path));assert.equal(saved.length,1);assert.equal(writes.length,1);
  await evaluate('document.getElementById("msgDraft").value="Сохранить мой черновик";document.getElementById("msgDraft").dispatchEvent(new Event("input",{bubbles:true}));window.__testOnline=false;window.__network={type:"none",connected:false,validated:false,generation:2};window.__networkListener({...__network,reason:"network"});');
  const failed=await evaluate('window.__connectionFixture.call("/orders/list",{status:"active"},{silent:true}).then(()=>"unexpected",e=>e.code)');assert.equal(failed,'NETWORK_OFFLINE');
  const before=calls.filter(c=>c.path.endsWith('/orders/list')).length;
  await evaluate('window.__testOnline=true;window.__network={type:"cellular",connected:true,validated:true,generation:3};window.__networkListener({...__network,reason:"network"});');
  for(let n=0;n<160;n++){await settle();if(await evaluate('!ITUS_CONNECTION_CLIENT.recovering()'))break;}
  assert.equal(await evaluate('ITUS_CONNECTION_CLIENT.recovering()'),false);assert.equal(await evaluate('ITUS_CONNECTION_CLIENT.snapshot().type'),'cellular');
  assert.ok(calls.filter(c=>c.path.endsWith('/orders/list')).length>before,'orders read restores automatically');
  assert.equal(await evaluate('document.getElementById("msgDraft").value'),'Сохранить мой черновик','draft survives recovery');
  assert.deepEqual(await queues(),saved,'pending file identity is immutable across network restoration');
  assert.equal(calls.filter(c=>/\/(files\/send|messages\/send|entries\/add|complete)$/.test(c.path)).length,1,'no file, message or document replay');
  assert.equal(await evaluate('__nativeCalls.some(x=>/\\/(files|complete|entries)/.test(x))'),false);
  held[0].end(JSON.stringify({success:true,data:{}}));await settle();
  console.log('Android browser journey: broken WebView fetch, native login/config/orders/chat, offline → mobile automatic recovery, preserved draft and one in-flight file with unchanged IDs passed');
  await send('Browser.close');socket.close();
}finally{socket?.close();child.kill();for(const response of held)response.destroy();server.close();try{rmSync(profile,{recursive:true,force:true,maxRetries:3,retryDelay:100});}catch{}}
