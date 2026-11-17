(function(root){
  'use strict';
  function create({context,media,onChange=()=>{},storage=root.localStorage}){
    if(root.ITUS_REVIEW_MODE||root.ITUS_VITE_DEV)return null;
    let active='',record={muted:[],pending:{}},job=null;
    const identity=c=>c?.userId?[c.scope,c.generation].join('|'):'';
    const key=c=>'itus.chat-preferences:'+c.scope;
    const itemKey=(source,ref)=>JSON.stringify([source,ref]);
    const validItem=x=>root.ITUS_CHAT_POLICY.thread(x?.source,x?.ref);
    function sync(){
      const c=context(),id=identity(c);
      if(active!==id){active=id;record={muted:[],pending:{}};
        try{const saved=JSON.parse(storage.getItem(key(c))||'null');if(saved){record.muted=(saved.muted||[]).filter(validItem);for(const value of Object.values(saved.pending||{}))if(validItem(value)&&typeof value.muted==='boolean')record.pending[itemKey(value.source,value.ref)]=value;}}catch{}
      }return c;
    }
    function guard(c){if(!identity(c)||identity(context())!==identity(c))throw Object.assign(Error('Пользователь или контур изменился'),{code:'SESSION_CHANGED'});}
    function save(c){guard(c);storage.setItem(key(c),JSON.stringify(record));onChange();}
    function status(source,ref){sync();const pending=record.pending[itemKey(source,ref)],muted=record.muted.some(x=>x.source===source&&x.ref===ref);return {muted:pending?pending.muted:muted,confirmed:muted,pending:Boolean(pending)};}
    async function request(c,body){
      guard(c);const client=media(c);if(!client)throw Error('Войдите для настройки уведомлений');await client.connect();guard(c);
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
      try{
        const response=await root.fetch(c.apiBase.replace(/\/api\/1c\/?$/,'')+'/api/push/chat-preferences',{
          method:body?'POST':'GET',headers:client.headers(),cache:'no-store',signal:controller.signal,...(body?{body:JSON.stringify(body)}:{})});
        const result=await response.json();guard(c);
        if(!response.ok||result.success!==true||!Array.isArray(result.data?.muted)||result.data.muted.some(x=>!validItem(x)))throw Error('Timeweb не подтвердил настройку уведомлений');
        return result.data;
      }finally{clearTimeout(timer);}
    }
    async function drain(c){
      for(const [id,value] of Object.entries({...record.pending})){
        guard(c);const response=await request(c,{source:value.source,ref:value.ref,muted:value.muted});guard(c);
        record.muted=response.muted;
        // A newer local choice must survive the acknowledgement of an older one.
        if(record.pending[id]?.revision===value.revision)delete record.pending[id];
        save(c);
      }
    }
    async function load(){
      const c=sync();if(!c?.userId)return;
      if(job?.id===identity(c))return job.promise;
      const promise=(async()=>{try{const response=await request(c);record.muted=response.muted;save(c);await drain(c);}catch(error){if(error.code!=='SESSION_CHANGED')onChange();}})();
      job={id:identity(c),promise};try{await promise;}finally{if(job?.promise===promise)job=null;}
    }
    async function set(source,ref,muted){
      const c=sync(),target=root.ITUS_CHAT_POLICY.thread(source,ref);guard(c);if(!target||typeof muted!=='boolean')throw Error('Некорректный чат');
      const id=itemKey(source,ref);record.pending[id]={...target,muted,revision:root.crypto.randomUUID()};save(c);
      if(job?.id===identity(c))try{await job.promise;}catch{}
      guard(c);
      // Serialized saves prevent an older response from overriding a newer choice.
      const promise=drain(c);job={id:identity(c),promise};try{await promise;}catch(error){if(error.code==='SESSION_CHANGED')throw error;}finally{if(job?.promise===promise)job=null;}
      return status(source,ref);
    }
    function suppress(data){const target=root.ITUS_CHAT_POLICY.pushThread(data);return Boolean(target&&status(target.source,target.ref).muted);}
    root.document?.addEventListener('visibilitychange',()=>{if(!root.document.hidden)void load();});
    root.addEventListener?.('storage',event=>{const c=context();if(c?.userId&&event.key===key(c)){active='';sync();onChange();}});
    return {load,set,status,suppress};
  }
  root.ITUS_CHAT_PREFERENCES={create};
})(window);
