import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync,mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {join,extname,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';

const browser=[process.env.CHROME_PATH,'/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser','C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean).find(existsSync);
if(!browser)throw new Error('Layout browser test requires Chrome/Chromium/Edge; set CHROME_PATH.');
const root=fileURLToPath(new URL('../',import.meta.url));
const html=readFileSync(join(root,'index.html'),'utf8').replace('<script src="./config/itus.config.js">','<script src="./assets/preview-fixtures.js"></script><script src="./config/itus.config.js">');
const artifactDir=process.env.LAYOUT_ARTIFACT_DIR&&resolve(process.env.LAYOUT_ARTIFACT_DIR);
if(artifactDir)mkdirSync(artifactDir,{recursive:true});
const server=createServer((req,res)=>{
  const path=new URL(req.url,'http://localhost').pathname;
  const file=path==='/'?null:join(root,path);
  if(file&&(!file.startsWith(root)||!existsSync(file))){res.writeHead(404);res.end();return;}
  res.setHeader('Content-Type',file?({'.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.png':'image/png'}[extname(file)]||'text/plain'):'text/html; charset=utf-8');
  res.end(file?readFileSync(file):html);
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const profile=mkdtempSync(join(tmpdir(),'imax-layout-'));
const child=spawn(browser,['--headless=new','--disable-gpu','--disable-gpu-compositing','--no-first-run','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{windowsHide:true,stdio:['ignore','ignore','pipe']});
let stderr='',socket;
child.stderr.on('data',c=>stderr+=c.toString());
try{
  const portFile=join(profile,'DevToolsActivePort');
  for(let n=0;n<200&&!existsSync(portFile);n++){if(child.exitCode!==null)throw new Error('Headless browser exited: '+stderr);await new Promise(r=>setTimeout(r,50));}
  assert.ok(existsSync(portFile),'headless browser did not start');
  const debugPort=readFileSync(portFile,'utf8').split('\n')[0];
  const pages=await(await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
  const page=pages.find(p=>p.type==='page');assert.ok(page,'browser page missing');
  socket=new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r,j)=>{socket.onopen=r;socket.onerror=j;});
  let sequence=0;const waiting=new Map(),loaded=new Set();
  socket.onmessage=e=>{const m=JSON.parse(e.data);if(m.method==='Page.lifecycleEvent'&&m.params.name==='load')loaded.add(m.params.loaderId);if(m.id){const w=waiting.get(m.id);if(!w)return;waiting.delete(m.id);clearTimeout(w.timer);m.error?w.reject(new Error(JSON.stringify(m.error))):w.resolve(m.result);}};
  const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence;const timer=setTimeout(()=>{waiting.delete(id);reject(new Error('CDP timeout: '+method));},10000);waiting.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));});
  const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
  const settle=()=>evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  const waitFor=selector=>evaluate(`new Promise((r,j)=>{const t=setInterval(()=>{if(document.querySelector(${JSON.stringify(selector)})){clearInterval(t);r(true)}},20);setTimeout(()=>{clearInterval(t);j(new Error('Missing '+${JSON.stringify(selector)}))},3000)})`);
  const navigate=async url=>{const {loaderId}=await send('Page.navigate',{url});for(let n=0;n<200&&!loaded.has(loaderId);n++)await new Promise(r=>setTimeout(r,25));assert.ok(loaded.has(loaderId),'new document did not load');};
  const snap=()=>evaluate(`(()=>{const box=s=>{const e=document.querySelector(s);if(!e)return null;const r=e.getBoundingClientRect(),c=getComputedStyle(e);return {x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom,right:r.right,display:c.display};};return {width:innerWidth,height:innerHeight,scrollY,scrollHeight:document.documentElement.scrollHeight,scrollWidth:document.documentElement.scrollWidth,header:box('.top'),logo:box('.logo'),nav:box('#tabs'),phone:box('.phone'),app:box('#app'),frame:box('.messenger'),history:box('.msg-history'),compose:box('.msg-compose')};})()`);
  const screenshot=async name=>{if(!artifactDir)return;const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});writeFileSync(join(artifactDir,name+'.png'),Buffer.from(shot.data,'base64'));};
  const visibleNavigation=(m,label)=>{assert.equal(m.nav.display,'flex',label+' navigation hidden');assert.ok(m.nav.y>=m.header.bottom-1,label+' tabs overlap header');assert.ok(m.nav.bottom<=m.phone.bottom+1,label+' tabs below viewport');assert.ok(m.scrollWidth<=m.width+1,label+' horizontal document overflow');};
  await send('Page.enable');await send('Page.setLifecycleEventsEnabled',{enabled:true});await send('Network.enable');await send('Network.setBlockedURLs',{urls:['https://*']});
  const results=[];
  for(const [width,height] of [[360,852],[393,852],[800,852],[1200,852],[852,393]]){
    const label=width+'x'+height;
    await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true});
    await navigate(`http://127.0.0.1:${server.address().port}/?role=master`);
    await waitFor('#orderSearch');await settle();const normal=await snap();visibleNavigation(normal,label+' normal');
    await evaluate(`(()=>{const d=document.createElement('div');d.id='long-test-list';d.style.height='1600px';document.querySelector('.phone').appendChild(d);scrollTo(0,400)})()`);await settle();
    const scrolled=await snap();visibleNavigation(scrolled,label+' scrolled');
    assert.ok(Math.abs(scrolled.nav.y-scrolled.header.bottom)<2,label+' tabs did not stay under fixed header');
    await screenshot('navigation-'+label);
    await evaluate(`document.getElementById('long-test-list').remove();scrollTo(0,0);document.querySelector('[data-view="chat"]').click()`);
    await waitFor('.msg-thread');await settle();const list=await snap();visibleNavigation(list,label+' list');
    assert.ok(Math.abs(normal.app.width-list.app.width)<1,label+' shell width jumps entering chats');
    if(height<560){
      const reachable=await evaluate(`(()=>{const side=document.querySelector('.msg-sidebar');side.scrollTop=side.scrollHeight;const r=document.querySelector('.msg-thread').getBoundingClientRect(),s=side.getBoundingClientRect();return r.bottom>s.y&&r.y<s.bottom;})()`);
      assert.ok(reachable,label+' short viewport makes conversations unreachable');
    }
    await evaluate(`document.querySelector('[data-action="msg-open"]').click()`);await waitFor('.msg-compose');await settle();
    const conversation=await snap();visibleNavigation(conversation,label+' conversation');
    assert.ok(conversation.scrollHeight<=height+1,label+' outer document overflow');
    assert.ok(conversation.compose.bottom<=height+1,label+' composer outside viewport');
    assert.ok(conversation.history.height>0,label+' no room for history');
    await evaluate('scrollTo(0,200)');await settle();assert.equal((await snap()).scrollY,0,label+' chat scrolls the document');
    await screenshot('chat-'+label);
    results.push({label,normal,scrolled,list,conversation});
  }
  // WebView safe-area CSS values: no OS required and no mutation of application sources.
  await send('Emulation.setDeviceMetricsOverride',{width:393,height:852,deviceScaleFactor:1,mobile:true});
  await navigate(`http://127.0.0.1:${server.address().port}/?role=master`);await waitFor('#orderSearch');
  await evaluate(`document.documentElement.style.setProperty('--safe-area-inset-top','32px');document.documentElement.style.setProperty('--safe-area-inset-bottom','24px');document.querySelector('[data-view="chat"]').click()`);
  await waitFor('.msg-thread');await evaluate(`document.querySelector('[data-action="msg-open"]').click()`);await waitFor('.msg-compose');await settle();
  const safe=await snap();visibleNavigation(safe,'safe-area');assert.ok(safe.logo.y>=32,'header content under cutout');assert.ok(safe.compose.bottom<=852-24+1,'composer under bottom system bar');assert.equal(safe.scrollHeight,852);
  await screenshot('chat-safe-area-393');results.push({label:'safe-area',safe});
  // Simulate Safari visualViewport keyboard shrink while the layout viewport stays tall.
  await evaluate(`(()=>{const v=new EventTarget();v.height=420;v.offsetTop=24;Object.defineProperty(window,'visualViewport',{configurable:true,value:v});window.dispatchEvent(new Event('resize'));})()`);await settle();
  const keyboard=await snap();visibleNavigation(keyboard,'keyboard');assert.equal(keyboard.phone.y,24);assert.equal(keyboard.phone.height,420);assert.ok(keyboard.compose.bottom<=444-24+1,'keyboard covers composer');assert.ok(keyboard.history.height>0,'keyboard leaves no history');
  await screenshot('chat-keyboard-393');results.push({label:'keyboard',keyboard});
  // Actual settings modal, font controls and long service-history data must never enlarge the viewport.
  for(const width of [360,393,800]){
    await send('Emulation.setDeviceMetricsOverride',{width,height:852,deviceScaleFactor:1,mobile:true});
    await navigate(`http://127.0.0.1:${server.address().port}/?role=executor`);await waitFor('#orderSearch');
    for(const size of ['compact','normal','large','extra']){
      await evaluate(`document.getElementById('userPanel').click()`);await waitFor('#appDisplaySize');
      await evaluate(`(()=>{const el=document.getElementById('appDisplaySize');el.value=${JSON.stringify(size)};el.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('#sheetBody details').open=true;})()`);await settle();
      const modal=await evaluate(`(()=>{const sheet=document.querySelector('.sheet').getBoundingClientRect(),body=document.querySelector('.sheet-body');return {left:sheet.left,right:sheet.right,bottom:sheet.bottom,width:innerWidth,scrollWidth:document.documentElement.scrollWidth,bodyWidth:body.clientWidth,bodyScroll:body.scrollWidth,font:getComputedStyle(document.body).fontSize};})()`);
      assert.ok(modal.left>=0 && modal.right<=width+1,'settings escaped viewport '+width+' '+size);
      assert.ok(modal.scrollWidth<=width+1,'settings expanded document '+width+' '+size);
      assert.ok(modal.bodyScroll<=modal.bodyWidth+1,'settings content overflow '+width+' '+size);
      assert.ok(modal.bottom<=852+1,'settings below screen');
      await screenshot('settings-'+width+'-'+size);
      await evaluate('document.getElementById("closeSheetButton").click()');await settle();
      const before=await snap();await evaluate('scrollTo(0,document.documentElement.scrollHeight)');await settle();
      const after=await snap();assert.ok(Math.abs(before.nav.y-after.nav.y)<1,'tabs drift on scroll '+width+' '+size);
      assert.ok(after.scrollWidth<=width+1,'scaled content expanded document');
      await evaluate('scrollTo(0,0)');
    }
    await evaluate(`(()=>{const old=window.fetch;window.fetch=async(input,options)=>String(input).includes('/quality/service-history')?new Response(JSON.stringify({success:true,data:{visits:[{date:'2026-10-29',orderNumber:'LONG-'+ 'X'.repeat(180),reason:'Причина '.repeat(50),works:[{name:'Работа '.repeat(40)}]}]}}),{status:200,headers:{'Content-Type':'application/json'}}):old(input,options);document.querySelector('[data-view="tech"]').click();})()`);
    await waitFor('[data-action="service-history"]');await evaluate(`document.querySelector('[data-action="service-history"]').click()`);await waitFor('.service-history');await settle();
    assert.ok((await snap()).scrollWidth<=width+1,'service history expanded viewport');await screenshot('service-history-'+width);
    results.push({label:'modal-scale-'+width,verified:true});
    await evaluate(`ITUS_DISPLAY.set('normal')`);
  }
  if(artifactDir)writeFileSync(join(artifactDir,'layout-results.json'),JSON.stringify(results,null,2));
  console.log('Layout browser: shared shell, fixed navigation, portrait/landscape, safe area and keyboard composer OK.');
  await send('Browser.close');socket.close();
}finally{
  socket?.close();child.kill();server.close();
  try{rmSync(profile,{recursive:true,force:true,maxRetries:3,retryDelay:100});}catch{}
}
