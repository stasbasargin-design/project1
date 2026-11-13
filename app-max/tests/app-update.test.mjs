import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync,symlinkSync,unlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';import {createServer} from 'node:http';import {spawn} from 'node:child_process';
const root=fileURLToPath(new URL('../',import.meta.url)),folder=mkdtempSync(join(tmpdir(),'imax-update-server-'));
let upstreamCalls=0;
const upstream=createServer((req,res)=>{upstreamCalls++;res.end('{"success":true,"data":{}}');});
await new Promise(r=>upstream.listen(0,'127.0.0.1',r));
const child=spawn(process.execPath,[join(root,'server.mjs')],{cwd:root,env:{...process.env,PORT:'18149',LISTEN_HOST:'127.0.0.1',APP_BASE_PATH:'/p/max-service',APP_UPDATES_DIR:folder,ONE_C_TARGET:'http://127.0.0.1:'+upstream.address().port,LOG_PROXY_REQUESTS:'false'},stdio:['ignore','pipe','pipe']});
let logs='';child.stderr.on('data',b=>logs+=b);
const base='http://127.0.0.1:18149/p/max-service',request=path=>fetch(base+'/updates/android/'+path);
try{
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Update server startup: '+logs)),12000);child.stdout.on('data',b=>{if(String(b).includes('ИТУС запущен')){clearTimeout(timer);resolve();}});child.once('exit',()=>{clearTimeout(timer);reject(Error(logs));});});
  assert.deepEqual(await(await request('latest.json')).json(),{enabled:false});
  const data=Buffer.from('Synthetic APK transport fixture'),file='I-MAX-2.9.0.apk';writeFileSync(join(folder,file),data);
  const manifest={enabled:true,schema:1,packageName:'ru.eazia.imax',version:'2.9.0',versionCode:2900,fileName:file,
    bytes:data.length,sha256:createHash('sha256').update(data).digest('hex'),signerSha256:'a'.repeat(64),commit:'b'.repeat(40),minSdk:24,notes:['Обновление приложения']};
  const save=value=>writeFileSync(join(folder,'latest.json'),JSON.stringify(value));save(manifest);
  const latest=await request('latest.json');assert.equal(latest.status,200);assert.equal(latest.headers.get('cache-control'),'no-store');assert.deepEqual(await latest.json(),manifest);
  const apk=await request(file);assert.equal(apk.status,200);assert.equal(apk.headers.get('content-type'),'application/vnd.android.package-archive');assert.deepEqual(Buffer.from(await apk.arrayBuffer()),data);
  const head=await fetch(base+'/updates/android/'+file,{method:'HEAD'});assert.equal(head.status,200);assert.equal(head.headers.get('content-length'),String(data.length));assert.equal(await head.text(),'');
  assert.equal((await fetch(base+'/updates/android/latest.json',{method:'POST',body:'{}'})).status,405);
  for(const path of ['../private.env','%2e%2e%2fprivate.env','I-MAX-2.8.9.apk','latest.json.bak'])assert.notEqual((await request(path)).status,200,path);
  for(const patch of [{fileName:'../private.apk'},{packageName:'other.app'},{bytes:data.length+1},{versionCode:0},{sha256:'invalid'},{notes:['x'.repeat(401)]},{enabled:true,schema:2}]){
    save({...manifest,...patch});assert.equal((await request('latest.json')).status,503);assert.equal((await fetch(base+'/health')).status,200);
  }
  save(manifest);unlinkSync(join(folder,file));assert.equal((await request(file)).status,503,'partial publication never serves missing APK');
  writeFileSync(join(folder,'other.apk'),data);
  let linked=false;try{symlinkSync(join(folder,'other.apk'),join(folder,file));linked=true;}catch{}
  if(linked){assert.equal((await request(file)).status,503,'APK symlinks rejected');unlinkSync(join(folder,file));}
  save({enabled:false});assert.equal((await request(file)).status,404);assert.deepEqual(await(await request('latest.json')).json(),{enabled:false});
  assert.equal(upstreamCalls,0,'update checks/downloads never call 1C');
  const response=await fetch(base+'/api/1c/ping',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(response.status,200);assert.equal(upstreamCalls,1,'existing 1C proxy preserved');
  const pkg=JSON.parse(readFileSync(join(root,'package.json'))),lock=JSON.parse(readFileSync(join(root,'package-lock.json')));
  assert.deepEqual(pkg.dependencies,lock.packages[''].dependencies);
  console.log('App updates: subpath, manifest/APK integrity, atomic publication failure, disabled/malformed releases, traversal/symlinks and 1C isolation passed.');
}finally{child.kill();upstream.closeAllConnections();upstream.close();rmSync(folder,{recursive:true,force:true});}
