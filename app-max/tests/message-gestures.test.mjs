import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
function fixture(){
  const handlers=new Map(),timers=new Map(),calls=[];let timer=0;
  const target={addEventListener(name,fn){const list=handlers.get(name)||[];list.push(fn);handlers.set(name,list);},removeEventListener(){}};
  const node={style:{setProperty(){},removeProperty(){}},classList:{add(){},remove(){}},contains(other){return other===node;},closest(selector){return selector==='message'?node:null;}};
  const scope={document:{...target,hidden:false},...target,Date,setTimeout(fn){timers.set(++timer,fn);return timer;},clearTimeout(id){timers.delete(id);}};
  vm.runInNewContext(readFileSync(new URL('../assets/message-gestures.js',import.meta.url),'utf8'),scope);
  scope.ITUS_MESSAGE_GESTURES.create({selector:'message',resolve:()=>({id:'original'}),hold:ctx=>calls.push(['hold',ctx.id]),reply:ctx=>calls.push(['reply',ctx.id])});
  function emit(name,values={}){const event={target:node,clientX:140,clientY:100,pointerId:1,isPrimary:true,button:0,cancelable:true,detail:1,preventDefault(){this.prevented=true;},stopImmediatePropagation(){this.stopped=true;},...values};for(const fn of handlers.get(name)||[])fn(event);return event;}
  return {emit,calls,node,scope,fire(){for(const [id,fn] of [...timers]){timers.delete(id);fn();}}};
}
{
  const f=fixture();f.emit('pointerdown');f.emit('pointermove',{clientX:65});f.emit('pointerup',{clientX:65});f.fire();
  assert.deepEqual(f.calls,[['reply','original']]);assert.equal(f.emit('click').stopped,true);
}
for(const move of [{clientX:220},{clientY:150},{clientX:130,clientY:120}]){
  const f=fixture();f.emit('pointerdown');f.emit('pointermove',move);f.fire();f.emit('pointerup',move);assert.equal(f.calls.length,0,'scroll/right swipe never replies');
}
{
  const f=fixture();f.emit('pointerdown');f.fire();f.emit('pointerup');assert.deepEqual(f.calls,[['hold','original']]);
  const dialogControl={};assert.equal(f.emit('click',{target:dialogControl}).stopped,true,'release cannot click the newly opened menu');
  f.emit('pointerdown',{target:{closest:()=>null}});assert.equal(f.emit('click',{target:dialogControl}).stopped,undefined,'intentional next tap works');
}
for(const stop of ['pointercancel','lostpointercapture','scroll','blur']){
  const f=fixture();f.emit('pointerdown');f.emit(stop);f.fire();f.emit('pointerup');assert.equal(f.calls.length,0,stop);
}
{
  const f=fixture();f.emit('pointerdown');f.emit('pointerdown',{pointerId:2,isPrimary:false});f.fire();assert.equal(f.calls.length,0,'second finger cancels');
  f.emit('pointerdown');f.scope.document.hidden=true;f.emit('visibilitychange');f.fire();assert.equal(f.calls.length,0);
}
{
  const f=fixture();f.emit('contextmenu');f.emit('keydown',{key:'F10',shiftKey:true});assert.equal(f.calls.length,2,'desktop alternatives');
  const input={closest:selector=>selector==='message'?f.node:{}};f.emit('pointerdown',{target:input});f.fire();assert.equal(f.calls.length,2,'inputs keep native editing');
}
console.log('Message gestures: left swipe once, hold/release, next tap, scroll/input/cancel/multitouch and desktop controls passed.');
