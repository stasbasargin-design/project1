import assert from 'node:assert/strict';import {existsSync,mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {join} from 'node:path';import {tmpdir} from 'node:os';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const home=[process.env.JAVA_HOME,'C:/Users/sab/.cursor/projects/project1/app-max/android-build/temurin-jdk21/jdk-21.0.12.1+1'].filter(Boolean).find(p=>existsSync(join(p,'bin',process.platform==='win32'?'javac.exe':'javac')));
const exe=name=>home?join(home,'bin',name+(process.platform==='win32'?'.exe':'')):name,folder=mkdtempSync(join(tmpdir(),'imax-updater-native-'));
try{
  let result=spawnSync(exe('javac'),['-d',folder,join(root,'android/app/src/main/java/ru/eazia/imax/UpdatePolicy.java'),join(root,'tests/fixtures/UpdatePolicyTest.java')],{encoding:'utf8',timeout:30000,windowsHide:true});assert.equal(result.status,0,result.stderr||String(result.error));
  result=spawnSync(exe('java'),['-cp',folder,'ru.eazia.imax.UpdatePolicyTest'],{encoding:'utf8',timeout:30000,windowsHide:true});assert.equal(result.status,0,result.stderr||String(result.error));console.log(result.stdout.trim());
  const plugin=readFileSync(join(root,'android/app/src/main/java/ru/eazia/imax/AppUpdatePlugin.java'),'utf8');
  for(const guard of ['canRequestPackageInstalls','ACTION_MANAGE_UNKNOWN_APP_SOURCES','getPackageArchiveInfo','getApkContentsSigners','setInstanceFollowRedirects(false)','verifyArchive(ready,release)','UPDATE_HASH_MISMATCH','compareAndSet(false,true)'])assert.ok(plugin.includes(guard),guard);
  assert.equal(/TrustAll|HostnameVerifier|INSTALL_PACKAGES"|UPDATE_PACKAGES_WITHOUT_USER_ACTION|Runtime\.getRuntime|\.exec\(/.test(plugin),false);
}finally{rmSync(folder,{recursive:true,force:true});}
