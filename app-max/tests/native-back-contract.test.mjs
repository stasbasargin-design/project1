import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const activity=readFileSync(new URL('../android/app/src/main/java/ru/eazia/imax/MainActivity.java',import.meta.url),'utf8');
const manifest=readFileSync(new URL('../android/app/src/main/AndroidManifest.xml',import.meta.url),'utf8');
assert.match(activity,/getOnBackPressedDispatcher\(\)\.addCallback\(this, new OnBackPressedCallback\(true\)/);
assert.match(activity,/void handleOnBackPressed\(\)/);
assert.doesNotMatch(activity,/void onBackPressed\(\)/,'targetSdk 36 must not depend on the removed legacy callback');
assert.match(activity,/window\.ITUS_BACK\?\.\(\) === true/);
assert.match(activity,/!"true"\.equals\(handled\)/,'unhandled navigation must have a system fallback');
assert.match(activity,/setEnabled\(false\);[\s\S]*getOnBackPressedDispatcher\(\)\.onBackPressed\(\);[\s\S]*setEnabled\(true\);/,'fallback must not call its own enabled callback recursively');
assert.doesNotMatch(manifest,/enableOnBackInvokedCallback="false"/,'do not disable predictive Back to hide integration failures');

const app=readFileSync(new URL('../assets/app.js',import.meta.url),'utf8');
const start=app.indexOf('  function closeFocusedEditor()');
const end=app.indexOf('  window.ITUS_NATIVE_PUSH?.listen?.',start);
assert.ok(start>=0&&end>start);
let focused=null,sheetOpen=false,threadOpen=false,view='chat';
const calls=[];
const context={window:{},document:{get activeElement(){return focused;}},
  $:()=>({classList:{contains:()=>!sheetOpen}}),
  closeSheet(){sheetOpen=false;calls.push('sheet');},
  messenger:{back(){if(!threadOpen)return false;threadOpen=false;calls.push('thread');return true;}},
  firstMainView:()=> 'orders',state:{get view(){return view;}},setView(next){view=next;calls.push(next);}};
vm.runInNewContext(app.slice(start,end),context);
focused={matches:()=>true,blur(){focused=null;calls.push('keyboard');}};sheetOpen=true;threadOpen=true;
assert.equal(context.window.ITUS_BACK(),true);assert.deepEqual(calls,['keyboard']);
assert.equal(context.window.ITUS_BACK(),true);assert.deepEqual(calls,['keyboard','sheet']);
assert.equal(context.window.ITUS_BACK(),true);assert.deepEqual(calls,['keyboard','sheet','thread']);
assert.equal(context.window.ITUS_BACK(),true);assert.deepEqual(calls,['keyboard','sheet','thread','orders']);
context.window.ITUS_BACK();assert.equal(calls.length,4,'root Back must not replay navigation');
console.log('Android Back: supported lifecycle callback, guarded system fallback, keyboard/sheet/thread/section routing OK.');
