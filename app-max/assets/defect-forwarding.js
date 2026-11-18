(function(root){
  'use strict';
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const photo=entry=>Boolean(entry?.file&&!/^video\//i.test(entry.file.mimeType||'')&&(entry.type==='photo'||/^image\//i.test(entry.file.mimeType||'')));
  const fileKind=entry=>photo(entry)?'photo':entry?.type==='video'||/^video\//i.test(entry?.file?.mimeType||'')?'video':'file';
  const eligible=entry=>Boolean(String(entry?.text||'').trim()||entry?.file);
  const entryKey=(entry,index)=>JSON.stringify([entry.entryRef||entry.clientEntryId||entry.id||index,entry.text||'',entry.file?[entry.file.fileRef||'',entry.file.clientFileId||'',entry.file.fileName||'',entry.file.sizeBytes||0]:null]);
  const targetKey=target=>(target.source||'clients')+':'+target.ref;
  function create(options){
    let selected=new Map(),contextKey='',dialog=null,job=null,revision=0;
    const identity=ctx=>ctx?[ctx.session.scope,ctx.session.generation,ctx.source||'',ctx.ref||'',ctx.messageRef||'',ctx.orderRef||'',ctx.documentRef||''].join('|'):'';
    function sync(){
      const ctx=options.context(),key=identity(ctx);
      if(key!==contextKey){selected.clear();contextKey=key;}
      if(ctx){const keys=new Set(ctx.entries.map(entryKey));for(const key of selected.keys())if(!keys.has(key))selected.delete(key);}
      return ctx;
    }
    function guard(active){
      if(job!==active||active.controller.signal.aborted||!options.valid(active.context))throw Object.assign(Error('Выбранный документ или пользователь изменился. Пересылка отменена.'),{code:'SESSION_CHANGED'});
    }
    function toolbar(){
      const label=root.document.querySelector('[data-defect-forward-count]'),button=root.document.querySelector('[data-action="defect-forward"]');
      if(label)label.textContent=`Выбрано записей: ${selected.size}`;
      if(button)button.disabled=!selected.size;
    }
    function close(){
      if(job?.saving){dialog?.close();return true;}
      if(job){job.controller.abort();job=null;revision++;}
      const wasOpen=Boolean(dialog?.open);dialog?.close();return wasOpen;
    }
    function ensure(){
      if(dialog)return;
      dialog=root.document.createElement('dialog');dialog.id=options.dialogId||'defectForwardDialog';dialog.className='defect-forward-dialog';dialog.setAttribute('aria-labelledby',dialog.id+'Title');
      dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
      dialog.addEventListener('click',event=>{const control=event.target.closest('[data-forward-action]');if(!control||control.disabled)return;void handle(control.dataset.forwardAction,control.dataset.ref);});
      root.document.body.append(dialog);
    }
    function summary(active){
      return `Текстов: ${active.entries.filter(x=>String(x.text||'').trim()).length} · Вложений: ${active.entries.filter(x=>x.file).length}`;
    }
    function paint(){
      if(!job||!dialog)return;const active=job;
      const content=active.entries.map(entry=>`<div class="defect-forward-preview">${entry.text?`<p>${escape(entry.text)}</p>`:''}${entry.file?`<p>Вложение: ${escape(entry.file.fileName||'Файл')}</p>`:''}</div>`).join('');
      let body='',actions='';
      if(active.phase==='preview'){body=content;actions='<button class="primary" data-forward-action="topics">Выбрать чат</button>';}
      if(active.phase==='topics'){
        body=active.topics.length?active.topics.map(topic=>`<button class="defect-forward-recipient" data-forward-action="recipient" data-ref="${escape(targetKey(topic))}"><strong>${escape(topic.title)}</strong><small>${topic.source==='staff'?'Сотрудники':'Клиентский чат'}</small>${topic.subtitle?`<span>${escape(topic.subtitle)}</span>`:''}${topic.orderNumber?`<small>ЗН ${escape(topic.orderNumber)}</small>`:''}</button>`).join(''):'<p>Нет доступных чатов для пересылки. Отправка не выполнялась.</p>';
        actions='<button data-forward-action="preview">Назад к выбранным записям</button>';
      }
      if(active.phase==='confirm'){
        body=`<div class="notice"><strong>Получатель: ${escape(active.target.title)}</strong><p>${active.target.source==='staff'?'Сотрудники':'Клиентский чат'} · ${escape(active.target.subtitle||'')}</p></div>${content}<p>Будут созданы новые сообщения в выбранном чате. Исходные записи не изменяются.</p>`;
        actions='<button class="primary" data-forward-action="send">Переслать</button><button data-forward-action="topics">Другой чат</button>';
      }
      if(active.busy){body=`<p role="status"><span class="spinner"></span> ${escape(active.status||'Загрузка…')}</p>`;actions='';}
      dialog.innerHTML=`<header><div><h2 id="${dialog.id}Title">Переслать в чат</h2><p>${escape(active.context.orderNumber?'ЗН '+active.context.orderNumber:active.context.title||'Выбранное сообщение')} · ${summary(active)}</p></div><button type="button" class="icon-button" data-forward-action="close" aria-label="Закрыть пересылку">×</button></header><div class="defect-forward-body">${body}${active.error?`<p class="error-text" role="alert">${escape(active.error)}</p>`:''}</div><div class="defect-forward-actions">${actions}</div>`;
    }
    async function topics(active){
      active.busy=true;active.error='';active.status='Получаем доступные чаты…';paint();
      try{const values=await options.topics(active.context);guard(active);active.topics=values.filter(topic=>topic.ref);active.phase='topics';}
      catch(error){if(job===active)active.error=error.message;}
      finally{if(job===active){active.busy=false;paint();}}
    }
    async function send(active){
      if(active.busy||active.saved)return;guard(active);
      if(!active.target||!active.topics.some(topic=>targetKey(topic)===targetKey(active.target)))throw Error('Выберите доступный чат');
      active.busy=true;active.error='';paint();
      const id=key=>active.ids[key]||(active.ids[key]=options.id());
      try{
        if(!active.prepared){
          const items=[];
          for(const [index,entry] of active.entries.entries()){
            guard(active);active.status=`Подготавливаем выбранное: ${index+1} из ${active.entries.length}`;paint();
            if(String(entry.text||'').trim())items.push({kind:'text',text:entry.text,clientMessageId:id(index+':text'),requestId:id(index+':text-request')});
            if(entry.file){
              if(!active.photos[index])active.photos[index]=await (options.attachment||options.photo)(active.context,entry,active.controller.signal,id(index+':file'));
              guard(active);items.push({kind:fileKind(entry),file:{...active.photos[index],clientFileId:id(index+':file')},clientMessageId:id(index+':photo'),requestId:id(index+':photo-request')});
            }
          }
          guard(active);active.prepared=items;
        }
        active.status='Надёжно сохраняем весь пакет на устройстве…';active.saving=true;paint();
        await options.enqueue(active.context,active.prepared,active.target);
        active.saved=true;
        if(identity(options.context())===identity(active.context)){
          selected.clear();for(const input of root.document.querySelectorAll('[data-action="select-defect-forward"]'))input.checked=false;toolbar();
        }
        if(job===active){dialog.close();job=null;}
        options.toast('Выбранное сохранено в очереди чата. Отправка продолжится в фоне.');
      }catch(error){if(job===active&&!active.controller.signal.aborted){active.error=error.message;active.phase='confirm';}}
      finally{active.busy=false;active.saving=false;if(job===active)paint();}
    }
    async function handle(action,ref){
      if(action==='close')return close();const active=job;if(!active||active.busy)return;
      try{
        guard(active);
        if(action==='topics')return await topics(active);
        if(action==='preview'){active.phase='preview';active.error='';paint();}
        if(action==='recipient'){
          const candidates=active.topics.filter(topic=>topic.ref===ref);
          const target=active.topics.find(topic=>targetKey(topic)===ref)||(candidates.length===1?candidates[0]:null);if(!target)throw Error('Чат недоступен');
          if(active.target&&targetKey(active.target)!==targetKey(target)){active.ids={};active.prepared=null;}
          active.target=target;active.phase='confirm';active.error='';paint();
        }
        if(action==='send')return await send(active);
      }catch(error){if(job===active){active.error=error.message;paint();}}
    }
    function openEntries(entries,ctx=sync()){
      if(!ctx||!entries.length)return options.toast('Выберите запись для пересылки',true);
      if(job?.busy)return options.toast('Подготовка пересылки уже выполняется');
      close();ensure();job={revision:++revision,context:ctx,entries:entries.map(entry=>({...entry,file:entry.file?{...entry.file}:null})),phase:'preview',topics:[],target:null,ids:{},photos:{},prepared:null,controller:new AbortController(),busy:false,saving:false,error:''};paint();dialog.showModal();
    }
    return {
      eligible,isSelected(index){const ctx=sync();return Boolean(ctx?.entries[index]&&selected.has(entryKey(ctx.entries[index],index)));},
      count(){sync();return selected.size;},
      toggle(index,checked){const ctx=sync(),entry=ctx?.entries[index];if(!entry||!eligible(entry))return;const key=entryKey(entry,index);if(checked)selected.set(key,{...entry,file:entry.file?{...entry.file}:null});else selected.delete(key);toolbar();},
      open(){const ctx=sync();openEntries([...selected.values()],ctx);},
      openEntries(indexes){const ctx=sync();openEntries((indexes||[]).map(index=>ctx?.entries[index]).filter(eligible),ctx);},
      close,back:()=>dialog?.open?close():false,isOpen:()=>Boolean(dialog?.open)
    };
  }
  root.ITUS_DEFECT_FORWARDING={create,eligible,isPhoto:photo,entryKey};
})(window);
