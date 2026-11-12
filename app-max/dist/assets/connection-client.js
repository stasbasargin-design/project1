(function(root){
 'use strict';
 const READS=new Set(['/auth/max','/ping','/orders/list','/orders/get','/orders/search','/notifications/poll','/internal-chat/groups/list','/internal-chat/contacts/list','/internal-chat/messages/list','/clients/topics/list','/clients/messages/list']);
 const transient=error=>!error?.status||[408,429,502,503,504].includes(error.status);
 function create({context,recover,onNetwork=()=>{},onRecovery=()=>{},now=Date.now,setTimeout:delay=root.setTimeout?.bind(root),clearTimeout:cancel=root.clearTimeout?.bind(root)}={}){
  if(root.ITUS_REVIEW_MODE||root.ITUS_VITE_DEV)return null;
  const cap=root.Capacitor;
  const plugin=(cap?.isNativePlatform?.()||cap?.getPlatform?.()==='android')?(cap?.Plugins?.Connection||(cap?.isPluginAvailable?.('Connection')?cap.registerPlugin?.('Connection'):null)):null;
  if(typeof plugin?.read!=='function')return {native:false,supports:()=>false,snapshot:()=>null,activate(){},failed(){},recovering:()=>false};
  let network={type:'unknown'},timer=null,job=null,attempt=0,destroyed=false,currentScope='',recoveryRequired=false,blockedUntil=0;
  const active=new Map(),removers=[];
  const scope=()=>{const c=context();return c?.userId?String(c.scope)+'|'+String(c.generation):'';};
  const visible=()=>!root.document?.hidden;
  const alive=key=>!destroyed&&key&&scope()===key;
  function schedule(wait=1000){
   if(destroyed||!scope()||!visible()||network.connected===false)return;
   recoveryRequired=true;if(timer||job)return;
   const key=scope();timer=delay(()=>{timer=null;if(alive(key))void run(key);},Math.max(wait,blockedUntil-now()));
  }
  async function run(key){
   if(job||!alive(key)||!visible())return;
   const task=(async()=>{
    onRecovery({stage:'recovering',attempt:attempt+1});
    try{
     const result=await recover();if(!alive(key))return;
     if(result===false){blockedUntil=now()+1000;return;}
     recoveryRequired=false;attempt=0;onRecovery({stage:'restored'});
    }catch(error){
     if(!alive(key)||error?.code==='SESSION_CHANGED')return;
     onRecovery({stage:'failed',code:error?.code||'NETWORK_IO'});
     if(transient(error)){attempt++;blockedUntil=now()+[1000,3000,7000,15000,30000,60000][Math.min(attempt-1,5)];}
     else recoveryRequired=false;
    }
   })();job={key,task};try{await task;}finally{if(job?.task===task)job=null;if(scope()&&recoveryRequired)schedule(1000);}
  }
  function update(value={}){
   const previous=network;network={type:['wifi','cellular','ethernet','none','unknown'].includes(value.type)?value.type:'unknown',connected:value.connected,validated:value.validated,metered:value.metered,vpn:value.vpn===true,generation:value.generation};
   const changed=previous.type!==network.type||previous.connected!==network.connected||previous.validated!==network.validated||previous.generation!==network.generation;
   if(changed)onNetwork({...network,previousType:previous.type});
   if(value.reason==='resume'||changed){attempt=0;blockedUntil=0;schedule();}
  }
  function activate(){
   const next=scope();if(next===currentScope)return;
   currentScope=next;recoveryRequired=false;attempt=0;blockedUntil=0;if(timer)cancel(timer);timer=null;
   for(const [id,record] of active)if(record.scope!==next)void plugin.cancel?.({id,reason:'REQUEST_ABORTED'}).catch(()=>{});
  }
  async function request(method,url,options){
   if(!READS.has(method)&&!['/api/environments/config','/api/diagnostics/events'].includes(method))throw Object.assign(Error('Транспорт чтения не поддерживает эту операцию'),{code:'NATIVE_ROUTE_REJECTED',status:400});
   activate();const key=scope();if(!key)throw Object.assign(Error('Пользователь изменился'),{code:'SESSION_CHANGED'});
   if(options.signal?.aborted)throw new DOMException('Aborted','AbortError');
   const id=root.crypto.randomUUID(),record={scope:key};active.set(id,record);
   const abort=()=>{void plugin.cancel?.({id,reason:'REQUEST_ABORTED'}).catch(()=>{});};options.signal?.addEventListener('abort',abort,{once:true});
   let abortReject;const aborted=new Promise((_,reject)=>{abortReject=()=>reject(new DOMException('Aborted','AbortError'));options.signal?.addEventListener('abort',abortReject,{once:true});});
   try{
    const native=plugin.read({id,url,body:options.body,headers:options.headers,maxBytes:/\/(messages\/list|orders\/(list|get))$/.test(method)?4*1024*1024:16*1024*1024});
    const result=await Promise.race([native,aborted]);
    if(!alive(key))throw Object.assign(Error('Пользователь изменился'),{code:'SESSION_CHANGED'});
    if(result.id!==id)throw Object.assign(Error('Получен ответ от прежнего запроса'),{code:'NETWORK_STALE_RESPONSE'});
    if(result.network)network={...network,...result.network};
    return new Response(result.body||null,{status:result.status,headers:result.headers});
   }catch(error){
    if(error.data?.network)network={...network,...error.data.network};
    if(error.code==='REQUEST_ABORTED')throw new DOMException('Aborted','AbortError');
    if(error.code==='ONE_C_RESPONSE_TOO_LARGE')error.status=413;
    if(/^NATIVE_/.test(error.code||''))error.status=400;
    const messages={NETWORK_DNS:'Не удалось определить адрес сервера. Восстанавливаем связь…',NETWORK_TLS:'Не удалось установить защищённое соединение',NETWORK_CHANGED:'Сеть изменилась. Восстанавливаем связь…',NETWORK_OFFLINE:'Нет доступного подключения к интернету',NETWORK_CONNECT:'Сервер недоступен через текущую сеть',NETWORK_TIMEOUT:'Сервер не ответил вовремя. Восстанавливаем связь…',NETWORK_IO:'Соединение прервано. Восстанавливаем связь…'};
    if(messages[error.code])error.message=messages[error.code];
    throw error;
   }finally{active.delete(id);options.signal?.removeEventListener('abort',abort);options.signal?.removeEventListener('abort',abortReject);}
  }
  function listen(target,event,fn){target?.addEventListener?.(event,fn);removers.push(()=>target?.removeEventListener?.(event,fn));}
  listen(root.document,'visibilitychange',()=>{if(visible()){attempt=0;blockedUntil=0;void plugin.status?.().then(update).catch(()=>{});schedule();}else{if(timer)cancel(timer);timer=null;}});
  listen(root,'online',()=>{attempt=0;blockedUntil=0;schedule();});
  void plugin.status?.().then(update).catch(()=>{});
  const listener=plugin.addListener?.('connectionChanged',update);
  return {native:true,supports:method=>READS.has(method),request,snapshot:()=>({...network}),activate,
   metadata:async(url,options)=>{try{return await request('/api/environments/config',url,{...options,body:'{}',headers:{}});}catch(error){if(transient(error))schedule(1500);throw error;}},
   telemetry:(url,options)=>request('/api/diagnostics/events',url,options),
   failed(method,error){if(READS.has(method)&&transient(error)&&error?.code!=='SESSION_CHANGED')schedule(1500);},
   recovering:()=>recoveryRequired||Boolean(job),
   destroy(){destroyed=true;if(timer)cancel(timer);for(const remove of removers)remove();void Promise.resolve(listener).then(x=>x?.remove()).catch(()=>{});for(const id of active.keys())void plugin.cancel?.({id,reason:'REQUEST_ABORTED'}).catch(()=>{});}
  };
 }
 root.ITUS_CONNECTION={create,readRoutes:()=>[...READS]};
})(window);
