(function(root){
 'use strict';
 const route=value=>/^\/(?:auth|orders|notifications|internal-chat|clients|defects|acceptance|worktime|workshop|quality|checklists|posts|executors|service)(?:\/[a-z][a-z0-9-]{0,30}){1,3}$/.test(String(value||''))?String(value):'/other';
 const code=error=>{
  if(/^[A-Z][A-Z0-9_/-]{0,63}$/.test(error?.code||''))return error.code;
  if(error?.name==='AbortError')return 'REQUEST_ABORTED';
  if(error?.name==='QuotaExceededError')return 'STORAGE_QUOTA';
  if(error?.name==='SecurityError')return 'STORAGE_UNAVAILABLE';
  if(/fetch|network|connection/i.test(error?.message||''))return 'NETWORK_FETCH_FAILED';
  if(error?.name==='TypeError')return 'JS_TYPE_ERROR';
  if(error?.name==='ReferenceError')return 'JS_REFERENCE_ERROR';
  return 'APPLICATION_ERROR';
 };
 function create(options){
  if(root.ITUS_REVIEW_MODE||root.ITUS_VITE_DEV)return null;
  try{return build(options);}catch{return null;}
 }
 function build({context,storage=root.localStorage,fetch:send=root.fetch?.bind(root),now=Date.now,setInterval:interval=root.setInterval?.bind(root),clearInterval:cancelInterval=root.clearInterval?.bind(root),setTimeout:delay=root.setTimeout?.bind(root),clearTimeout:cancelDelay=root.clearTimeout?.bind(root)}={}){
  const uuid=()=>root.crypto.randomUUID();
  let installationId;try{installationId=storage.getItem('itus.diagnostics.installation');}catch{}
  if(!/^[-a-f0-9]{32,36}$/i.test(installationId||'')){installationId=uuid();try{storage.setItem('itus.diagnostics.installation',installationId);}catch{}}
  const states=new Map(),requests=new Map();let active=null,flushJob=null,flushTimer=null,failures=0,nextAttempt=0,destroyed=false;
  const networkSnapshot=()=>{
   const native=root.ITUS_CONNECTION_CLIENT?.snapshot?.(),type=native?.type||root.navigator?.connection?.type;
   return {network:['wifi','cellular','ethernet','none','unknown'].includes(type)?type:'unknown',networkValidated:typeof native?.validated==='boolean'?native.validated:null,networkMetered:typeof native?.metered==='boolean'?native.metered:null,networkVpn:native?.vpn===true};
  };
  function current(){
   const c=context();if(!c?.userId)return null;
   const key='itus.diagnostics:'+String(c.apiBase)+'|'+String(c.userId);
   let state=states.get(key);
   if(!state){try{state=JSON.parse(storage.getItem(key)||'null');}catch{}state={events:[],lastRequest:null,lastSuccess:null,...state};if(!Array.isArray(state.events))state.events=[];state.events=state.events.slice(-50);states.set(key,state);if(states.size>4)states.delete(states.keys().next().value);}
   if(active!==key){active=key;nextAttempt=0;failures=0;}
   return {key,state,c};
  }
  function save(item){try{storage.setItem(item.key,JSON.stringify(item.state));}catch{}}
  function system(){
   const ua=root.navigator?.userAgent||'',native=Boolean(root.Capacitor?.isNativePlatform?.()||root.Capacitor?.getPlatform?.()==='android');
   const browser=native?'WebView':/YaBrowser/i.test(ua)?'Yandex':/Edg\//.test(ua)?'Edge':/Chrome\//.test(ua)?'Chrome':/Safari\//.test(ua)?'Safari':'Other';
   const android=ua.match(/Android (\d{1,2})/),ios=ua.match(/(?:iPhone OS|CPU OS) (\d{1,2})/);
   const os=android?'Android '+android[1]:ios?'iOS '+ios[1]:/Windows/.test(ua)?'Windows':/Macintosh/.test(ua)?'macOS':/Linux/.test(ua)?'Linux':'';
   const type=root.navigator?.connection?.type;
   return {platform:native?'android':'web',browser,os,network:['wifi','cellular','ethernet','none'].includes(type)?type:'unknown',visibility:root.document?.hidden?'hidden':'visible'};
  }
  function enqueue(kind,details={}){
   const item=current();if(!item)return;
   const file=String(details.file||'').split('/').pop().split('?')[0];
   item.state.events.push({id:uuid(),kind,at:new Date(now()).toISOString(),route:route(details.route),status:Number(details.status)||0,code:details.code||'STATE_CHANGED',durationMs:Math.max(0,Math.round(details.durationMs||0)),file:/^[a-zA-Z0-9_.-]{1,80}\.js$/.test(file)?file:'',line:Math.max(0,Math.round(details.line||0)),...networkSnapshot(),networkFrom:details.networkFrom||'',transport:details.transport||'',visibility:root.document?.hidden?'hidden':'visible'});
   item.state.events=item.state.events.slice(-50);save(item);schedule();
  }
  function schedule(){if(!flushTimer&&!destroyed)flushTimer=delay?.(()=>{flushTimer=null;void flush();},2000);}
  async function flush(){
   if(destroyed||root.navigator?.onLine===false||now()<nextAttempt)return false;
   if(flushJob)return flushJob;
   const item=current();if(!item?.state.token||!send)return false;
   const {c,state}=item,events=state.events.slice(0,20),token=state.token;
   const pending=[...requests.values()].filter(r=>r.key===item.key&&r.generation===c.generation).slice(-8).map(r=>({route:r.route,elapsedMs:Math.max(0,now()-r.started),...r.network,transport:r.transport}));
   const payload={installationId,...system(),...networkSnapshot(),version:c.version,build:c.build,ready:c.ready===true,uiBlocked:c.uiBlocked===true,signedOut:state.signedOut===true,queue:c.queue||{},lastRequest:state.lastRequest,lastSuccess:state.lastSuccess,routes:state.routes||[],pending,recovering:root.ITUS_CONNECTION_CLIENT?.recovering?.()===true,events};
   const controller=new AbortController(),timer=delay?.(()=>controller.abort(),5000);
   const job=(async()=>{
    try{
     const endpoint=String(c.apiBase).replace(/\/api\/1c\/?$/,'')+'/api/diagnostics/events';
     const options={method:'POST',headers:{'Content-Type':'application/json','X-ITUS-Diagnostics-Token':token},body:JSON.stringify(payload),signal:controller.signal,keepalive:true};
     const response=await (root.ITUS_CONNECTION_CLIENT?.native?root.ITUS_CONNECTION_CLIENT.telemetry(endpoint,options):send(endpoint,options));
     if(!response.ok){if(response.status===401&&state.token===token){delete state.token;save(item);}throw Error('COLLECTOR_REJECTED');}
     const result=await response.json();if(result.success!==true||!Array.isArray(result.data?.accepted))throw Error('COLLECTOR_REJECTED');
     const acknowledged=new Set(result.data.accepted);state.events=state.events.filter(e=>!acknowledged.has(e.id));save(item);failures=0;nextAttempt=now()+2000;
     if(state.events.length&&active===item.key)schedule();return true;
    }catch{failures++;nextAttempt=now()+Math.min(300000,5000*2**Math.min(failures-1,6));return false;}
    finally{if(timer)cancelDelay?.(timer);}
   })();
   flushJob=job;try{return await job;}finally{if(flushJob===job)flushJob=null;}
  }
  function acceptToken(token){
   const item=current();if(!item||typeof token!=='string'||token.length>2000)return;
   try{
    const payload=JSON.parse(root.atob(token.split('.')[0].replace(/-/g,'+').replace(/_/g,'/')));
    if(payload.kind!=='diagnostics-ingest'||String(payload.userId)!==String(item.c.userId)||payload.environment!==item.c.environment||payload.exp<=now())return;
    item.state.token=token;item.state.signedOut=false;save(item);nextAttempt=0;failures=0;schedule();
   }catch{}
  }
  const start=method=>{const item=current();if(!item)return null;const request={id:uuid(),key:item.key,generation:item.c.generation,route:route(method),started:now(),network:networkSnapshot(),transport:root.ITUS_CONNECTION_CLIENT?.supports?.(method)?'native':'webview'};requests.set(request.id,request);if(requests.size>32)requests.delete(requests.keys().next().value);return request;};
  function result(request,ok,status,error){
   if(request)requests.delete(request.id);
   const item=current();if(!request||!item||item.key!==request.key||item.c.generation!==request.generation||error?.code==='SESSION_CHANGED')return;
   const value={route:request.route,ok,status:Number(status)||0,code:ok?'':code(error),durationMs:Math.max(0,now()-request.started),at:new Date(now()).toISOString(),...networkSnapshot(),networkFrom:request.network.network,transport:request.transport};
   item.state.lastRequest=value;if(ok)item.state.lastSuccess=value;
   item.state.routes=[...(item.state.routes||[]).filter(x=>x.route!==value.route),value].slice(-16);save(item);
   if(!ok)enqueue(value.status?'api-error':'network-error',value);
  }
  function appFailure(error,phase){enqueue('app-error',{code:code(error),file:String(error?.stack||'').match(/([a-zA-Z0-9_.-]+\.js):\d+/)?.[1]||'',route:phase==='initialize'?'/auth/max':'/other'});}
  const listeners=[];
  function listen(target,name,fn){target?.addEventListener?.(name,fn);listeners.push(()=>target?.removeEventListener?.(name,fn));}
  const safe=fn=>(...args)=>{try{return fn(...args);}catch{return undefined;}};
  listen(root,'error',safe(event=>{
   if(event.error)enqueue('app-error',{code:code(event.error),file:event.filename,line:event.lineno});
   else if(event.target?.tagName)enqueue('resource-error',{code:'RESOURCE_LOAD_FAILED'});
  }));
  listen(root,'unhandledrejection',safe(event=>appFailure(event.reason)));
  listen(root,'offline',safe(()=>enqueue('offline',{code:'NETWORK_OFFLINE'})));
  listen(root,'online',safe(()=>{nextAttempt=0;enqueue('online',{code:'NETWORK_ONLINE'});void flush();}));
  listen(root.document,'visibilitychange',safe(()=>{enqueue(root.document.hidden?'background':'foreground');void flush();}));
  const heartbeat=interval?.(safe(()=>{if(!root.document?.hidden)void flush();}),30000);heartbeat?.unref?.();
  return {start:safe(start),success:safe((request,status=200)=>result(request,true,status)),failure:safe((request,error)=>result(request,false,error?.status,error)),acceptToken:safe(acceptToken),appFailure:safe(appFailure),flush,
   networkChanged:safe(value=>enqueue('network-change',{code:'NETWORK_CHANGED',networkFrom:value.previousType})),
   recovery:safe(value=>enqueue('recovery',{code:value.stage==='restored'?'RECOVERY_COMPLETE':value.stage==='failed'?'RECOVERY_FAILED':'RECOVERY_START'})),
   activate:safe(()=>{const item=current();if(item){item.state.signedOut=false;schedule();}}),
   logout:safe(()=>{const item=current();if(!item)return;enqueue('logout');item.state.signedOut=true;const job=flush();void job.finally(()=>{delete item.state.token;save(item);});return job;}),
   inspect:safe(()=>{const item=current();return {buffered:item?.state.events.length||0,authenticated:Boolean(item?.state.token),nextAttempt};}),
   destroy(){destroyed=true;if(heartbeat)cancelInterval?.(heartbeat);if(flushTimer)cancelDelay?.(flushTimer);for(const remove of listeners)remove();}
  };
 }
 root.ITUS_DIAGNOSTICS={create};
})(window);
