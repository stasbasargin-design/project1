import {existsSync,mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {join} from 'node:path';import {tmpdir} from 'node:os';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('../',import.meta.url));
const home=[process.env.JAVA_HOME,'C:/Users/sab/.cursor/projects/project1/app-max/android-build/temurin-jdk21/jdk-21.0.12.1+1'].filter(Boolean).find(p=>existsSync(join(p,'bin',process.platform==='win32'?'javac.exe':'javac')));
const executable=name=>home?join(home,'bin',name+(process.platform==='win32'?'.exe':'')):name;
const folder=mkdtempSync(join(tmpdir(),'imax-native-read-'));
try{
 const native=join(root,'android/app/src/main/java/ru/eazia/imax/NativeReadTransport.java');
 let result=spawnSync(executable('javac'),['-d',folder,native,join(root,'tests/fixtures/NativeReadTransportTest.java')],{encoding:'utf8',windowsHide:true,timeout:30000});assert.equal(result.status,0,result.stderr||String(result.error));
 result=spawnSync(executable('java'),['-cp',folder,'ru.eazia.imax.NativeReadTransportTest'],{encoding:'utf8',windowsHide:true,timeout:30000});assert.equal(result.status,0,result.stderr||String(result.error));console.log(result.stdout.trim());
 const plugin=readFileSync(join(root,'android/app/src/main/java/ru/eazia/imax/ConnectionPlugin.java'),'utf8');
 assert.ok(plugin.includes('registerDefaultNetworkCallback'));assert.ok(plugin.includes('network.openConnection(url)'));assert.equal(/getSSID|getBSSID|ACCESS_FINE_LOCATION|bindProcessToNetwork|TrustAll|HostnameVerifier/.test(plugin),false);
}finally{rmSync(folder,{recursive:true,force:true});}
