import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync,mkdtempSync,rmSync,mkdirSync} from 'node:fs';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {join,resolve,extname} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url)),calls=[],held=[];
const image='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6Z1sAAAAASUVORK5CYII=';
const entries=Array.from({length:36},(_,i)=>({entryRef:'entry-'+i,type:'text',text:'Synthetic defect '+i,verified:false}));
entries.splice(1,0,{entryRef:'photo-entry',type:'photo',text:'',file:{fileRef:'photo-ref',fileName:'original.png',mimeType:'image/png',sizeBytes:Buffer.from(image,'base64').length}});
entries.splice(2,0,{entryRef:'video-entry',type:'video',file:{fileRef:'video-ref',fileName:'sample.mp4',mimeType:'video/mp4',contentBase64:'AAAA',sizeBytes:3}});
const order={orderRef:'order-one',orderNumber:'Synthetic order',defectDocumentRef:'defect-one'};
const history=Array.from({length:55},(_,i)=>({messageRef:'message-'+i,text:'Synthetic history line '+i,authorName:'Synthetic author',createdAt:'2026-11-13T08:'+String(i).padStart(2,'0')+':00Z'}));
const staffHistory=history.map(x=>({...x})),reactionResponses=[],historyResponses=[];let muted=[],latestClient='client-one',holdHistory=false;
const server=createServer(async(req,res)=>{
  const path=new URL(req.url,'http://synthetic.invalid').pathname;
  if(path==='/api/media/download/'+'b'.repeat(48)){res.setHeader('Content-Type','image/png');res.end(Buffer.from(image,'base64'));return;}
  if(path.includes('/api/')){
    let raw='';for await(const chunk of req)raw+=chunk;let body={};try{body=JSON.parse(raw||'{}');}catch{}
    calls.push({path,body});let data={};
    if(path.endsWith('/environments/config'))data={test:true,production:true,isolatedPush:true};
    else if(path.endsWith('/push/web/config')||path.endsWith('/push/installation'))data={enabled:false};
    else if(path.endsWith('/auth/max'))data={user:{name:'Synthetic employee',roleName:'admin'},availableTabs:['orders','mp','executor','tech','clients','chat'],chatCapabilities:{internal:{replies:true,reactions:true,reactionEncoding:'code-v1'},clients:{replies:true,reactions:true}}};
    else if(path.endsWith('/orders/list'))data={orders:[order]};
    else if(path.endsWith('/orders/get'))data={order};
    else if(path.endsWith('/defects/start'))data={documentRef:'defect-one',entries};
    else if(path.endsWith('/topics/list'))data={topics:[{topicRef:'client-one',title:'Synthetic client one',orderRef:order.orderRef,orderNumber:order.orderNumber,lastMessageAt:'2026-11-01T10:00:00Z',updatedAt:'2099-01-01T10:00:00Z'},{topicRef:'client-two',title:'Synthetic client two',createdAt:'2099-11-17T10:00:00Z',lastMessageAt:latestClient==='client-two'?'2026-12-01T10:00:00Z':null}]};
    else if(path.endsWith('/groups/list'))data={groups:[{groupRef:'staff-one',title:'Передача смены',isCommon:true}]};
    else if(path.endsWith('/messages/list')){
      data={messages:path.includes('/internal-chat/')?staffHistory:history};
      if(holdHistory){historyResponses.push({res,accept(){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({success:true,data}));},reject(){res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({success:false,error:{message:'Synthetic history failure'}}));}});return;}
    }
    else if(path.endsWith('/contacts/list'))data={contacts:[]};
    else if(path.endsWith('/media/session'))data={token:'a'.repeat(64),expires:Date.now()+3600000};
    else if(path.endsWith('/media/attachment'))data={ticket:'b'.repeat(48)};
    else if(path.endsWith('/notifications/poll'))data={events:[],unreadCount:0};
    else if(path.endsWith('/push/chat-preferences')){
      if(req.method==='POST'){muted=muted.filter(x=>x.source!==body.source||x.ref!==body.ref);if(body.muted)muted.push({source:body.source,ref:body.ref});}
      data={muted};
    }
    else if(path.endsWith('/internal-chat/messages/react')){
      assert.equal(Object.hasOwn(body,'emoji'),false,'raw emoji must never enter 1C reaction request');
      assert.equal(typeof body.emojiCode,'string');assert.match(body.emojiCode,/^[a-z_]*$/);
      const message=staffHistory.find(x=>x.messageRef===body.messageRef),data={messageRef:body.messageRef,myReactionCode:body.emojiCode,reactions:body.emojiCode?[{emojiCode:body.emojiCode,count:1}]:[]};
      // A rejected request does not mutate the mock server's saved history.
      reactionResponses.push({res,data,accept(){Object.assign(message,data);res.end(JSON.stringify({success:true,data}));}});return;
    }
    else if(path.endsWith('/internal-chat/messages/send')){
      const list=staffHistory,original=list.find(x=>x.messageRef===body.replyToMessageRef);
      const message={messageRef:'synthetic-reply',authorName:'Synthetic employee',text:body.text,createdAt:'2026-11-17T11:00:00Z',replyToMessageRef:body.replyToMessageRef,replyTo:original?{messageRef:original.messageRef,authorName:original.authorName,text:original.text}:undefined};
      if(!list.some(x=>x.messageRef===message.messageRef))list.push(message);data={message};
    }
    else if(/\/(files|messages)\/send$/.test(path)){held.push(res);return;}
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify({success:true,data}));return;
  }
  const file=path==='/'?join(root,'index.html'):resolve(root,'.'+path);
  if(!file.startsWith(root)||!existsSync(file)){res.writeHead(404).end();return;}
  res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.png':'image/png'}[extname(file)]||'text/plain'));
  res.end(readFileSync(file));
});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=[process.env.CHROME_PATH,'/usr/bin/google-chrome','/usr/bin/chromium','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean).find(existsSync);assert.ok(browser);
const profile=mkdtempSync(join(tmpdir(),'imax-chat-defect-')),child=spawn(browser,['--headless=new','--disable-gpu','--no-first-run','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:['ignore','ignore','pipe']});let socket,stderr='';child.stderr.on('data',b=>stderr+=b);
try{
  const portFile=join(profile,'DevToolsActivePort');for(let n=0;n<200&&!existsSync(portFile);n++)await new Promise(r=>setTimeout(r,50));assert.ok(existsSync(portFile),stderr);
  const port=readFileSync(portFile,'utf8').split('\n')[0],pages=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();socket=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);await new Promise((r,j)=>{socket.onopen=r;socket.onerror=j;});
  let sequence=0;const waiting=new Map();socket.onmessage=e=>{const m=JSON.parse(e.data),w=waiting.get(m.id);if(!w)return;waiting.delete(m.id);clearTimeout(w.timer);m.error?w.reject(Error(JSON.stringify(m.error))):w.resolve(m.result);};
  const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>reject(Error('Browser timeout '+method)),15000);waiting.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));});
  const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
  const wait=expression=>evaluate('new Promise((resolve,reject)=>{const t=setInterval(()=>{if('+expression+'){clearInterval(t);resolve(true)}},25);setTimeout(()=>{clearInterval(t);reject(Error("Missing state: "+'+JSON.stringify(expression)+'))},8000)})');
  const click=async selector=>{
    const threadAction=['msg-open','msg-source','msg-back'].find(action=>selector.includes(action));
    if(threadAction)await evaluate('window.__lastMessageAction=null');
    await evaluate('document.querySelector('+JSON.stringify(selector)+').click()');
    if(threadAction){await wait('window.__lastMessageAction?.action==='+JSON.stringify(threadAction));await evaluate('window.__lastMessageAction.promise');await settle();}
  };
  const gesture=async(selector,kind='hold')=>{
    await evaluate('document.querySelector('+JSON.stringify(selector)+').scrollIntoView({block:"center"})');await settle();
    // A cached thread is visible before its light refresh finishes. Start the
    // physical gesture only after layout/scroll have stopped moving the target.
    await evaluate(`new Promise((resolve,reject)=>{let previous='',stable=0,frames=0;function check(){const node=document.querySelector(${JSON.stringify(selector)}),r=node?.getBoundingClientRect(),stamp=r?JSON.stringify([r.x,r.y,r.width,r.height,document.querySelector('.msg-history')?.scrollTop,document.querySelector('[data-action="msg-refresh-messages"]')?.disabled]):'';stable=stamp&&stamp===previous?stable+1:0;previous=stamp;if(stable>=5)return resolve(true);if(++frames>120)return reject(Error('Gesture target kept moving'));requestAnimationFrame(check);}check();})`);
    const point=await evaluate(`(()=>{const node=document.querySelector(${JSON.stringify(selector)}),r=node.getBoundingClientRect(),history=node.closest('.msg-history'),clip=history?.getBoundingClientRect()||{top:0,bottom:innerHeight,left:0,right:innerWidth};const top=Math.max(0,r.top,clip.top),bottom=Math.min(innerHeight,r.bottom,clip.bottom);return {x:Math.max(clip.left+2,Math.min(clip.right-2,r.x+r.width*.7)),y:(top+bottom)/2,visible:bottom>top+4};})()`);
    assert.equal(point.visible,true,'gesture target must be inside its scroll viewport');delete point.visible;
    assert.equal(await evaluate(`Boolean(document.elementFromPoint(${point.x},${point.y})?.closest(${JSON.stringify(selector)}))`),true,'touch must hit the selected entry, not its header/composer');
    await evaluate(`(()=>{window.__gestureTrace=[];if(window.__tracingGestures)return;window.__tracingGestures=true;for(const type of ['pointerdown','pointermove','pointerup','pointercancel','scroll','contextmenu','visibilitychange'])document.addEventListener(type,event=>{window.__gestureTrace.push({type,id:event.pointerId,target:event.target?.id||event.target?.className,at:performance.now()});},true);})()`);
    await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...point,id:1}]});
    if(kind==='hold')await new Promise(r=>setTimeout(r,580));
    else for(let n=1;n<=6;n++)await send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:point.x-n*12,y:point.y,id:1}]});
    await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await settle();
  };
  const menu=async ref=>{await gesture('.msg-bubble[data-message-ref="'+ref+'"]');try{await wait('document.querySelector("#messageActionsDialog[open]")');}catch(error){console.error('Gesture trace',JSON.stringify(await evaluate('({events:__gestureTrace,header:document.querySelector(".msg-conversation-head")?.textContent,busy:document.querySelector("[data-action=msg-refresh-messages]")?.disabled})')));throw error;}};
  const reaction=async ref=>{await menu(ref);await click('[data-message-choice="reaction"]');await wait('document.querySelector(".message-actions-emojis")');await click('[data-message-choice="👍"]');};
  const settle=()=>evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  const draft=async value=>{await evaluate('(()=>{const t=document.getElementById("msgDraft");t.value='+JSON.stringify(value)+';t.dispatchEvent(new Event("input",{bubbles:true}));})()');await settle();return evaluate('document.getElementById("msgDraft").getBoundingClientRect().height');};
  const queue=()=>evaluate("new Promise((resolve,reject)=>{const r=indexedDB.open('itus-operation-queue');r.onsuccess=()=>{const db=r.result,q=db.transaction('operations','readonly').objectStore('operations').getAll();q.onsuccess=()=>{resolve(q.result.map(x=>({id:x.id,requestId:x.requestId,body:x.body,scope:x.scope,method:x.method})));db.close()};q.onerror=()=>reject(q.error)}})");
  const screenshot=async name=>{if(process.env.CHAT_DEFECT_ARTIFACT_DIR){mkdirSync(process.env.CHAT_DEFECT_ARTIFACT_DIR,{recursive:true});writeFileSync(join(process.env.CHAT_DEFECT_ARTIFACT_DIR,name+'.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));}};
  await send('Page.enable');await send('Emulation.setDeviceMetricsOverride',{width:393,height:852,deviceScaleFactor:1,mobile:true});
  await send('Page.addScriptToEvaluateOnNewDocument',{source:`window.__ITUS_API_BASE__=location.origin+'/api/1c';localStorage.setItem('itus.environment:'+location.origin,'test');
    // Observe real action completion without substituting its implementation.
    Object.defineProperty(window,'ITUS_MESSENGER',{configurable:true,set(api){const create=api.create;api.create=function(options){const client=create(options),handle=client.handle;client.handle=(...args)=>{const promise=handle(...args);window.__lastMessageAction={action:args[0],promise};return promise;};return client;};Object.defineProperty(window,'ITUS_MESSENGER',{value:api,writable:true,configurable:true});}});`});
  await send('Page.navigate',{url:'http://127.0.0.1:'+server.address().port+'/'});await wait('document.querySelector("#authUserId")');await evaluate('document.getElementById("authUserId").value="111"');await click('[data-action="login"]');await wait('document.querySelector("#orderSearch")');
  // The same composer implementation serves both messengers. Input growth must
  // preserve its DOM node, caret and a history position away from the bottom.
  await click('[data-view="chat"]');await wait('document.querySelector("[data-action=msg-source]")');
  for(const source of ['staff','clients']){
    await click('[data-action="msg-source"][data-source="'+source+'"]');await wait('document.querySelector("[data-action=msg-open]")');
    if(source==='clients')assert.equal(await evaluate('document.querySelector("[data-action=msg-open]").dataset.ref'),'client-one','a new client without messages remains below an existing conversation');
    await click('[data-action="msg-open"]');await wait('document.querySelector("#msgDraft")');await wait('document.querySelectorAll(".msg-bubble").length>10');
    assert.equal(await evaluate('document.querySelector("[data-action=msg-refresh-messages]").disabled'),false,source+' refresh is enabled after opening');
    // Hold the real browser request to cover busy, duplicate click, success,
    // failure and retry. Completing a partial history render must not replace
    // the composer or lose text typed while the request is in flight.
    for(const outcome of ['success','failure','retry']){
      holdHistory=true;const before=historyResponses.length;
      await click('[data-action="msg-refresh-messages"]');
      for(let n=0;n<200&&historyResponses.length===before;n++)await new Promise(r=>setTimeout(r,10));
      assert.equal(historyResponses.length,before+1);
      assert.equal(await evaluate('document.querySelector("[data-action=msg-refresh-messages]").disabled'),true);
      assert.equal(await evaluate('document.querySelector("[data-action=msg-refresh-messages]").getAttribute("aria-busy")'),'true');
      await click('[data-action="msg-refresh-messages"]');assert.equal(historyResponses.length,before+1,'disabled duplicate click does not send a request');
      await draft('Keep refresh draft');await evaluate('window.__refreshDraft=document.querySelector("#msgDraft");__refreshDraft.setSelectionRange(5,5)');
      holdHistory=false;historyResponses[before][outcome==='failure'?'reject':'accept']();
      await wait('document.querySelector("[data-action=msg-refresh-messages]:not(:disabled)")');
      assert.equal(await evaluate('document.querySelector("[data-action=msg-refresh-messages]").getAttribute("aria-busy")'),'false');
      assert.equal(await evaluate('document.querySelector("[data-action=msg-refresh-messages]").classList.contains("is-pending")'),false);
      assert.equal(await evaluate('document.querySelector("#msgDraft")===__refreshDraft'),true,'completion preserves composer node');
      assert.equal(await evaluate('__refreshDraft.value'),'Keep refresh draft');assert.equal(await evaluate('__refreshDraft.selectionStart'),5);
      await draft('');
    }
    assert.equal(await evaluate('Boolean(document.querySelector("[data-action=msg-reply]"))'),false,'no permanent action buttons');
    await gesture('.msg-bubble[data-message-ref="message-54"]','swipe');
    if(source==='staff'){assert.equal(await evaluate('document.querySelector(".msg-reply-draft").textContent.includes("Synthetic history line 54")'),true,'internal swipe selects quote');await click('[data-action="msg-reply-cancel"]');}
    else{assert.equal(await evaluate('document.querySelector(".msg-reply-draft").textContent.trim()'),'');assert.equal(await evaluate('Boolean(document.querySelector(".message-swiping"))'),false);await menu('message-54');assert.equal(await evaluate('Boolean(document.querySelector("[data-message-choice=reply],[data-message-choice=reaction]"))'),false,'client menu has no excluded actions');await screenshot('client-forward-menu');await click('[data-message-choice="cancel"]');}
    const controls=await evaluate("Array.from(document.querySelectorAll('.msg-compose > *'), el=>el.dataset.action || el.id)");
    assert.deepEqual(controls,source==='clients'?['msg-attach','msg-poll','msgDraft','msg-send']:['msg-attach','msgDraft','msg-send']);
    for(const width of [320,393]){
      await send('Emulation.setDeviceMetricsOverride',{width,height:852,deviceScaleFactor:1,mobile:true});
      await settle();
      const fits=await evaluate(`(()=>{
        const draft=document.getElementById('msgDraft'), box=draft.getBoundingClientRect();
        const gap=parseFloat(getComputedStyle(draft.parentElement).columnGap);
        const left=draft.previousElementSibling.getBoundingClientRect().right;
        const right=draft.nextElementSibling.getBoundingClientRect().left;
        return box.width>0 && Math.abs(box.left-left-gap)<1 && Math.abs(right-box.right-gap)<1;
      })()`);
      assert.ok(fits,source+' composer must fill the space between its buttons at '+width+'px');
    }
    await draft('АБВ');await evaluate('{const field=document.getElementById("msgDraft");field.focus();field.setSelectionRange(1,2)}');
    await send('Input.insertText',{text:'😂'});
    assert.equal(await evaluate('document.getElementById("msgDraft").value'),'А😂В','keyboard emoji replaces the selected range');
    const initial=await draft('');await evaluate('window.__draftNode=document.getElementById("msgDraft");document.querySelector(".msg-history").scrollTop=120;window.__historyTop=document.querySelector(".msg-history").scrollTop');
    const expanded=await draft('Первая строка\nВторая строка\nТретья строка');assert.ok(expanded>initial+20,source+' multiline growth');
    assert.equal(await evaluate('__draftNode===document.getElementById("msgDraft")'),true);
    assert.equal(await evaluate('Math.abs(document.querySelector(".msg-history").scrollTop-__historyTop)<2'),true,'reading position preserved');
    assert.ok(await draft('Слова с переносом '.repeat(16))>initial,'wrapped text also grows');
    const capped=await draft(Array(30).fill('Строка').join('\n'));assert.ok(capped<250);assert.equal(await evaluate('getComputedStyle(__draftNode).overflowY'), 'auto');
    await evaluate('__draftNode.focus();__draftNode.setSelectionRange(3,3)');await send('Emulation.setDeviceMetricsOverride',{width:393,height:470,deviceScaleFactor:1,mobile:true});await settle();
    assert.equal(await evaluate('document.getElementById("msgDraft").selectionStart'),3);
    assert.equal(await evaluate('document.querySelector(".msg-compose").getBoundingClientRect().bottom<=innerHeight+1'),true,'composer above keyboard');
    await send('Emulation.setDeviceMetricsOverride',{width:393,height:852,deviceScaleFactor:1,mobile:true});await settle();assert.ok(await draft('Коротко')<=initial+2);
    await draft('Сохранённый\nчерновик');await click('[data-action="msg-back"]');await click('[data-action="msg-open"]');await wait('document.querySelector("#msgDraft")');assert.equal(await evaluate('document.getElementById("msgDraft").value'),'Сохранённый\nчерновик');
    await screenshot('composer-'+source);await draft('');await click('[data-action="msg-back"]');
  }
  const messageReads=calls.filter(x=>x.path.endsWith('/messages/list')).length;latestClient='client-two';await click('[data-action="msg-refresh"]');await wait('document.querySelector("[data-action=msg-open]").dataset.ref==="client-two"');assert.equal(calls.filter(x=>x.path.endsWith('/messages/list')).length,messageReads,'sorting does not download each history');
  await click('[data-action="msg-open"][data-ref="client-two"]');await wait('document.querySelectorAll(".msg-bubble").length>10');await click('[data-action="msg-back"]');
  assert.equal(await evaluate('document.querySelector("[data-action=msg-open]").dataset.ref'),'client-two','reading stale history must not lower a newer last-message date');
  await click('[data-action="msg-open"][data-ref="client-one"]');await wait('document.querySelector("#msgDraft")');await click('[data-action="msg-chat-settings"]');await wait('document.querySelector("[data-action=msg-mute]")');await click('[data-action="msg-mute"]');await wait('document.querySelector("[data-action=msg-chat-settings]").textContent.includes("🔕")');assert.deepEqual(muted,[{source:'clients',ref:'client-one'}]);
  assert.equal(await evaluate('ITUS_CHAT_PREFERENCES_CLIENT.status("staff","client-one").muted'),false);
  await click('[data-action="msg-chat-settings"]');await click('[data-action="msg-mute"]');await wait('document.querySelector("[data-action=msg-chat-settings]").textContent.includes("🔔")');assert.equal(muted.length,0);
  await click('[data-action="msg-back"]');await click('[data-action="msg-source"][data-source="staff"]');await click('[data-action="msg-open"]');await wait('document.querySelector(".msg-bubble")');
  await menu('message-54');await click('[data-message-choice="reply"]');assert.equal(await evaluate('document.querySelector(".msg-reply-draft").textContent.includes("Synthetic history line 54")'),true);
  await draft('Synthetic reply text');await evaluate('(()=>{const b=document.querySelector("[data-action=msg-send]");b.click();b.click()})()');
  await wait('document.querySelector(".msg-quote")');
  const sent=calls.filter(x=>x.path.endsWith('/internal-chat/messages/send'));assert.equal(sent.length,1);assert.equal(sent[0].body.replyToMessageRef,'message-54');
  assert.equal(await evaluate('document.querySelector(".msg-reply-draft").textContent'), '');
  await draft('Keep while reacting');await menu('message-54');await click('[data-message-choice="reaction"]');await wait('document.querySelector(".message-actions-emojis")');await evaluate(`(()=>{const b=document.querySelector('[data-message-choice="👍"]');b.click();b.click()})()`);
  for(let n=0;n<100&&!reactionResponses.length;n++)await new Promise(r=>setTimeout(r,20));assert.equal(reactionResponses.length,1);assert.equal(calls.filter(x=>x.path.endsWith('/messages/react')).length,1);
  assert.equal(await evaluate('document.querySelector("#msgDraft").value'),'Keep while reacting');assert.equal(await evaluate('document.querySelector(".msg-reaction-count")===null'),true,'unconfirmed reaction is not presented as saved');
  reactionResponses[0].accept();await wait('document.querySelector(".msg-reaction-count")');
  await click('[data-action="msg-back"]');await click('[data-action="msg-open"]');
  try{await wait('document.querySelector(".msg-reaction-count")');}catch(error){console.log(JSON.stringify({stage:'reopen-reactions',remote:staffHistory.find(x=>x.messageRef==='message-54'),calls:calls.slice(-5),dom:await evaluate('document.querySelector(".msg-conversation").textContent.slice(-1800)')}));throw error;}
  await reaction('message-54');
  for(let n=0;n<100&&reactionResponses.length<2;n++)await new Promise(r=>setTimeout(r,20));assert.equal(reactionResponses.length,2);assert.equal(calls.filter(x=>x.path.endsWith('/messages/react')).at(-1).body.emojiCode,'');
  reactionResponses[1].accept();await wait('!document.querySelector(".msg-reaction-count")');
  await reaction('message-54');
  for(let n=0;n<100&&reactionResponses.length<3;n++)await new Promise(r=>setTimeout(r,20));assert.equal(reactionResponses.length,3);
  reactionResponses[2].res.writeHead(422,{'Content-Type':'application/json'}).end(JSON.stringify({success:false,error:{code:'SYNTHETIC_REJECTED',message:'Synthetic reaction rejection'}}));
  await wait('document.querySelector("#toast").textContent.includes("Synthetic reaction rejection")');assert.equal(await evaluate('document.querySelector(".msg-reaction-count")===null'),true);
  await reaction('message-54');
  for(let n=0;n<100&&reactionResponses.length<4;n++)await new Promise(r=>setTimeout(r,20));assert.equal(reactionResponses.length,4);
  const reactionCalls=calls.filter(x=>x.path.endsWith('/messages/react'));assert.equal(reactionCalls.at(-1).body.requestId,reactionCalls.at(-2).body.requestId,'manual retry keeps the unconfirmed reaction identity');
  reactionResponses[3].accept();await wait('document.querySelector(".msg-reaction-count")');await draft('');await screenshot('internal-reply-reactions');
  // Desktop alternatives use the same menu, and Back dismisses it first.
  await evaluate(`document.querySelector('.msg-bubble[data-message-ref="message-54"]').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}))`);
  await wait('document.querySelector("#messageActionsDialog[open]")');await screenshot('message-hold-menu');assert.equal(await evaluate('ITUS_BACK()'),true);
  await evaluate(`document.querySelector('.msg-bubble[data-message-ref="message-54"]').dispatchEvent(new KeyboardEvent('keydown',{key:'F10',shiftKey:true,bubbles:true,cancelable:true}))`);
  await wait('document.querySelector("#messageActionsDialog[open]")');await click('[data-message-choice="cancel"]');
  await click('[data-action="msg-back"]');await click('[data-action="msg-source"][data-source="clients"]');await click('[data-action="msg-open"][data-ref="client-one"]');await wait('document.querySelector(".msg-bubble")');
  await gesture('.msg-bubble[data-message-ref="message-54"]','swipe');assert.equal(await evaluate('document.querySelector(".msg-reply-draft").textContent.trim()'),'');
  await menu('message-54');await click('[data-message-choice="forward"]');await wait('document.querySelector("#messageForwardDialog[open]")');await click('#messageForwardDialog [data-forward-action="topics"]');await wait(`document.querySelector('#messageForwardDialog [data-ref="staff:staff-one"]')`);
  assert.equal(await evaluate(`Boolean(document.querySelector('#messageForwardDialog [data-ref="clients:client-one"]'))`),false,'source chat excluded');
  const sendsBefore=calls.filter(x=>x.path.endsWith('/internal-chat/messages/send')).length;await click('#messageForwardDialog [data-forward-action="recipient"][data-ref="staff:staff-one"]');assert.equal(calls.filter(x=>x.path.endsWith('/internal-chat/messages/send')).length,sendsBefore);
  await click('#messageForwardDialog [data-forward-action="send"]');await wait('!document.querySelector("#messageForwardDialog").open');
  for(let n=0;n<100&&calls.filter(x=>x.path.endsWith('/internal-chat/messages/send')).length===sendsBefore;n++)await new Promise(r=>setTimeout(r,20));
  const forwardedMessage=calls.filter(x=>x.path.endsWith('/internal-chat/messages/send')).at(-1);assert.equal(forwardedMessage.body.groupRef,'staff-one');assert.equal(forwardedMessage.body.text,'Synthetic history line 54');assert.ok(!forwardedMessage.body.replyToMessageRef&&!forwardedMessage.body.authorName);
  await click('[data-action="msg-back"]');await click('[data-action="msg-source"][data-source="staff"]');await click('[data-action="msg-open"]');await wait('document.querySelector(".msg-bubble")');
  await menu('message-54');await click('[data-message-choice="forward"]');await wait('document.querySelector("#messageForwardDialog[open]")');await click('#messageForwardDialog [data-forward-action="topics"]');await wait(`document.querySelector('#messageForwardDialog [data-ref="clients:client-two"]')`);
  await click('#messageForwardDialog [data-forward-action="recipient"][data-ref="clients:client-two"]');await click('#messageForwardDialog [data-forward-action="send"]');await wait('!document.querySelector("#messageForwardDialog").open');
  for(let n=0;n<100&&!held.length;n++)await new Promise(r=>setTimeout(r,20));assert.equal(held.length,1);const clientForward=calls.filter(x=>x.path.endsWith('/clients/messages/send')).at(-1);assert.equal(clientForward.body.text,'Synthetic history line 54');assert.ok(!clientForward.body.replyToMessageRef);
  for(const response of held.splice(0))response.end('{"success":true,"data":{}}');for(let n=0;n<100&&(await queue()).length;n++)await new Promise(r=>setTimeout(r,20));assert.equal((await queue()).length,0);
  assert.equal(calls.filter(x=>x.path.endsWith('/clients/messages/react')).length,0);assert.ok(calls.filter(x=>x.path.includes('/clients/')&&/\/(files|messages)\/send$/.test(x.path)).every(x=>!x.body.replyToMessageRef));
  // Each role opens an existing document. Media is an independent top layer,
  // never a replacement of the defect sheet or its unsent draft.
  function luminance(rgb){
    const channels=rgb.match(/\d+/g).slice(0,3).map(Number).map(value=>{
      const v=value/255;
      return v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4;
    });
    return channels[0]*0.2126+channels[1]*0.7152+channels[2]*0.0722;
  }
  for(const role of ['mp','executor','tech']){
    await click('[data-view="'+role+'"]');await wait('document.querySelector("[data-action=open-defect-chat]")');await click('[data-action="open-defect-chat"]');await wait('document.querySelector(".defect-history .entry")');
    assert.equal(await evaluate('Boolean(document.querySelector("[data-action=select-defect-forward]"))'),role==='mp');
    assert.equal(await evaluate('Boolean(document.querySelector("[data-action=verify-defect-entry]"))'),role==='tech');
    for(const theme of ['dark','light']){
      await evaluate(`ITUS_APPEARANCE.setTheme(${JSON.stringify(theme)});document.getElementById('defectText').focus()`);
      await send('Input.insertText',{text:'Дефект'});
      const field=await evaluate(`(()=>{
        const el=document.getElementById('defectText'),style=getComputedStyle(el);
        return {focused:el===document.activeElement,value:el.value,ink:style.color,paper:style.backgroundColor};
      })()`);
      assert.ok(field.focused && field.value.endsWith('Дефект'));
      const ink=luminance(field.ink),paper=luminance(field.paper);
      assert.ok((Math.max(ink,paper)+0.05)/(Math.min(ink,paper)+0.05)>=4.5,
        role+' '+theme+' defect text contrast: '+field.ink+' on '+field.paper);
      await evaluate("document.getElementById('defectText').blur()");
    }
    await evaluate('window.__historyNode=document.querySelector(".defect-history");document.getElementById("defectText").value="Unsent defect draft";document.getElementById("sheetBody").scrollTop=140;window.__sheetTop=document.getElementById("sheetBody").scrollTop');
    const before=calls.filter(x=>x.path.endsWith('/defects/start')).length;
    for(const index of [1,2]){
      await click('[data-action="defect-media"][data-index="'+index+'"]');await wait('document.querySelector("#documentMediaViewer[open]")');
      if(index===1)await click('#documentMediaViewer button');else assert.equal(await evaluate('ITUS_BACK()'),true);
      await settle();assert.equal(await evaluate('__historyNode===document.querySelector(".defect-history")'),true);
      assert.equal(await evaluate('document.getElementById("defectText").value'),'Unsent defect draft');
      assert.equal(await evaluate('Math.abs(document.getElementById("sheetBody").scrollTop-__sheetTop)<2'),true);
      assert.equal(await evaluate('document.getElementById("overlay").classList.contains("hidden")'),false);
    }
    assert.equal(calls.filter(x=>x.path.endsWith('/defects/start')).length,before,'closing media never reloads/creates a document');
    await gesture('.defect-history .entry[data-defect-entry="0"]');await wait('document.querySelector("#messageActionsDialog[open]")');
    assert.equal(await evaluate('ITUS_BACK()'),true);assert.equal(await evaluate('document.getElementById("overlay").classList.contains("hidden")'),false);
    await gesture('.defect-history .entry[data-defect-entry="1"]');await click('[data-message-choice="forward"]');await wait('document.querySelector("#defectForwardDialog[open]")');
    assert.equal(await evaluate('document.getElementById("defectText").value'),'Unsent defect draft');await click('#defectForwardDialog [data-forward-action="close"]');
    await click('#closeSheetButton');
  }
  await click('[data-view="mp"]');await click('[data-action="open-defect-chat"]');await wait('document.querySelector("[data-action=select-defect-forward]")');
  await click('[data-action="select-defect-forward"][data-index="0"]');await click('[data-action="select-defect-forward"][data-index="1"]');
  await evaluate('window.__historyNode=document.querySelector(".defect-history");document.getElementById("defectText").value="Keep this draft";document.getElementById("sheetBody").scrollTop=160');
  await click('[data-action="defect-media"][data-index="1"]');await wait('document.querySelector("#documentMediaViewer[open]")');await click('#documentMediaViewer button');
  assert.equal(await evaluate('document.querySelectorAll("[data-action=select-defect-forward]:checked").length'),2);
  await click('[data-action="defect-forward"]');await wait('document.querySelector("[data-forward-action=topics]")');
  assert.equal(held.length,0);await click('[data-forward-action="topics"]');await wait('document.querySelectorAll("[data-forward-action=recipient]").length===3');
  assert.equal(await evaluate('document.querySelector("[data-forward-action=send]")===null'),true,'no implicit recipient');
  await click('[data-forward-action="recipient"][data-ref="clients:client-two"]');assert.equal(held.length,0);
  await evaluate('(()=>{const button=document.querySelector("[data-forward-action=send]");button.click();button.click();})()');
  await wait('!document.querySelector("#defectForwardDialog").open');
  for(let n=0;n<160&&held.length<2;n++)await new Promise(r=>setTimeout(r,25));assert.equal(held.length,2);
  const saved=await queue();assert.equal(saved.length,2,'entire mixed package saved before HTTP response');
  assert.equal(new Set(saved.map(x=>x.requestId)).size,2);assert.equal(new Set(saved.map(x=>x.body.clientMessageId)).size,2);
  assert.ok(saved.every(x=>x.body.topicRef==='client-two'&&x.scope.includes('111')));
  assert.equal(saved.find(x=>x.body.text).body.text,'Synthetic defect 0');
  assert.equal(saved.find(x=>x.body.file).body.file.contentBase64,image,'photo bytes are not recompressed');
  assert.equal(saved.find(x=>x.body.file).body.file.fileName,'original.png');
  const attachment=calls.filter(x=>x.path.endsWith('/media/attachment')).at(-1).body;
  assert.equal(attachment.route,'/defects/start');assert.equal(attachment.envelope.orderRef,'order-one');assert.equal(attachment.envelope.documentRef,'defect-one');assert.equal(attachment.envelope.attachmentRef,'photo-ref');assert.equal(attachment.envelope.entryRef,'photo-entry');
  assert.ok(saved.every(x=>!('authorName' in x.body)&&!('documentRef' in x.body)));
  assert.equal(await evaluate('document.getElementById("defectText").value'),'Keep this draft');
  assert.equal(await evaluate('__historyNode===document.querySelector(".defect-history")'),true);
  assert.equal(await evaluate('document.querySelectorAll("[data-action=select-defect-forward]:checked").length'),0);
  assert.equal(calls.filter(x=>/\/(entries\/add|complete|entries\/verify)$/.test(x.path)).length,0,'forwarding cannot alter the source document');
  await screenshot('defect-selection-saved');for(const response of held)response.end('{"success":true,"data":{}}');
  await wait('document.querySelector("[data-defect-forward-count]").textContent.includes("0")');
  // Preparation failure must never enqueue the earlier text part. Retrying
  // within this confirmation keeps the same IDs; switching owner cancels it.
  await evaluate(`window.__fakeContext={session:{scope:'test|owner',generation:1},orderRef:'o',documentRef:'d',orderNumber:'TEST',entries:[{entryRef:'e',text:'Selected',type:'photo',file:{fileName:'photo.png',mimeType:'image/png'}}]};window.__prepCalls=0;window.__enqueued=[];window.__forwardIds=[];window.__testForward=ITUS_DEFECT_FORWARDING.create({id:()=>{const id='id-'+(__forwardIds.length+1);__forwardIds.push(id);return id;},context:()=>__fakeContext,valid:c=>c===__fakeContext,topics:async()=>[{ref:'client',title:'Synthetic client'}],photo:async(c,e,s,id)=>{__prepCalls++;if(__prepCalls===1)throw Error('Synthetic read failure');return {fileName:'photo.png',contentBase64:'YQ==',clientFileId:id};},enqueue:async(c,items)=>{__enqueued.push(items);},toast(){}});__testForward.toggle(0,true);__testForward.open();`);
  await click('#defectForwardDialog[open] [data-forward-action="topics"]');await wait('document.querySelector("#defectForwardDialog[open] [data-forward-action=recipient]")');await click('#defectForwardDialog[open] [data-forward-action="recipient"]');await click('#defectForwardDialog[open] [data-forward-action="send"]');await wait('document.querySelector("#defectForwardDialog[open] [role=alert]")');
  assert.equal(await evaluate('__enqueued.length'),0);const ids=await evaluate('__forwardIds.slice()');
  await click('#defectForwardDialog[open] [data-forward-action="send"]');await wait('__enqueued.length===1');const forwarded=await evaluate('__enqueued[0]');assert.equal(forwarded.length,2);assert.equal(forwarded[0].clientMessageId,ids[0]);assert.equal(forwarded[0].requestId,ids[1]);assert.equal(forwarded[1].file.clientFileId,ids[2]);
  await evaluate('__testForward.toggle(0,true);__testForward.open();__fakeContext={...__fakeContext,session:{scope:"test|another",generation:2}}');await click('#defectForwardDialog[open] [data-forward-action="topics"]');await wait('document.querySelector("#defectForwardDialog[open] [role=alert]")');assert.equal(await evaluate('__enqueued.length'),1);await evaluate('__testForward.close()');
  console.log('Chat/defect browser: staff/client refresh busy/success/error/retry restores the button, blocks duplicate requests and preserves composer/caret; both composers grow/shrink; media retains document in MP/executor/tech; explicit client forwarding preserves bytes, IDs and owner isolation.');
  await send('Browser.close');socket.close();
}catch(error){console.error('Synthetic browser failure:',error.message,stderr.slice(-1800));throw error;
}finally{socket?.close();child.kill();for(const response of held)response.destroy();for(const response of [...reactionResponses,...historyResponses])response.res.destroy();server.closeAllConnections();server.close();try{rmSync(profile,{recursive:true,force:true,maxRetries:3,retryDelay:100});}catch{}}
