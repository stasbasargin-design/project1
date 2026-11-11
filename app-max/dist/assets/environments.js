(function(root){
  'use strict';
  if(root.ITUS_REVIEW_MODE)return;
  const original=root.ITUS_CONFIG.ONE_C_API_BASE_URL;
  const prefix=String(original).replace(/\/api\/1c\/?$/,'');
  const selectionKey='itus.environment:'+prefix;
  const savedChoice=root.localStorage.getItem(selectionKey);
  const initialLegacyUser=savedChoice?'':root.localStorage.getItem('itus.maxUserId')||'';
  const chosen=savedChoice==='test'?'test':'production';
  if(!savedChoice)root.localStorage.setItem(selectionKey,chosen);
  const apiBase=chosen==='test'?original:prefix+'/contours/production/api/1c';
  const apiRoot=apiBase.replace(/\/api\/1c\/?$/,'');
  const authKey=chosen==='test'?'itus.maxUserId':'itus.maxUserId:production';
  const activationKey='itus.push.activation:'+prefix;
  let activation=null,beginning=null,configuration=null;
  try{const saved=JSON.parse(root.localStorage.getItem(activationKey)||'null');if(saved?.environment===chosen)activation=saved;}catch{}
  Object.assign(root.ITUS_CONFIG,{ONE_C_API_BASE_URL:apiBase,ONE_C_PUBLIC_BASE_URL:chosen==='test'?root.ITUS_CONFIG.ONE_C_PUBLIC_BASE_URL:'https://1c.eazia.ru/aa6_ea/ru/hs/max-service'});
  function instance(){let id=root.localStorage.getItem('itus.push.instance');if(!id){id=root.crypto.randomUUID();root.localStorage.setItem('itus.push.instance',id);}return id;}
  const native=()=>Boolean(root.Capacitor?.isNativePlatform?.()||root.Capacitor?.getPlatform?.()==='android');
  const platform=()=>native()?'android':'web';
  async function workerState(value){
    if(native()){
      const plugin=root.Capacitor?.registerPlugin?.('Environment');
      if(!plugin)throw Error('Обновите APK для переключения уведомлений');
      await plugin.setPushContext(value);return;
    }
    if(!root.indexedDB)return;
    await new Promise((resolve,reject)=>{
      const open=root.indexedDB.open('itus-push-environment',1);
      open.onupgradeneeded=()=>open.result.createObjectStore('state');open.onerror=()=>reject(open.error);
      open.onsuccess=()=>{const db=open.result,tx=db.transaction('state','readwrite');tx.objectStore('state').put(value,'active');tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>{db.close();reject(tx.error);};};
    });
    const registrations=await root.navigator.serviceWorker?.getRegistrations?.()||[];
    for(const registration of registrations){if(new URL(registration.scope).pathname===new URL('./',root.document.baseURI).pathname){for(const notification of await registration.getNotifications())notification.close();}}
  }
  async function installation(media,action,extra={}){
    await media.connect();
    const response=await root.fetch(apiRoot+'/api/push/installation',{method:'POST',headers:media.headers(),body:JSON.stringify({action,platform:platform(),clientInstanceId:instance(),...extra}),signal:AbortSignal.timeout(15000)});
    const result=await response.json();if(!response.ok||!result.success)throw Error('Не удалось переключить уведомления. Повторите подключение.');return result.data;
  }
  async function begin(media,recipient={}){
    if(activation&&activation.userId!==root.localStorage.getItem(authKey))activation=null;
    if(activation)return activation;if(beginning)return beginning;
    beginning=(async()=>{
      await workerState({environment:chosen,enabled:false,activationId:''});
      const current=await installation(media,'begin',recipient);
      activation=current;
      root.localStorage.setItem(activationKey,JSON.stringify(current));
      return current;
    })().finally(()=>{beginning=null;});return beginning;
  }
  async function bind(media,extra){
    const current=await begin(media,extra);
    await installation(media,'bind',{...extra,activationId:current.activationId});
    activation={...current,enabled:true};
    root.localStorage.setItem(activationKey,JSON.stringify(activation));
    await workerState(activation);
  }
  async function pause(media){
    const current=activation||JSON.parse(root.localStorage.getItem(activationKey)||'null');
    await workerState({environment:chosen,enabled:false,activationId:''});
    if(current&&current.userId===root.localStorage.getItem(authKey))await installation(media,'pause',{activationId:current.activationId});
    activation=null;root.localStorage.removeItem(activationKey);
  }
  async function load(){
    const response=await root.fetch(prefix+'/api/environments/config',{cache:'no-store',signal:AbortSignal.timeout(12000)});
    const result=await response.json();if(!response.ok||!result.success)throw Error('Не удалось проверить подключение к 1С');
    configuration=result.data;
    if(!configuration[chosen])throw Error('Выбранная база 1С пока не подключена на сервере');
    if(!configuration.isolatedPush)throw Error('Сервер ещё не подготовлен к разделению уведомлений');
    return configuration;
  }
  function select(id,userId){
    if(!['test','production'].includes(id)||!configuration?.[id])throw Error('Подключение недоступно');
    const key=id==='test'?'itus.maxUserId':'itus.maxUserId:production';
    if(userId)root.localStorage.setItem(key,userId);
    root.localStorage.setItem(selectionKey,id);
    root.location.reload();
  }
  function accepts(data){return Boolean(activation?.enabled&&data?.environment===chosen&&data?.activationId===activation.activationId);}
  root.addEventListener('storage',event=>{
    if(event.key===selectionKey&&root.localStorage.getItem(selectionKey)!==chosen)root.location.reload();
    if(event.key===activationKey){try{const value=JSON.parse(event.newValue||'null');activation=value?.environment===chosen?value:null;}catch{activation=null;}}
  });
  root.ITUS_ENVIRONMENTS={id:chosen,label:chosen==='test'?'ТЕСТОВАЯ 1С':'БОЕВАЯ 1С',authKey,initialUserId:()=>root.localStorage.getItem(authKey)||initialLegacyUser,cacheOwner:id=>!id?'':chosen==='test'?String(id):'production:'+id,activationId:()=>activation?.activationId||'',load,configuration:()=>configuration,begin,bind,pause,select,accepts,instance};
})(window);
