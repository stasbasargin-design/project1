(function(root){
  'use strict';
  const thresholdBytes=10*1024*1024;
  const fileOf=body=>body?.entry?.file||body?.file;
  function create({base,userId,auth,guard,progress=()=>{},storage=root.localStorage}={}){
    let connecting=null;
    const api=()=>String(typeof base==='function'?base():base||'').replace(/\/api\/1c\/?$/,'')+'/api/media';
    const key=()=>`itus.media.device:${api()}:${userId()}`;
    const credential=()=>{try{return JSON.parse(storage.getItem(key())||'null');}catch{return null;}};
    const connected=()=>Boolean(credential()?.token&&credential().expires>Date.now()+60000);
    function headers(){const value=credential();if(!value||value.expires<Date.now())throw Object.assign(new Error('Подключение файлов обновляется автоматически после входа'),{status:401,code:'DEVICE_REQUIRED'});return {'Content-Type':'application/json','X-ITUS-Device':value.token};}
    async function connect({force=false}={}){
      guard?.();if(!force&&connected())return credential();
      const owner=String(userId()),ownerKey=key();
      if(connecting?.key===ownerKey)return connecting.promise;
      if(typeof auth!=='function')throw Object.assign(new Error('Войдите в приложение для отправки файлов'),{status:401,code:'MEDIA_AUTH_REQUIRED'});
      const promise=(async()=>{
        const envelope=auth();if(String(envelope?.userId)!==owner)throw Object.assign(new Error('Пользователь изменился'),{code:'SESSION_CHANGED',queuePaused:true});
        const data=await request('/session',{body:envelope,anonymous:true});guard?.();
        if(ownerKey!==key()||owner!==String(userId()))throw Object.assign(new Error('Пользователь изменился'),{code:'SESSION_CHANGED',queuePaused:true});
        if(!/^[a-f0-9]{64}$/.test(data?.token||'')||data.expires<=Date.now())throw Object.assign(new Error('Сервер не подтвердил подключение файлов'),{status:502,code:'MEDIA_SESSION_INVALID'});
        storage.setItem(ownerKey,JSON.stringify(data));return data;
      })().finally(()=>{if(connecting?.promise===promise)connecting=null;});
      connecting={key:ownerKey,promise};return promise;
    }
    async function request(path,{body,anonymous=false,signal,refresh=true,timeoutMs}={}){
      guard?.();
      if(!anonymous&&typeof auth==='function'&&!connected())await connect();
      guard?.();
      const controller=new AbortController(),abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();const timer=setTimeout(abort,timeoutMs||(path==='/attachment'?20*60*1000:35000));
      try{
        const response=await fetch(api()+path,{method:body===undefined?'GET':'POST',headers:anonymous?{'Content-Type':'application/json'}:headers(),...(body===undefined?{}:{body:JSON.stringify(body)}),signal:controller.signal});
        const data=await response.json();guard?.();
        if(!response.ok||data.success===false){
          if(!anonymous&&refresh&&response.status===401&&data.error?.code==='DEVICE_REQUIRED'&&typeof auth==='function'){
            await connect({force:true});return request(path,{body,signal,refresh:false});
          }
          throw Object.assign(new Error(data.error?.message||'Не удалось проверить отправку'),{status:response.status,code:data.error?.code||'MEDIA_REQUEST_FAILED'});
        }
        return data.data;
      }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
    }
    async function pair(code){const data=await request('/pair',{body:{userId:String(userId()),code},anonymous:true});storage.setItem(key(),JSON.stringify(data));return data;}
    async function revoke(){const ownerKey=key();try{if(connected())await request('/device/revoke',{body:{},refresh:false,timeoutMs:3000});}finally{storage.removeItem(ownerKey);}}
    const pause=(ms,signal)=>new Promise((resolve,reject)=>{if(signal?.aborted)return reject(signal.reason);const aborted=()=>{clearTimeout(timer);reject(signal.reason||new DOMException('Aborted','AbortError'));};const timer=setTimeout(()=>{signal?.removeEventListener('abort',aborted);resolve();},ms);signal?.addEventListener('abort',aborted,{once:true});});
    function upload(url,blob,onProgress,signal,relay=false){return new Promise((resolve,reject)=>{
      const xhr=new XMLHttpRequest();xhr.open(relay?'POST':'PUT',url);xhr.timeout=120000;
      if(relay){const device=headers();xhr.setRequestHeader('X-ITUS-Device',device['X-ITUS-Device']);xhr.setRequestHeader('Content-Type','application/octet-stream');}
      const abort=()=>xhr.abort();signal?.addEventListener('abort',abort,{once:true});
      const clean=()=>signal?.removeEventListener('abort',abort);
      xhr.upload.onprogress=event=>{if(event.lengthComputable)onProgress(event.loaded);};
      xhr.onload=()=>{clean();if(xhr.status>=200&&xhr.status<300)resolve();else reject(Object.assign(new Error('Не удалось загрузить часть файла'),{status:xhr.status,code:'BUFFER_PART_FAILED'}));};
      xhr.onerror=xhr.ontimeout=()=>{clean();reject(Object.assign(new Error('Загрузка прервана. Файл сохранён на устройстве.'),{code:'BUFFER_UPLOAD_INTERRUPTED'}));};
      xhr.onabort=()=>{clean();reject(Object.assign(new Error('Загрузка приостановлена'),{name:'AbortError'}));};
      if(signal?.aborted){clean();reject(signal.reason);return;}xhr.send(blob);
    });}
    function metadata(envelope){const copy={...envelope};if(envelope.entry)copy.entry={...envelope.entry};const file={...fileOf(envelope)};delete file.contentBlob;delete file.contentBase64;(copy.entry?.file?copy.entry:copy).file=file;return copy;}
    async function completion(route,envelope,dependencies=[],signal){return request('/jobs',{body:{route,envelope,complete:true,dependencies},signal});}
    async function wait(job,{signal,manual=false}={}){
      if(['failed','invalid'].includes(job.state)&&manual)job=await request('/jobs/'+job.id+'/retry',{body:{},signal});
      while(job.state!=='confirmed'){
        guard?.();progress({requestId:job.requestId,state:job.state,percent:100,jobId:job.id});
        if(['invalid','uncertain','failed'].includes(job.state))throw Object.assign(new Error(job.state==='invalid'?'1С отклонила пакет. Откройте отчёт.':'Отправка не подтверждена. Нужна проверка результата в 1С.'),{status:job.state==='invalid'?422:job.state==='uncertain'?409:Number(job.error?.status)||503,code:job.error?.code||'MEDIA_RECONCILIATION_REQUIRED',jobId:job.id});
        await pause(2000,signal);job=await request('/jobs/'+job.id,{signal});
      }
      progress({requestId:job.requestId,state:'confirmed',jobId:job.id});
      return {...job.response,mediaReceipt:{jobId:job.id,confirmed:true}};
    }
    async function send(route,envelope,{signal,manual}={}){
      const file=fileOf(envelope),blob=file?.contentBlob;
      let job=await request('/jobs',{body:{route,envelope:metadata(envelope)},signal});
      if(['failed','invalid'].includes(job.state)&&manual)job=await request('/jobs/'+job.id+'/retry',{body:{},signal});
      if(job.state==='uploading'){
        if(!blob||blob.size!==file.sizeBytes)throw Object.assign(new Error('Локальный файл недоступен'),{code:'BUFFER_LOCAL_FILE_MISSING',status:409});
        const parts=await request('/jobs/'+job.id+'/parts',{signal}),present=new Set(parts.map(x=>x.number));
        const count=Math.ceil(blob.size/job.partSize);
        for(let number=1;number<=count;number++){
          guard?.();if(present.has(number))continue;
          const offset=(number-1)*job.partSize,part=blob.slice(offset,Math.min(offset+job.partSize,blob.size));
          for(let attempt=0;;attempt++){
            try{const signed=await request('/jobs/'+job.id+'/sign',{body:{number},signal});await upload(signed.relay?api()+signed.path:signed.url,part,loaded=>progress({requestId:job.requestId,state:'uploading',percent:Math.round(100*(offset+loaded)/blob.size),jobId:job.id}),signal,signed.relay);break;}
            catch(error){if(signal?.aborted||attempt>=2)throw error;await pause(1000*(attempt+1),signal);}
          }
        }
        job=await request('/jobs/'+job.id+'/uploaded',{body:{},signal});
      }
      return wait(job,{signal,manual});
    }
    return {connected,connect,headers,request,pair,revoke,send,completion,wait,thresholdBytes,
      async attachment(route,envelope,expectedBytes){const result=await request('/attachment',{body:{route,envelope,expectedBytes}});return {...result,url:api()+'/download/'+result.ticket};},
      async fileUrl(jobId){return (await request('/jobs/'+jobId+'/file',{body:{}})).url;}};
  }
  root.ITUS_MEDIA_BUFFER={create,thresholdBytes};
})(typeof window!=='undefined'?window:globalThis);
