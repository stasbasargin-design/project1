import assert from 'node:assert/strict';
import {readFileSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {writeBuildInfo} from '../scripts/write-build-info.mjs';

const version=JSON.parse(readFileSync(new URL('../package.json',import.meta.url))).version;
const lock=JSON.parse(readFileSync(new URL('../package-lock.json',import.meta.url)));
const app=readFileSync(new URL('../assets/app.js',import.meta.url),'utf8');
const gradle=readFileSync(new URL('../android/app/build.gradle',import.meta.url),'utf8');
assert.equal(lock.version,version);assert.equal(lock.packages[''].version,version);
assert.ok(app.includes(`version: 'i-max-${version}'`));assert.ok(gradle.includes(`versionName "${version}"`));
const temp=mkdtempSync(join(tmpdir(),'imax-build-test-'));
const before=process.env.IMAX_BUILD_SHA;
try {
  process.env.IMAX_BUILD_SHA='a'.repeat(40);
  assert.deepEqual(writeBuildInfo(temp),{version,commit:'a'.repeat(40)});
  assert.equal(JSON.parse(readFileSync(join(temp,'build-info.json'))).commit,'a'.repeat(40));
  process.env.IMAX_BUILD_SHA='wrong-revision';assert.throws(()=>writeBuildInfo(temp),/Invalid build commit/);
} finally {if(before===undefined)delete process.env.IMAX_BUILD_SHA;else process.env.IMAX_BUILD_SHA=before;rmSync(temp,{recursive:true,force:true});}

const child=spawn(process.execPath,[fileURLToPath(new URL('../server.mjs',import.meta.url))],{env:{...process.env,PORT:'18137',LISTEN_HOST:'127.0.0.1',MAX_REQUEST_BYTES:'256',ONE_C_TARGET:'http://127.0.0.1:1',LOG_PROXY_REQUESTS:'false'},stdio:['ignore','pipe','pipe']});
let logs='';child.stderr.on('data',c=>logs+=c);
try {
  await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('Server startup timed out')),10000);child.stdout.on('data',c=>{if(String(c).includes('ИТУС запущен')){clearTimeout(timeout);resolve();}});child.once('exit',()=>{clearTimeout(timeout);reject(Error('Server exited: '+logs));});});
  const health=await (await fetch('http://127.0.0.1:18137/health')).json();assert.equal(health.success,true);assert.equal(typeof health.version,'string');assert.equal(typeof health.commit,'string');
  const response=await fetch('http://127.0.0.1:18137/api/1c/defects/entries/add',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({synthetic:'x'.repeat(1024)})});
  assert.equal(response.status,413);assert.equal((await response.json()).error.code,'REQUEST_TOO_LARGE');
  assert.equal((await fetch('http://127.0.0.1:18137/health')).status,200,'oversized upload must not crash server');
} finally {child.kill();}
console.log('Release contract: synchronized versions, immutable build identity, safe 413, health OK.');
