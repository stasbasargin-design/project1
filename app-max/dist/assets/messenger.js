(function(root) {
  'use strict';
  const escape = v => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const labels={clients:'Клиенты',staff:'Сотрудники'};
  function safeUrl(value) {
    if (!value) return '';
    try {const u=new URL(value,document.baseURI);return u.protocol==='https:' || (u.protocol==='http:' && u.origin===location.origin) ? u.href : '';}catch{return '';}
  }
  function create(options) {
    const {api,call,user,allowed,toast,pickFile,photo,filePayload,closeSheet}=options;
    let source='clients',section='chats',selected='',query='',visible=false,epoch=0;
    let records={clients:[],staff:[]},contacts=[],contactsLoaded=false,loaded={},listBusy={},listError={},cache={},busy={},errors={},drafts={},sending={},counts={},attempts={};
    const blobUrls=new Map();
    let openingContact=false;
    const key=(s,id)=>s+':'+id;
    const selectedKey=()=>key(source,selected);
    const endpoints=s=>s==='clients'?'/clients':'/internal-chat';
    const params=(s,id)=>s==='clients'?{topicRef:id,topicId:id}:{groupRef:id,groupId:id};
    const newMessageId=()=>root.crypto.randomUUID?root.crypto.randomUUID():String(Date.now());
    function sortedMessages(messages){return messages.map((message,index)=>({message,index})).sort((a,b)=>{
      const at=Date.parse(a.message.createdAt),bt=Date.parse(b.message.createdAt);
      if(Number.isFinite(at)&&Number.isFinite(bt)&&at!==bt)return at-bt;
      if(Number.isFinite(at)!==Number.isFinite(bt))return Number.isFinite(at)?-1:1;
      return a.index-b.index;
    }).map(item=>item.message);}
    function attempt(s,id,signature){const k=key(s,id),existing=attempts[k];if(existing?.signature===signature)return existing.id;const idempotencyId=newMessageId();attempts[k]={signature,id:idempotencyId};return idempotencyId;}
    function finishAttempt(s,id,signature){const k=key(s,id);if(attempts[k]?.signature===signature)delete attempts[k];}
    function permitted(s){return allowed().includes(s);}
    function revokeMedia(){for(const url of blobUrls.values())URL.revokeObjectURL(url);blobUrls.clear();}
    function current(){return records[source].find(x=>x.ref===selected);}
    function initials(name){return String(name || '?').split(/\s+/).slice(0,2).map(s=>s[0]||'').join('').toUpperCase();}
    function time(value){if(!value)return '';const d=new Date(value);return Number.isFinite(+d)?new Intl.DateTimeFormat('ru-RU',{hour:'2-digit',minute:'2-digit',...(root.ITUS_CONFIG?.DISPLAY_TIME_ZONE?{timeZone:root.ITUS_CONFIG.DISPLAY_TIME_ZONE}:{})}).format(d):'';}
    function day(value){if(!value)return '';return root.ITUS_FEATURES.dateTime(value).split(',')[0];}
    function resize(){if(!visible)return;const frame=document.querySelector('.messenger');if(frame)frame.style.height=Math.max(300,(root.visualViewport?.height || root.innerHeight)-frame.getBoundingClientRect().top-10)+'px';}
    root.addEventListener('resize',resize);root.visualViewport?.addEventListener('resize',resize);
    function listHtml(){
      const q=query.toLocaleLowerCase('ru-RU');
      let items=(section==='contacts'&&source==='staff'?contacts:records[source]).filter(x=>[x.title,x.subtitle,x.lastMessage].join(' ').toLocaleLowerCase('ru-RU').includes(q));
      items=[...items].sort(section==='contacts'?(a,b)=>a.title.localeCompare(b.title,'ru'):(a,b)=>Number(Boolean(b.shiftGroup))-Number(Boolean(a.shiftGroup)) || (Date.parse(b.updatedAt)||0)-(Date.parse(a.updatedAt)||0));
      if(listError[source])return `<div class="msg-empty">${escape(listError[source])}<button data-action="msg-refresh">Повторить</button></div>`;
      if(!items.length)return `<div class="msg-empty">${listBusy[source]||listBusy.contacts?'Загрузка…':q?'Ничего не найдено':section==='contacts'&&source==='staff'?'Нет доступных авторизованных сотрудников':'Нет доступных переписок'}</div>`;
      return items.map(item=>`<button class="msg-thread ${item.ref===selected?'selected':''}" data-action="msg-open" data-ref="${escape(item.ref)}"><span class="msg-avatar">${escape(initials(item.title))}</span><span class="msg-thread-body"><span class="msg-thread-top"><strong>${escape(item.title)}</strong><time>${escape(time(item.updatedAt))}</time></span><span class="msg-thread-bottom"><span>${escape(section==='contacts'?(item.subtitle||'Открыть переписку'):(item.lastMessage||item.subtitle||'Нет сообщений'))}</span>${item.unread>0?`<b class="msg-count">${item.unread}</b>`:''}</span></span></button>`).join('');
    }
    function fileHtml(file,mi,fi){
      const mime=file.mimeType||'',video=/^video\//.test(mime),image=/^image\//.test(mime);
      const bytes=Number(file.sizeBytes)||0;
      const direct=safeUrl(file.previewUrl||file.downloadUrl),embedded=image&&file.contentBase64?`data:${escape(mime||'image/jpeg')};base64,${String(file.contentBase64).replace(/^data:[^,]*,/,'')}`:'';
      const imageHtml=image&&(direct||embedded)?`<img src="${escape(direct||embedded)}" alt="${escape(file.fileName)}" loading="lazy">`:'';
      const action=image?(imageHtml?'':`<button class="msg-image-load" data-action="msg-media" data-auto-image="true" data-mi="${mi}" data-fi="${fi}" aria-label="Загрузить фото"></button>`):`<button data-action="msg-media" data-mi="${mi}" data-fi="${fi}">${video?'▶ Смотреть видео':'Открыть файл'}</button>`;
      return `<div class="msg-file"><div id="msg-media-${mi}-${fi}" class="msg-media">${imageHtml}</div><span>${escape(file.fileName)}</span><small>${bytes? (bytes/1024/1024).toFixed(1)+' МБ':''}</small>${action}</div>`;
    }
    function pollHtml(message){
      if(!message.poll?.question)return '';
      const selected=message.poll.selected;
      return `<div class="msg-poll"><strong>${escape(message.poll.question)}</strong>${(message.poll.options||[]).map(option=>`<button data-action="msg-poll-vote" data-value="${escape(option.value||option.label)}" ${selected?'disabled':''}>${escape(option.label)}${selected===String(option.value||option.label)?' ✓':''}</button>`).join('')}</div>`;
    }
    function historyHtml(){
      const k=selectedKey(),messages=cache[k]||[];
      const n=counts[k]||50,start=Math.max(0,messages.length-n);let previous='';
      let html=start?'<button class="msg-older" data-action="msg-older">Показать предыдущие сообщения</button>':'';
      html+=messages.slice(start).map((m,idx)=>{
        const date=day(m.createdAt),separator=date&&date!==previous?`<div class="msg-date">${escape(date)}</div>`:'';previous=date;
        const author=m.side==='mine'?(user()?.name||m.author):m.author;
        const knownStatus={sent:'Отправлено',delivered:'Получено',read:'Прочитано',received:'Получено',отправлено:'Отправлено',получено:'Получено',прочитано:'Прочитано'}[m.status]||'';
        return `${separator}<article class="msg-bubble ${m.side}" data-message-ref="${escape(m.id)}"><div class="msg-author">${escape(author)}</div>${m.text?`<div class="msg-text">${escape(m.text)}</div>`:''}${pollHtml(m)}${(m.attachments||[]).map((f,fi)=>fileHtml(f,start+idx,fi)).join('')}<div class="msg-time">${escape(time(m.createdAt))}${knownStatus?' · '+knownStatus:''}</div></article>`;
      }).join('');
      return html || `<div class="msg-empty">${busy[k]?'Загрузка сообщений…':'Сообщений пока нет'}</div>`;
    }
    function conversationHtml(){
      const item=current(),k=selectedKey();
      if(!item)return '<div class="msg-placeholder"><span>ИТУС</span><h2>Выберите переписку</h2><p>Клиенты и сотрудники в одном разделе</p></div>';
      const uploadState=sending[k]==='upload';
      return `<header class="msg-conversation-head"><button class="msg-back" data-action="msg-back" aria-label="Назад к чатам">←</button><span class="msg-avatar">${escape(initials(item.title))}</span><div><strong>${escape(item.title)}</strong><small>${escape(item.subtitle||labels[source])}</small></div><button data-action="msg-refresh-messages" aria-label="Обновить сообщения" ${busy[k]?'disabled':''}>↻</button></header>${errors[k]?`<div class="msg-error" role="alert">${escape(errors[k])}</div>`:''}<div class="msg-history" role="log" aria-label="История переписки">${historyHtml()}</div>${uploadState?'<div class="msg-uploading" role="status"><span class="spinner"></span>Загрузка вложения в 1С…</div>':''}<div class="msg-compose"><button data-action="msg-attach" aria-label="Прикрепить файл">＋</button>${source==='clients'?'<button class="msg-poll-button" data-action="msg-poll" aria-label="Создать опрос">☑</button>':''}<textarea id="msgDraft" rows="1" aria-label="Сообщение" placeholder="Сообщение">${escape(drafts[k]||'')}</textarea><button class="msg-send" data-action="msg-send" ${sending[k]?'disabled':''} aria-label="Отправить сообщение">${sending[k]?'…':'➤'}</button></div>`;
    }
    function paint({bottom=false}={}){
      if(!visible)return;
      document.body.classList.toggle('messenger-conversation',Boolean(selected));
      const app=document.getElementById('app');if(!app)return;
      const old=app.querySelector('.msg-history'),oldTop=old?.scrollTop||0;
      const nearBottom=!old || old.scrollHeight-old.scrollTop-old.clientHeight<80;
      revokeMedia();
      app.innerHTML=`<div class="messenger ${selected?'has-conversation':''}"><aside class="msg-sidebar"><div class="msg-sidebar-head"><h2>Чаты</h2><button data-action="msg-settings" aria-label="Настройки уведомлений">⚙</button><button data-action="msg-refresh" aria-label="Обновить список">↻</button></div><div class="msg-filters">${allowed().map(s=>`<button class="${source===s?'active':''}" data-action="msg-source" data-source="${s}">${labels[s]}</button>`).join('')}</div>${source==='staff'?'<button class="msg-new-chat" data-action="msg-new-chat">＋ Новый чат с сотрудником</button>':''}<div class="msg-sections"><button class="${section==='chats'?'active':''}" data-action="msg-section" data-section="chats">Переписки</button><button class="${section==='contacts'?'active':''}" data-action="msg-section" data-section="contacts">Контакты</button></div><input id="msgSearch" type="search" placeholder="Поиск" aria-label="Поиск чатов и контактов" value="${escape(query)}">${section==='contacts'?'<p class="msg-contact-note">Выберите сотрудника, который авторизовался в приложении</p>':''}<div class="msg-thread-list">${listHtml()}</div></aside><section class="msg-conversation">${conversationHtml()}</section></div>`;
      const history=app.querySelector('.msg-history');if(history)history.scrollTop=bottom||nearBottom?history.scrollHeight:oldTop;
      app.querySelectorAll?.('[data-auto-image="true"]').forEach(button=>void media(Number(button.dataset.mi),Number(button.dataset.fi)));
      resize();
    }
    async function loadList(s=source){
      if(!permitted(s)||listBusy[s])return;const generation=epoch;listBusy[s]=true;listError[s]='';paint();
      try{
        const response=await call(endpoints(s)+(s==='clients'?'/topics/list':'/groups/list'),s==='clients'?{status:'active'}:{},{silent:true});
        if(epoch!==generation)return;
        records[s]=api.extractItems(response,s==='clients'?['topics']:['groups']).map((raw,i)=>({...api.normalizeTopic(raw,i),shiftGroup:s==='staff'&&String(raw.title||raw.name||'').trim().toLocaleLowerCase('ru-RU')==='передача смены',updatedAt:raw.updatedAt||raw.lastMessage?.createdAt||raw.lastMessageAt||''}));
        if(s==='staff'&&!records.staff.some(x=>x.shiftGroup))listError.staff='1С не вернула обязательную группу «Передача смены»';
        loaded[s]=true;
        if(source===s&&selected&&!records[s].some(x=>x.ref===selected))selected='';
      }catch(e){if(epoch===generation)listError[s]=s==='staff'&&e.status===404?'В 1С не настроен метод сотрудников и группы чата: /internal-chat/groups/list.':e.message;}
      finally{if(epoch===generation){listBusy[s]=false;paint();}}
    }
    async function loadContacts(){
      if(contactsLoaded||listBusy.contacts)return;
      const generation=epoch;listBusy.contacts=true;listError.staff='';paint();
      try{
        const response=await call('/internal-chat/contacts/list',{}, {silent:true});
        if(epoch!==generation)return;
        contacts=api.extractItems(response,['contacts','employees']).filter(x=>x.authorized===true || x.isAuthorized===true).map((raw,i)=>({...api.normalizeTopic(raw,i),employeeRef:String(raw.employeeRef||raw.userRef||raw.id||''),conversationRef:String(raw.conversationRef||raw.groupRef||'')}));
        contactsLoaded=true;
      }catch(e){if(epoch===generation)listError.staff=e.status===404?'В 1С не настроен метод авторизованных сотрудников: /internal-chat/contacts/list.':e.message;}
      finally{if(epoch===generation){listBusy.contacts=false;paint();}}
    }
    async function markRead(s,id,messages){
      const refs=messages.filter(m=>m.side==='theirs' && m.id).map(m=>m.id);
      const item=records[s].find(x=>x.ref===id);
      if(!item || (!item.unread && !refs.length))return;
      const generation = epoch;
      const previousUnread = Number(item.unread) || 0;
      const response = await call(endpoints(s)+'/messages/read',{...params(s,id),messageRefs:refs},{silent:true});
      if (generation !== epoch) return;
      const data = response.data || response;
      const remainingUnread = Number.isFinite(data.unreadCount) && data.unreadCount >= 0 ? data.unreadCount : 0;
      item.unread = remainingUnread;
      options.onRead?.({source:s,ref:id,previousUnread,remainingUnread,totalUnread:data.unreadMessagesCount});
    }
    async function loadMessages(s,id,{force=false}={}){
      const k=key(s,id);if(!permitted(s)||busy[k])return;
      if(!force&&cache[k]){
        try{if(visible && !document.hidden && records[s].find(x=>x.ref===id)?.unread)await markRead(s,id,cache[k]);errors[k]='';}
        catch(e){errors[k]=e.message;}
        paint({bottom:true});return;
      }
      const generation=epoch;busy[k]=true;errors[k]='';paint();
      try{
        const response=await call(endpoints(s)+'/messages/list',{...params(s,id),includeAttachmentContent:false},{silent:true});
        if(epoch!==generation)return;
        cache[k]=sortedMessages(api.extractItems(response,['messages']).map(api.normalizeMessage));
        const data=response.data||response;
        const item=records[s].find(x=>x.ref===id);
        if(item){
          const last=cache[k].at(-1);if(last){item.lastMessage=last.text||(last.attachments.length?'Вложение':'');item.updatedAt=last.createdAt||item.updatedAt;}
          if(Number.isFinite(data.unreadCount))item.unread=data.unreadCount;
        }
        if(visible && !document.hidden && source===s&&selected===id)await markRead(s,id,cache[k]);
      }catch(e){if(epoch===generation)errors[k]=e.message;}
      finally{if(epoch===generation){busy[k]=false;if(source===s&&selected===id)paint();}}
    }
    async function open(id){
      if(source==='staff'&&section==='contacts'){
        const contact=contacts.find(x=>x.ref===id);if(!contact || openingContact)return;
        const generation=epoch;openingContact=true;
        try{
          const result=contact.conversationRef?null:await call('/internal-chat/direct/open',{employeeRef:contact.employeeRef},{silent:true});
          if(generation!==epoch)return;
          const ref=contact.conversationRef||String(result?.data?.groupRef||result?.groupRef||'');
          if(!ref)throw new Error('1С не вернула идентификатор личной переписки');
          contact.conversationRef=ref;
          if(!records.staff.some(x=>x.ref===ref))records.staff.push({...contact,ref});
          id=ref;section='chats';
        }catch(e){errors[key(source,id)]=e.message;toast(e.message,true);return;}
        finally{openingContact=false;}
      }
      selected=id;if(!current()){selected='';return paint();}paint({bottom:true});await loadMessages(source,id);
    }
    async function send(file,kind,target){
      const s=target?.source||source,id=target?.ref||selected,k=key(s,id);
      const text=drafts[k]?.trim()||'';
      if(!id||!permitted(s)||(!file&&!text)||sending[k])return;
      const signature=file?`file:${kind||''}:${file.name||''}:${file.size||0}:${file.lastModified||0}`:`text:${text}`;
      const clientMessageId=attempt(s,id,signature);
      const generation=epoch,original=drafts[k];sending[k]=file?'upload':true;errors[k]='';paint();
      try{
        const payload={...params(s,id),clientMessageId};
        if(file){payload.file=await filePayload(file,kind);payload.kind=kind;}else payload.text=text;
        if(generation!==epoch)return;
        const response=await call(endpoints(s)+(file?'/files/send':'/messages/send'),payload,{silent:true});
        if(generation!==epoch)return;
      if(!file&&drafts[k]===original)drafts[k]='';
        const data=response.data||response;
        if(data.message&&typeof data.message==='object'){
          // Ответ /send иногда возвращает только messageRef и имя контакта.
          // Для исходящего сообщения автором всегда является текущий пользователь.
          const message=api.normalizeMessage({...data.message,direction:'outgoing',isMine:true,authorName:user()?.name||data.message.authorName,status:data.message.status||'sent'},Date.now());
          cache[k]=sortedMessages([...(cache[k]||[]).filter(x=>x.id!==message.id),message]);
          const item=records[s].find(x=>x.ref===id);if(item){item.lastMessage=message.text||'Вложение';item.updatedAt=message.createdAt;}
        }else await loadMessages(s,id,{force:true});
        finishAttempt(s,id,signature);toast('Отправлено');if(file)closeSheet();
      }catch(e){if(generation===epoch){errors[k]=e.message;toast(e.message,true);}}
      finally{if(generation===epoch){sending[k]=false;paint({bottom:true});}}
    }
    async function media(mi,fi){
      let file=cache[selectedKey()]?.[mi]?.attachments?.[fi];if(!file)return;
      const slot=document.getElementById(`msg-media-${mi}-${fi}`);if(!slot)return;
      let url=safeUrl(file.downloadUrl);const mime=file.mimeType||'application/octet-stream';
      if(!url&&!file.contentBase64&&file.fileRef){
        try{
          const response=await call(endpoints(source)+'/messages/list',{...params(source,selected),includeAttachmentContent:true,attachmentRef:file.fileRef},{silent:true});
          const fresh=sortedMessages(api.extractItems(response,['messages']).map(api.normalizeMessage));
          if(fresh.length){cache[selectedKey()]=fresh;file=cache[selectedKey()]?.[mi]?.attachments?.[fi]||file;url=safeUrl(file.downloadUrl);}
        }catch(e){return toast('Не удалось загрузить вложение: '+e.message,true);}
      }
      if(!url&&file.contentBase64){
        const k=selectedKey()+':'+mi+':'+fi;url=blobUrls.get(k);
        if(!url){try{const raw=atob(file.contentBase64.replace(/^data:[^,]*,/,''));const bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));url=URL.createObjectURL(new Blob([bytes],{type:mime}));blobUrls.set(k,url);}catch{return toast('Не удалось прочитать вложение',true);}}
      }
      if(!url)return toast('1С не передала ссылку или содержимое файла',true);
      if(/^video\//.test(mime)){const v=document.createElement('video');v.controls=true;v.playsInline=true;v.preload='none';v.src=url;slot.replaceChildren(v);v.play()?.catch(()=>{});}
      else if(/^image\//.test(mime)){const img=document.createElement('img');img.src=url;img.alt=file.fileName;slot.replaceChildren(img);}
      else{const a=document.createElement('a');a.href=url;a.target='_blank';a.rel='noopener';a.download=file.fileName;a.click();}
    }
    function back(){if(!visible||!selected)return false;selected='';paint();return true;}
    async function enter(preferred){visible=true;if(preferred&&permitted(preferred)&&source!==preferred){source=preferred;selected='';}if(!permitted(source))source=allowed()[0]||'clients';paint();if(!loaded[source])await loadList();}
    async function handle(action,button){
      if(action==='msg-new-chat'){if(!permitted('staff'))return;source='staff';section='contacts';selected='';query='';contactsLoaded=false;paint();await loadContacts();return;}
      if(action==='msg-source'){const s=button.dataset.source;if(!permitted(s))return;source=s;section='chats';selected='';query='';paint();if(!loaded[s])await loadList(s);}
      if(action==='msg-section'){section=button.dataset.section;paint();if(section==='contacts'&&source==='staff')await loadContacts();}
      if(action==='msg-open')await open(button.dataset.ref);
      if(action==='msg-back')back();
      if(action==='msg-refresh'){if(section==='contacts'&&source==='staff'){contactsLoaded=false;await loadContacts();}else await loadList();}
      if(action==='msg-refresh-messages')await loadMessages(source,selected,{force:true});
      if(action==='msg-send')await send();
      if(action==='msg-older'){const h=document.querySelector('.msg-history'),oldHeight=h?.scrollHeight||0;counts[selectedKey()]=(counts[selectedKey()]||50)+50;paint();const n=document.querySelector('.msg-history');if(n)n.scrollTop=n.scrollHeight-oldHeight;}
      if(action==='msg-media')await media(Number(button.dataset.mi),Number(button.dataset.fi));
      if(action==='msg-settings')options.settings();
      if(action==='msg-attach'){
        options.sheet('Вложения','Куда: '+current().title,`<div class="grid"><button data-action="msg-photo">Фото: камера или галерея</button><button data-action="msg-video">Видео из галереи</button><button data-action="msg-file">Документ</button></div>`);
      }
      if(action==='msg-poll') options.sheet('Опрос согласования','Ответ клиента будет сохранён в 1С',`<label for="msgPollQuestion">Вопрос</label><input id="msgPollQuestion" value="Согласовано ли выполнение работ?" maxlength="200"><p class="tiny">Варианты: «Согласовано» и «Не согласовано»</p><button class="primary" data-action="msg-poll-send">Отправить опрос</button>`);
      if(action==='msg-poll-send'){
        const question=String(document.getElementById('msgPollQuestion')?.value||'').trim();
        if(!question)return toast('Введите вопрос для опроса',true);
        const s=source,id=selected,k=key(s,id);sending[k]=true;paint();
        try{
          const result=await call('/clients/polls/send',{...params('clients',id),clientMessageId:root.crypto.randomUUID?root.crypto.randomUUID():String(Date.now()),kind:'poll',messageType:'poll',poll:{question,options:['Согласовано','Не согласовано']}},{silent:true});
          const data=result.data||result;if(data.message){cache[k]=[...(cache[k]||[]),api.normalizeMessage(data.message,Date.now())];}else await loadMessages(s,id,{force:true});
          options.closeSheet();toast('Опрос отправлен клиенту');
        }catch(e){errors[k]=e.message;toast(e.message,true);}finally{sending[k]=false;paint({bottom:true});}
      }
      if(action==='msg-poll-vote'){
        if(source!=='clients'||!selected)return;
        try{await call('/clients/polls/vote',{...params('clients',selected),messageRef:button.closest('.msg-bubble')?.dataset?.messageRef||'',option:button.dataset.value},{silent:true});await loadMessages('clients',selected,{force:true});toast('Ответ сохранён');}
        catch(e){toast(e.message,true);}
      }
      const target={type:'messenger',source,ref:selected};
      if(action==='msg-photo')photo({...target,kind:'photo'});
      if(action==='msg-video')pickFile({...target,kind:'video'},'video/*');
      if(action==='msg-file')pickFile({...target,kind:'file'},'*/*');
    }
    document.addEventListener('input',e=>{
      if(!visible)return;
      if(e.target.id==='msgDraft')drafts[selectedKey()]=e.target.value;
      if(e.target.id==='msgSearch'){query=e.target.value;const list=document.querySelector('.msg-thread-list');if(list)list.innerHTML=listHtml();}
    });
    return {enter,paint,back,handle,upload:(file,target)=>send(file,target.kind,target),
      leave(){visible=false;document.body.classList.remove('messenger-conversation');revokeMedia();},
      reset(){epoch++;visible=false;document.body.classList.remove('messenger-conversation');revokeMedia();records={clients:[],staff:[]};contacts=[];contactsLoaded=false;loaded={};listBusy={};listError={};cache={};busy={};errors={};drafts={};sending={};counts={};attempts={};selected='';query='';},
      async notify(event){if(event.type==='new_messages'){loaded.clients=false;loaded.staff=false;/* список обновится при открытии, чтобы не грузить чат на каждом пинге */}}
    };
  }
  root.ITUS_MESSENGER={create,safeUrl};
})(typeof window==='undefined'?globalThis:window);
