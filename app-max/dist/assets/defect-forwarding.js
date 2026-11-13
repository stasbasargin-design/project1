(function(root){
  'use strict';
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const photo=entry=>Boolean(entry?.file&&!/^video\//i.test(entry.file.mimeType||'')&&(entry.type==='photo'||/^image\//i.test(entry.file.mimeType||'')));
  const eligible=entry=>Boolean(String(entry?.text||'').trim()||photo(entry));
  const entryKey=(entry,index)=>JSON.stringify([entry.entryRef||entry.clientEntryId||entry.id||index,entry.text||'',photo(entry)?[entry.file.fileRef||'',entry.file.clientFileId||'',entry.file.fileName||'',entry.file.sizeBytes||0]:null]);
  function create(options){
    let selected=new Map(),contextKey='',dialog=null,job=null,revision=0;
    const identity=ctx=>ctx?[ctx.session.scope,ctx.session.generation,ctx.orderRef,ctx.documentRef].join('|'):'';
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
      dialog=root.document.createElement('dialog');dialog.id='defectForwardDialog';dialog.className='defect-forward-dialog';dialog.setAttribute('aria-labelledby','defectForwardTitle');
      dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
      dialog.addEventListener('click',event=>{const control=event.target.closest('[data-forward-action]');if(!control||control.disabled)return;void handle(control.dataset.forwardAction,control.dataset.ref);});
      root.document.body.append(dialog);
    }
    function summary(active){
      return `Текстов: ${active.entries.filter(x=>String(x.text||'').trim()).length} · Фото: ${active.entries.filter(photo).length}`;
    }
    function paint(){
      if(!job||!dialog)return;const active=job;
      const content=active.entries.map(entry=>`<div class="defect-forward-preview">${entry.text?`<p>${escape(entry.text)}</p>`:''}${photo(entry)?`<p>Фото: ${escape(entry.file.fileName||'Фото дефекта')}</p>`:''}</div>`).join('');
      let body='',actions='';
      if(active.phase==='preview'){body=content;actions='<button class="primary" data-forward-action="topics">Выбрать клиентский чат</button>';}
      if(active.phase==='topics'){
        body=active.topics.length?active.topics.map(topic=>`<button class="defect-forward-recipient" data-forward-action="recipient" data-ref="${escape(topic.ref)}"><strong>${escape(topic.title)}</strong>${topic.subtitle?`<span>${escape(topic.subtitle)}</span>`:''}${topic.orderNumber?`<small>ЗН ${escape(topic.orderNumber)}</small>`:''}</button>`).join(''):'<p>1С не вернула доступных клиентских чатов. Отправка не выполнялась.</p>';
        actions='<button data-forward-action="preview">Назад к выбранным записям</button>';
      }
      if(active.phase==='confirm'){
        body=`<div class="notice"><strong>Получатель: ${escape(active.target.title)}</strong><p>${escape(active.target.subtitle||'')}</p></div>${content}<p>Будут созданы новые сообщения в выбранном чате. Исходная дефектовка не изменяется.</p>`;
        actions='<button class="primary" data-forward-action="send">Отправить клиенту</button><button data-forward-action="topics">Другой чат</button>';
      }
      if(active.busy){body=`<p role="status"><span class="spinner"></span> ${escape(active.status||'Загрузка…')}</p>`;actions='';}
      dialog.innerHTML=`<header><div><h2 id="defectForwardTitle">Переслать клиенту</h2><p>ЗН ${escape(active.context.orderNumber)} · ${summary(active)}</p></div><button type="button" class="icon-button" data-forward-action="close" aria-label="Закрыть пересылку">×</button></header><div class="defect-forward-body">${body}${active.error?`<p class="error-text" role="alert">${escape(active.error)}</p>`:''}</div><div class="defect-forward-actions">${actions}</div>`;
    }
    async function topics(active){
      active.busy=true;active.error='';active.status='Получаем доступные клиентские чаты…';paint();
      try{const values=await options.topics(active.context);guard(active);active.topics=values.filter(topic=>topic.ref);active.phase='topics';}
      catch(error){if(job===active)active.error=error.message;}
      finally{if(job===active){active.busy=false;paint();}}
    }
    async function send(active){
      if(active.busy||active.saved)return;guard(active);
      if(!active.target||!active.topics.some(topic=>topic.ref===active.target.ref))throw Error('Выберите доступный клиентский чат');
      active.busy=true;active.error='';paint();
      const id=key=>active.ids[key]||(active.ids[key]=options.id());
      try{
        if(!active.prepared){
          const items=[];
          for(const [index,entry] of active.entries.entries()){
            guard(active);active.status=`Подготавливаем выбранное: ${index+1} из ${active.entries.length}`;paint();
            if(String(entry.text||'').trim())items.push({kind:'text',text:entry.text,clientMessageId:id(index+':text'),requestId:id(index+':text-request')});
            if(photo(entry)){
              if(!active.photos[index])active.photos[index]=await options.photo(active.context,entry,active.controller.signal,id(index+':file'));
              guard(active);items.push({kind:'photo',file:active.photos[index],clientMessageId:id(index+':photo'),requestId:id(index+':photo-request')});
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
          const target=active.topics.find(topic=>topic.ref===ref);if(!target)throw Error('Чат недоступен');
          if(active.target&&active.target.ref!==ref){active.ids={};active.prepared=null;}
          active.target=target;active.phase='confirm';active.error='';paint();
        }
        if(action==='send')return await send(active);
      }catch(error){if(job===active){active.error=error.message;paint();}}
    }
    return {
      eligible,isSelected(index){const ctx=sync();return Boolean(ctx?.entries[index]&&selected.has(entryKey(ctx.entries[index],index)));},
      count(){sync();return selected.size;},
      toggle(index,checked){const ctx=sync(),entry=ctx?.entries[index];if(!entry||!eligible(entry))return;const key=entryKey(entry,index);if(checked)selected.set(key,{...entry,file:entry.file?{...entry.file}:null});else selected.delete(key);toolbar();},
      open(){const ctx=sync();if(!ctx||!selected.size)return options.toast('Выберите текст или фото для пересылки',true);ensure();if(!job){job={revision:++revision,context:ctx,entries:[...selected.values()],phase:'preview',topics:[],target:null,ids:{},photos:{},prepared:null,controller:new AbortController(),busy:false,saving:false,error:''};}paint();if(!dialog.open)dialog.showModal();},
      close,back:()=>dialog?.open?close():false,isOpen:()=>Boolean(dialog?.open)
    };
  }
  root.ITUS_DEFECT_FORWARDING={create,eligible,isPhoto:photo,entryKey};
})(window);
