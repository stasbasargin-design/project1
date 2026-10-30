import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
const url=new URL('./acceptance-regression.test.mjs',import.meta.url);
let fixture=fs.readFileSync(url,'utf8').split('const app=context.testApp;')[0];
fixture=fixture.replace(/^import .*;\r?\n/gm,'').replaceAll('import.meta.url',JSON.stringify(url.href));
fixture=fixture.replace('firstMainView};','firstMainView,setAuth,operationQueue,queueScope,pendingActions,pendingActionButtons,choosePost,setPost,closeSheet,call1C};');
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const setup=`const app=context.testApp;app.setAuth('111','manual');app.state.user={name:'Synthetic A'};app.state.orders=[context.ITUS_API.mapOrder(order)];app.state.selectedOrderId='test-order';
function button(action,extra={}){return {dataset:{action,...extra},disabled:false,isConnected:true,setAttribute(){},removeAttribute(){},classList:{add(){},remove(){}}};}
function click(b){return handlers.click({target:{closest:()=>b}});}
`;
async function check(body){await new AsyncFunction('assert','fs','vm','webcrypto',fixture+setup+body)(assert,fs,vm,webcrypto);}
await check(`
 const first=button('load-order');await click(first);await click(button('load-order'));await click(button('load-order'));
 assert.equal(calls.filter(x=>x.url.endsWith('/orders/get')).length,3);assert.equal(app.pendingActions.size,0);assert.equal(first.disabled,false);
 let count=0;context.fetch=async()=>{count++;throw Error('Synthetic transport error');};
 await click(button('load-order'));await click(button('load-order'));assert.equal(count,2);assert.equal(app.pendingActions.size,0);
`);
await check(`
 let release;const wait=new Promise(r=>release=r);let count=0;
 context.fetch=async()=>{count++;await wait;return {ok:true,status:200,text:async()=>JSON.stringify({success:true,data:{order}})};};
 const old=button('load-order'),pending=click(old);await Promise.resolve();old.isConnected=false;
 await click(button('load-order'));assert.equal(count,1);release();await pending;
 assert.equal(app.pendingActions.size,0);assert.equal(app.pendingActionButtons.has(old),false);
 await click(button('load-order'));assert.equal(count,2);
`);
for(const spec of [{action:'start-quality',type:'qualityControl',complete:'complete-quality',view:'tech'},{action:'start-executor-work',type:'checklist',complete:'complete-checklist',view:'executor'}])await check(`
 const spec=${JSON.stringify(spec)};app.state.view=spec.view;
 context.fetch=async()=>({ok:true,status:200,text:async()=>JSON.stringify({success:true,data:{[spec.type]:{documentRef:'ready-doc',form:{fields:[{id:'note',required:false,value:'ready'}]},survey:{questions:[]}}}})});
 await click(button(spec.action));assert.equal(app.state.busy,false);
 const buttons=[...element('app').innerHTML.matchAll(/<button[^>]*>/g)].map(x=>x[0]).filter(x=>x.includes('data-action="'+spec.complete+'"'));
 assert.ok(buttons.length);assert.ok(buttons.every(x=>!x.includes('disabled')));
`);
await check(`
 let release;const wait=new Promise(r=>release=r),writes=[];
 app.state.orders.push(context.ITUS_API.mapOrder({...order,orderRef:'other-order'}));
 context.fetch=async(url,options)=>{const body=JSON.parse(options.body);if(url.endsWith('/resources/posts/list')){if(body.orderRef==='test-order')await wait;return {ok:true,status:200,text:async()=>JSON.stringify({success:true,data:{posts:[{postRef:body.orderRef==='test-order'?'post-A':'post-B',name:'Post',available:true}]}})};}writes.push(body);return {ok:true,status:200,text:async()=>JSON.stringify({success:true,data:{}})};};
 const pending=app.choosePost();app.closeSheet();app.state.selectedOrderId='other-order';await app.choosePost();release();await pending;
 assert.match(element('sheetBody').innerHTML,/post-B/);assert.doesNotMatch(element('sheetBody').innerHTML,/post-A/);
 await app.setPost('post-B','Post');assert.equal(writes[0].orderRef,'other-order');
`);
await check(`
 let starts=0;context.fetch=async(url)=>{let data={order};if(url.endsWith('/defects/start')){starts++;data={documentRef:'def-1',entries:[{entryRef:'entry-'+starts,type:'text',text:'Version '+starts}]};}return {ok:true,status:200,text:async()=>JSON.stringify({success:true,data})};};
 await click(button('open-defect-chat'));app.closeSheet();await click(button('open-defect-chat'));
 assert.equal(starts,2);assert.equal(app.currentOrder()._defectSheet.entries[0].text,'Version 2');
`);
await check(`
 const bodies=[];context.fetch=async(_url,options)=>{bodies.push(JSON.parse(options.body));return {ok:false,status:422,text:async()=>JSON.stringify({success:false,error:{code:'SYNTHETIC_REJECTION'}})};};
 const op=await app.operationQueue.prepare({id:'retry',scope:app.queueScope(),method:'/defects/entries/add',requestId:'request-stable',body:{documentRef:'def-1',clientEntryId:'entry-stable',entry:{type:'text',text:'Value'}},kind:'entry',documentKey:'def-1'});
 await assert.rejects(app.operationQueue.run(op.id));app.setAuth('111','max');await assert.rejects(app.operationQueue.run(op.id,{manual:true}));
 assert.deepEqual(bodies[0],bodies[1],'wire body must remain unchanged after reauthentication');
`);
console.log('Stability journeys: repeat success/error, detached DOM, in-flight click, ready forms, stale dialog, defect refresh and immutable retry passed');
