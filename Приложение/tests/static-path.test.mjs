import assert from 'node:assert/strict';
import {win32,posix} from 'node:path';
import {resolvePublicPath} from '../static-path.mjs';
for (const [paths,root] of [[win32,'C:\\Users\\sab\\Версия 1.6\\dist'],[posix,'/opt/itus max/dist'],[win32,'\\\\server\\share\\ИТУС\\dist']]) {
 for (const [url,parts] of [['/',['index.html']],['/index.html',['index.html']],['/assets/app.js',['assets','app.js']],['/config/itus.config.js',['config','itus.config.js']],['/assets/%D1%84%D0%BE%D1%82%D0%BE.png',['assets','фото.png']]]) {
  assert.equal(resolvePublicPath(root,url,paths),paths.resolve(root,...parts));
 }
 for (const url of ['/../ADMIN_KEY.txt','/%2e%2e/secret','/assets/../../secret','/..%5csecret','/C:/secret','/assets/app.js:secret','/file%00.js','/%broken','/server.mjs'])assert.equal(resolvePublicPath(root,url,paths),null,url);
}
const winRoot='C:\\Users\\sab\\Версия 1.6\\dist';
assert.equal(win32.resolve(winRoot,'index.html').startsWith(winRoot+'/'),false); // Original regression reproduced.
console.log('Static paths: OK — original Windows failure reproduced; corrected Windows, UNC and Linux paths; traversal and protected files blocked.');
