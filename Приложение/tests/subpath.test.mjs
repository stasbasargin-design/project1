import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const upstream=http.createServer(async(req,res)=>{let raw='';for await(const c of req)raw+=c;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({success:true,path:req.url,body:JSON.parse(raw),token:req.headers['x-itus-token']}));});
upstream.listen(0,'127.0.0.1');await once(upstream,'listening');
const child=spawn(process.execPath,[new URL('../server.mjs',import.meta.url).pathname],{env:{...process.env,PORT:'18082',APP_BASE_PATH:'/p/max-service',ONE_C_TARGET:`http://127.0.0.1:${upstream.address().port}/mock-service`,ONE_C_TOKEN:'test-only-token'},stdio:['ignore','pipe','pipe']});
const previewChild=spawn(process.execPath,[new URL('../server.mjs',import.meta.url).pathname],{env:{...process.env,PORT:'18083',CODESPACE_NAME:'preview-demo',ONE_C_TARGET:`http://127.0.0.1:${upstream.address().port}/mock-service`,ONE_C_TOKEN:'test-only-token'},stdio:['ignore','pipe','pipe']});
try{
 await new Promise((resolve,reject)=>{child.stdout.on('data',c=>{if(String(c).includes('ИТУС запущен'))resolve();});child.once('exit',()=>reject(Error('Server exited')));});
 await new Promise((resolve,reject)=>{previewChild.stdout.on('data',c=>{if(String(c).includes('ИТУС запущен'))resolve();});previewChild.once('exit',()=>reject(Error('Server exited')));});
 const root='http://127.0.0.1:18082';
 const previewRoot='http://127.0.0.1:18083';
 let r=await fetch(root+'/p/max-service?max_user_id=123',{redirect:'manual'});assert.equal(r.status,308);assert.equal(r.headers.get('location'),'/p/max-service/?max_user_id=123');
 r=await fetch(previewRoot+'/?max_user_id=123',{redirect:'manual'});assert.equal(r.status,200);
 for(const base of ['/','/p/max-service/']){
  r=await fetch(root+base);assert.equal(r.status,200);const html=await r.text();assert.match(html,/modern.css/);assert.match(html,/itus-logo.png/);
  for(const file of ['assets/app.css','assets/modern.css','assets/app.js','assets/api-normalizers.js','assets/itus-logo.png','config/itus.config.js']){r=await fetch(root+base+file);assert.equal(r.status,200,file);assert.notEqual(r.headers.get('content-type'),'text/html; charset=utf-8');}
  r=await fetch(root+base+'api/1c/orders/list',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:'123'})});const data=await r.json();assert.equal(data.path,'/mock-service/orders/list');assert.equal(data.body.userId,'123');assert.equal(data.token,'test-only-token');
  const scope={window:{},document:{baseURI:root+base},URL};vm.runInNewContext(readFileSync(new URL('../config/itus.config.js',import.meta.url),'utf8'),scope);assert.equal(scope.window.ITUS_CONFIG.ONE_C_API_BASE_URL,base+'api/1c');
 }
 const legacyScope={window:{},document:{baseURI:root+'/p/max-service'},URL};vm.runInNewContext(readFileSync(new URL('../config/itus.config.js',import.meta.url),'utf8'),legacyScope);assert.equal(legacyScope.window.ITUS_CONFIG.ONE_C_API_BASE_URL,'/p/max-service/api/1c');
 r=await fetch(root+'/p/max-service/assets/missing.js');assert.equal(r.status,404);
 r=await fetch(root+'/p/max-service/health');assert.equal((await r.json()).success,true);
 r=await fetch(previewRoot+'/health');assert.equal((await r.json()).success,true);
 console.log('Subpath: OK (root and nested assets, redirect/query, API proxy, server-only token, health, missing asset 404).');
}finally{child.kill();previewChild.kill();upstream.close();}
