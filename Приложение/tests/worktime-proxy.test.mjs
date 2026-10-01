import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
const received=[];
const upstream=http.createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;received.push({path:req.url,body:JSON.parse(body),headers:req.headers});res.setHeader('Content-Type','application/json');res.end(JSON.stringify({success:true,data:{valid:true,package:{packageRef:'created'}}}));});
upstream.listen(0,'127.0.0.1');await once(upstream,'listening');
const child=spawn(process.execPath,[fileURLToPath(new URL('../server.mjs',import.meta.url))],{env:{...process.env,PORT:'18084',APP_BASE_PATH:'/p/max-service',ONE_C_TARGET:`http://127.0.0.1:${upstream.address().port}`,LOG_PROXY_REQUESTS:'false'},stdio:['ignore','pipe','pipe']});
try{
 await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('Startup timeout')),10000);child.stdout.on('data',c=>{if(String(c).includes('ИТУС запущен')){clearTimeout(timeout);resolve();}});child.once('exit',()=>{clearTimeout(timeout);reject(Error('Server exited'));});});
 const send=(path,body)=>fetch('http://127.0.0.1:18084/p/max-service/api/1c'+path,{method:'POST',headers:{'Content-Type':'application/json','X-ITUS-Request-Id':'test-trace'},body:JSON.stringify(body)});
 const valid={orderRef:'order',workshopRef:'shop',workRefs:['row'],participants:[{employeeRef:'self',percent:60},{employeeRef:'colleague',percent:40}],clientPackageId:'stable',max:{userId:'123'}};
 for(const body of [{...valid,participants:[{employeeRef:'self',percent:99}]},{...valid,workRefs:[]},{...valid,participants:[{employeeRef:'self',percent:50},{employeeRef:'self',percent:50}]}]){const r=await send('/worktime/packages/create',body);assert.equal(r.status,400);assert.equal((await r.json()).error.code,'VALIDATION_ERROR');}
 assert.equal(received.length,0);
 for(const path of ['/worktime/orders/works','/worktime/executors/list','/worktime/participation/validate','/worktime/packages/create']) assert.equal((await send(path,valid)).status,200);
 assert.deepEqual(received.at(-1).body,valid);assert.equal(received.at(-1).headers['x-itus-request-id'],'test-trace');
 assert.equal((await send('/worktime/packages/start',{orderRef:'order'})).status,400);
 assert.equal((await send('/worktime/packages/start',{orderRef:'order',packageRef:'created'})).status,200);
 console.log('Worktime proxy: OK — invalid requests never reach upstream; valid body, MAX context and request header preserved.');
}finally{child.kill();upstream.close();}
