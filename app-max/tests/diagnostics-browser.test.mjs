import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync,existsSync,mkdtempSync,rmSync,mkdirSync,writeFileSync} from 'node:fs';
import {mkdtemp,rm} from 'node:fs/promises';
import {join,resolve,extname} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {createDiagnostics,hashDiagnosticPassword} from '../diagnostics-server.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),folder=await mkdtemp(join(tmpdir(),'imax-diagnostic-ui-')),out=process.env.DIAGNOSTICS_ARTIFACT_DIR||join(tmpdir(),'imax-diagnostics-ui');mkdirSync(out,{recursive:true});
const password='Synthetic-browser-fixture-288',authorization='Basic '+Buffer.from('fixture:'+password).toString('base64');
const diag=createDiagnostics({env:{DIAGNOSTICS_STATE_DIR:folder,DIAGNOSTICS_ADMIN_USER:'fixture',DIAGNOSTICS_ADMIN_PASSWORD_HASH:await hashDiagnosticPassword(password),DIAGNOSTICS_INGEST_SECRET:'local-browser-fixture-'.repeat(3)}});await diag.initialization;
for(const [userId,name,environment,platform,error] of [['111','Тестовый сотрудник А','production','android',true],['111','Тестовый сотрудник А','production','web',false],['222','<img src=x onerror="window.__injected=true">','test','web',true]]){
 const token=diag.mint({userId},{success:true,data:{user:{name,employeeRef:'synthetic-'+userId}}},environment);
 await diag.ingest(diag.owner(token,environment),{installationId:randomUUID(),platform,browser:platform==='android'?'WebView':'Yandex',os:platform==='android'?'Android 16':'Windows',version:'i-max-2.8.8',ready:true,uiBlocked:platform==='android',queue:{pending:platform==='android'?3:0,failed:0},lastRequest:{route:'/orders/list',status:error?0:200,ok:!error,code:error?'NETWORK_FETCH_FAILED':'',durationMs:error?35000:280},lastSuccess:{route:'/orders/list',status:200,ok:true,durationMs:280},events:error?[{id:randomUUID(),kind:'network-error',route:'/orders/list',status:0,code:'NETWORK_FETCH_FAILED',durationMs:35000}]:[]});
}
diag.observe('production','/orders/get',200,300,{applicationSuccess:false,code:'VALIDATION_ERROR'});
const server=createServer(async(req,res)=>{
 const path=new URL(req.url,'http://local.test').pathname.replace(/^\/p\/max-service/,'')||'/';
 const json=(response,status,data)=>{response.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});response.end(JSON.stringify(data));};
 if(await diag.handle(req,res,path,{environment:'test',basePath:'/p/max-service',json,allowOrigin(){},servePanel(){res.setHeader('Content-Type','text/html');res.end(readFileSync(join(root,'diagnostics.html')));}}))return;
 const file=resolve(root,'.'+path);if(!file.startsWith(root)||!existsSync(file)){res.writeHead(404).end();return;}
 res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.png':'image/png'}[extname(file)]||'text/plain'));res.end(readFileSync(file));
});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=[process.env.CHROME_PATH,'/usr/bin/google-chrome','/usr/bin/chromium','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean).find(existsSync);assert.ok(browser);
const profile=mkdtempSync(join(tmpdir(),'imax-diag-browser-')),child=spawn(browser,['--headless=new','--disable-gpu','--no-first-run','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:'ignore'});let socket;
try{
 const file=join(profile,'DevToolsActivePort');for(let n=0;n<200&&!existsSync(file);n++)await new Promise(r=>setTimeout(r,50));assert.ok(existsSync(file));
 const port=readFileSync(file,'utf8').split('\n')[0],pages=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();socket=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);await new Promise((r,j)=>{socket.onopen=r;socket.onerror=j;});
 let seq=0;const waiting=new Map();socket.onmessage=e=>{const m=JSON.parse(e.data),w=waiting.get(m.id);if(!w)return;waiting.delete(m.id);clearTimeout(w.timer);m.error?w.reject(Error(JSON.stringify(m.error))):w.resolve(m.result);};
 const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq,timer=setTimeout(()=>reject(Error('Browser timeout '+method)),15000);waiting.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));});
 const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
 const wait=async expression=>{for(let n=0;n<200;n++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,30));}throw Error('UI condition failed '+expression);};
 await send('Page.enable');await send('Network.enable');await send('Network.setExtraHTTPHeaders',{headers:{Authorization:authorization}});
 await send('Page.addScriptToEvaluateOnNewDocument',{source:"Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>{window.__copied=text}}});"});
 await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});await send('Page.navigate',{url:'http://127.0.0.1:'+server.address().port+'/p/max-service/diagnostics/'});
 await wait('document.querySelectorAll("#devices tr").length===2');assert.equal(await evaluate('document.getElementById("total").textContent'),'2');assert.equal(await evaluate('document.getElementById("errors").textContent'),'1');
 writeFileSync(join(out,'dashboard-desktop.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
 await evaluate('document.getElementById("environment").value="";document.getElementById("environment").dispatchEvent(new Event("change"))');await wait('document.querySelectorAll("#devices tr").length===3');
 await evaluate('document.getElementById("search").value="222";document.getElementById("search").dispatchEvent(new Event("input"))');await wait('document.querySelectorAll("#devices tr").length===1');assert.equal(await evaluate('window.__injected===true'),false);
 await evaluate('document.querySelector("#devices button").click()');await wait('document.getElementById("details").open');await evaluate('document.getElementById("copyReport").click()');await wait('typeof window.__copied==="string"');assert.ok((await evaluate('window.__copied')).includes('NETWORK_FETCH_FAILED'));assert.equal((await evaluate('window.__copied')).includes('password'),false);
 await evaluate('document.getElementById("closeDetails").click();document.getElementById("search").value="";document.getElementById("search").dispatchEvent(new Event("input"))');
 await send('Emulation.setDeviceMetricsOverride',{width:393,height:852,deviceScaleFactor:1,mobile:true});assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true);
 writeFileSync(join(out,'dashboard-phone.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
 await send('Browser.close');socket.close();console.log('Diagnostics browser: protected UI, distinct devices, contour/search filters, XSS-safe names, report copy and responsive layout passed (synthetic data only)');
}finally{socket?.close();child.kill();server.close();await diag.close();await rm(folder,{recursive:true,force:true});try{rmSync(profile,{recursive:true,force:true,maxRetries:3,retryDelay:100});}catch{}}
