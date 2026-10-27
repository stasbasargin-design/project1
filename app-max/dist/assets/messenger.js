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
    let source='clients',section='chats',selected='',query='',visible=false,epoch=0,selectionEpoch=0;
    let records={clients:[],staff:[]},contacts=[],contactsLoaded=false,loaded={},listBusy={},listError={},cache={},busy={},errors={},drafts={},sending={},counts={},attempts={},refreshPending={};
    const blobUrls=new Map();
    const mediaMemory=new Map(), mediaLoading=new Map(), restored=new Set();
    const CACHE_DB='itus-max-messenger-v1', CACHE_TTL=7*24*60*60*1000, CACHE_THREADS=40, CACHE_MEDIA_BYTES=25*1024*1024;
    let openingContact=false;
    const key=(s,id)=>s+':'+id;
    const selectedKey=()=>key(source,selected);
    const isVisibleThread=(s,id)=>visible&&!document.hidden&&source===s&&selected===id;
    const owner=()=>String(options.cacheOwner?.() || user()?.id || user()?.userId || '').trim();
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
    function db(){
      if(!root.indexedDB || !owner())return Promise.resolve(null);
      return new Promise(resolve=>{const request=root.indexedDB.open(CACHE_DB,1);request.onupgradeneeded=()=>{const database=request.result;if(!database.objectStoreNames.contains('threads'))database.createObjectStore('threads',{keyPath:'key'});if(!database.objectStoreNames.contains('media'))database.createObjectStore('media',{keyPath:'key'});};request.onsuccess=()=>resolve(request.result);request.onerror=()=>resolve(null);});
    }
    async function readStore(store,keyValue){const database=await db();if(!database)return null;return new Promise(resolve=>{const request=database.transaction(store,'readonly').objectStore(store).get(keyValue);request.onsuccess=()=>resolve(request.result||null);request.onerror=()=>resolve(null);});}
    async function allStore(store){const database=await db();if(!database)return [];return new Promise(resolve=>{const request=database.transaction(store,'readonly').objectStore(store).getAll();request.onsuccess=()=>resolve(request.result||[]);request.onerror=()=>resolve([]);});}
    async function writeStore(store,value){const database=await db();if(!database)return;await new Promise(resolve=>{const request=database.transaction(store,'readwrite').objectStore(store).put(value);request.onsuccess=request.onerror=()=>resolve();});}
    async function deleteStore(store,keyValue){const database=await db();if(!database)return;await new Promise(resolve=>{const request=database.transaction(store,'readwrite').objectStore(store).delete(keyValue);request.onsuccess=request.onerror=()=>resolve();});}
    function persistentKey(type,value){return `${owner()}:${type}:${value}`;}
    function cleanFile(file){const {downloadUrl,previewUrl,contentBase64,...safe}=file||{};return safe;}
    function cleanMessage(message){return {...message,attachments:(message.attachments||[]).map(cleanFile)};}
    async function trimPersistentCache(){const now=Date.now(),who=owner();const threads=(await allStore('threads')).filter(item=>item.owner===who).sort((a,b)=>b.updatedAt-a.updatedAt);for(const item of threads.slice(CACHE_THREADS))await deleteStore('threads',item.key);for(const item of threads.filter(item=>now-item.updatedAt>CACHE_TTL))await deleteStore('threads',item.key);let total=0;const media=(await allStore('media')).filter(item=>item.owner===who).sort((a,b)=>b.updatedAt-a.updatedAt);for(const item of media){if(now-item.updatedAt>CACHE_TTL || total+item.size>CACHE_MEDIA_BYTES)await deleteStore('media',item.key);else total+=item.size;}}
    async function clearPersistentCache(){const who=owner();if(!who)return;for(const store of ['threads','media'])for(const item of await allStore(store))if(item.owner===who)await deleteStore(store,item.key);}
    async function persistThread(k){if(!owner()||!cache[k])return;await writeStore('threads',{key:persistentKey('thread',k),owner:owner(),thread:k,updatedAt:Date.now(),messages:cache[k].slice(-200).map(cleanMessage)});void trimPersistentCache();}
    async function restoreThread(k){if(restored.has(k)||!owner())return;restored.add(k);const item=await readStore('threads',persistentKey('thread',k));if(item?.owner===owner()&&Date.now()-item.updatedAt<CACHE_TTL&&Array.isArray(item.messages)){cache[k]=sortedMessages(item.messages);}}
    function messageIdentity(message,index){return String(message.id || message.messageRef || `${message.createdAt||''}:${message.author||''}:${message.text||''}:${index}`);}
    function mergeMessages(previous,incoming){const merged=new Map();[...(previous||[]),...(incoming||[])].forEach((message,index)=>{const id=messageIdentity(message,index),old=merged.get(id);const next=old?{...old,...message,attachments:(message.attachments?.length?message.attachments:old.attachments)||[]}:message;if(old?.authorKnown&&!message.authorKnown){next.author=old.author;next.authorKnown=true;}merged.set(id,next);});return sortedMessages([...merged.values()]);}
    function attachmentKey(s,id,messageRef,file){return file?.fileRef&&messageRef?persistentKey('media',`${s}:${id}:${messageRef}:${file.fileRef}`):'';}
    function current(){return records[source].find(x=>x.ref===selected);}
    function initials(name){return String(name || '?').split(/\s+/).slice(0,2).map(s=>s[0]||'').join('').toUpperCase();}
    function time(value){if(!value)return '';const d=new Date(value);return Number.isFinite(+d)?new Intl.DateTimeFormat('ru-RU',{hour:'2-digit',minute:'2-digit',...(root.ITUS_CONFIG?.DISPLAY_TIME_ZONE?{timeZone:root.ITUS_CONFIG.DISPLAY_TIME_ZONE}:{})}).format(d):'';}
    function day(value){if(!value)return '';return root.ITUS_FEATURES.dateTime(value).split(',')[0];}
    function resize(){if(!visible)return;const frame=document.querySelector('.messenger');if(!frame)return;const viewport=root.visualViewport;const bottom=Number(viewport?.height || root.innerHeight)+Number(viewport?.offsetTop || 0);const height=Math.max(0,bottom-frame.getBoundingClientRect().top-10);frame.style.height=height+'px';frame.style.minHeight=Math.min(300,height)+'px';}
    root.addEventListener('resize',resize);root.addEventListener('orientationchange',resize);root.visualViewport?.addEventListener('resize',resize);root.visualViewport?.addEventListener('scroll',resize);
    function listHtml(){
      const q=query.toLocaleLowerCase('ru-RU');
      let items=(section==='contacts'&&source==='staff'?contacts:records[source]).filter(x=>[x.title,x.subtitle,x.lastMessage].join(' ').toLocaleLowerCase('ru-RU').includes(q));
      items=[...items].sort(section==='contacts'?(a,b)=>a.title.localeCompare(b.title,'ru'):(a,b)=>Number(Boolean(b.common))-Number(Boolean(a.common)) || Number(Boolean(b.shiftGroup))-Number(Boolean(a.shiftGroup)) || (Date.parse(b.updatedAt)||0)-(Date.parse(a.updatedAt)||0));
      if(listError[source])return `<div class="msg-empty">${escape(listError[source])}<button data-action="msg-refresh">Повторить</button></div>`;
      if(!items.length)return `<div class="msg-empty">${listBusy[source]||listBusy.contacts?'Загрузка…':q?'Ничего не найдено':section==='contacts'&&source==='staff'?'Нет доступных авторизованных сотрудников':'Нет доступных переписок'}</div>`;
      return items.map(item=>`<button class="msg-thread ${item.ref===selected?'selected':''} ${item.common?'common':''}" data-action="msg-open" data-ref="${escape(item.ref)}"><span class="msg-avatar">${escape(initials(item.title))}</span><span class="msg-thread-body"><span class="msg-thread-top"><strong>${escape(item.title)}${item.common?'<span class="msg-common-badge">Общий чат</span>':''}</strong><time>${escape(time(item.updatedAt))}</time></span><span class="msg-thread-bottom"><span>${escape(section==='contacts'?(item.subtitle||'Открыть переписку'):(item.lastMessage||item.subtitle||'Нет сообщений'))}</span>${item.unread>0?`<b class="msg-count">${item.unread}</b>`:''}</span></span></button>`).join('');
    }
    function fileHtml(file,mi,fi){
      const mime=file.mimeType||'',video=/^video\//.test(mime),image=/^image\//.test(mime);
      const bytes=Number(file.sizeBytes)||0;
      const preview=safeUrl(file.previewUrl);
      const thumbnail=image&&preview?`<img src="${escape(preview)}" alt="${escape(file.fileName)}" loading="lazy">`:'';
      const extension=(String(file.fileName||'').match(/(\.[a-z0-9]{1,10})$/i)||['',''])[1];
      const action=image?'Открыть фото':(video?'Смотреть видео':'Скачать файл');
      return `<div class="msg-file ${image?'is-image':''}"><div id="msg-media-${mi}-${fi}" class="msg-media">${thumbnail}</div><span>${escape(file.fileName)}</span><small>${extension?escape(extension.slice(1).toUpperCase())+' · ':''}${bytes? (bytes/1024/1024).toFixed(1)+' МБ':''}</small><button data-action="msg-media" data-mi="${mi}" data-fi="${fi}">${action}</button></div>`;
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
        // The history belongs to a conversation, not to the viewer.  Never
        // derive an author from the logged-in reader or from local state.
        const author=m.author || 'Отправитель не указан';
        const knownStatus={sent:'Отправлено',delivered:'Получено',read:'Прочитано',received:'Получено',отправлено:'Отправлено',получено:'Получено',прочитано:'Прочитано'}[m.status]||'';
        return `${separator}<article class="msg-bubble ${m.side}" data-message-ref="${escape(m.id)}"><div class="msg-author">${escape(author)}</div>${m.text?`<div class="msg-text">${escape(m.text)}</div>`:''}${pollHtml(m)}${(m.attachments||[]).map((f,fi)=>fileHtml(f,start+idx,fi)).join('')}<div class="msg-time">${escape(time(m.createdAt))}${knownStatus?' · '+knownStatus:''}</div></article>`;
      }).join('');
      return html || `<div class="msg-empty">${busy[k]?'Загрузка сообщений…':'Сообщений пока нет'}</div>`;
    }
    function conversationHtml(){
      const item=current(),k=selectedKey();
      if(!item)return '<div class="msg-placeholder"><span>I-MAX</span><h2>Выберите переписку</h2><p>Клиенты и сотрудники в одном разделе</p></div>';
      const uploadState=sending[k]==='upload';
      return `<header class="msg-conversation-head"><button class="msg-back" data-action="msg-back" aria-label="Назад к чатам">←</button><span class="msg-avatar">${escape(initials(item.title))}</span><div><strong>${escape(item.title)}</strong><small>${escape(item.subtitle||labels[source])}</small></div><button data-action="msg-refresh-messages" aria-label="Обновить сообщения" ${busy[k]?'disabled':''}>↻</button></header>${errors[k]?`<div class="msg-error" role="alert">${escape(errors[k])}</div>`:''}<div class="msg-history" role="log" aria-label="История переписки">${historyHtml()}</div>${uploadState?'<div class="msg-uploading" role="status"><span class="spinner"></span>Загрузка вложения в 1С…</div>':''}<div class="msg-compose"><button data-action="msg-attach" aria-label="Прикрепить файл">＋</button>${source==='clients'?'<button class="msg-poll-button" data-action="msg-poll" aria-label="Создать опрос">☑</button>':''}<textarea id="msgDraft" rows="1" aria-label="Сообщение" placeholder="Сообщение">${escape(drafts[k]||'')}</textarea><button class="msg-send" data-action="msg-send" ${sending[k]?'disabled':''} aria-label="Отправить сообщение">${sending[k]?'…':'➤'}</button></div>`;
    }
    function paint({bottom=false}={}){
      if(!visible)return;
      document.body.classList.toggle('messenger-conversation',Boolean(selected));
      const app=document.getElementById('app');if(!app)return;
      const old=app.querySelector('.msg-history'),oldTop=old?.scrollTop||0;
      const nearBottom=!old || old.scrollHeight-old.scrollTop-old.clientHeight<80;
      app.innerHTML=`<div class="messenger ${selected?'has-conversation':''}"><aside class="msg-sidebar"><div class="msg-sidebar-head"><h2>Чаты</h2><button data-action="msg-settings" aria-label="Настройки уведомлений">⚙</button><button data-action="msg-refresh" aria-label="Обновить список">↻</button></div><div class="msg-filters">${allowed().map(s=>`<button class="${source===s?'active':''}" data-action="msg-source" data-source="${s}">${labels[s]}</button>`).join('')}</div>${source==='staff'?'<button class="msg-new-chat" data-action="msg-new-chat">＋ Новый чат с сотрудником</button>':''}<div class="msg-sections"><button class="${section==='chats'?'active':''}" data-action="msg-section" data-section="chats">Переписки</button><button class="${section==='contacts'?'active':''}" data-action="msg-section" data-section="contacts">Контакты</button></div><input id="msgSearch" type="search" placeholder="Поиск" aria-label="Поиск чатов и контактов" value="${escape(query)}">${section==='contacts'?'<p class="msg-contact-note">Выберите сотрудника, который авторизовался в приложении</p>':''}<div class="msg-thread-list">${listHtml()}</div></aside><section class="msg-conversation">${conversationHtml()}</section></div>`;
      const history=app.querySelector('.msg-history');if(history)history.scrollTop=bottom||nearBottom?history.scrollHeight:oldTop;
      resize();
    }
    function paintHistory({bottom=false}={}){
      const history=document.querySelector('.msg-history');if(!history)return false;
      const oldTop=history.scrollTop,nearBottom=history.scrollHeight-history.scrollTop-history.clientHeight<80;
      history.innerHTML=historyHtml();history.scrollTop=bottom||nearBottom?history.scrollHeight:oldTop;return true;
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
    async function loadMessages(s,id,{refresh=false}={}){
      const k=key(s,id);if(!permitted(s)||busy[k])return;
      const generation=epoch,threadSelectionEpoch=selectionEpoch;busy[k]=true;
      await restoreThread(k);
      if(epoch!==generation||selectionEpoch!==threadSelectionEpoch||!isVisibleThread(s,id)){busy[k]=false;delete refreshPending[k];return;}
      if(!refresh&&cache[k]){
        try{if(visible && !document.hidden && records[s].find(x=>x.ref===id)?.unread)await markRead(s,id,cache[k]);errors[k]='';}
        catch(e){errors[k]=e.message;}
        finally{busy[k]=false;}
        paint({bottom:true});return;
      }
      errors[k]='';paint();
      try{
        const response=await call(endpoints(s)+'/messages/list',{...params(s,id),includeAttachmentContent:false},{silent:true});
        if(epoch!==generation||selectionEpoch!==threadSelectionEpoch||!isVisibleThread(s,id))return;
        // Current 1C contract has no cursor/afterMessageRef. Merge the light list
        // by stable message id, preserving already cached attachment metadata.
        cache[k]=mergeMessages(cache[k],api.extractItems(response,['messages']).map(api.normalizeMessage));
        void persistThread(k);
        const data=response.data||response;
        const item=records[s].find(x=>x.ref===id);
        if(item){
          const last=cache[k].at(-1);if(last){item.lastMessage=last.text||(last.attachments.length?'Вложение':'');item.updatedAt=last.createdAt||item.updatedAt;}
          if(Number.isFinite(data.unreadCount))item.unread=data.unreadCount;
        }
        if(visible && !document.hidden && source===s&&selected===id)await markRead(s,id,cache[k]);
      }catch(e){if(epoch===generation&&selectionEpoch===threadSelectionEpoch&&isVisibleThread(s,id))errors[k]=e.message;}
      finally{
        busy[k]=false;
        if(epoch===generation&&selectionEpoch===threadSelectionEpoch&&isVisibleThread(s,id)&&!paintHistory({bottom:true}))paint();
        const refreshAgain=refreshPending[k];delete refreshPending[k];
        if(refreshAgain&&isVisibleThread(s,id))void loadMessages(s,id,{refresh:true});
      }
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
      selectionEpoch++;selected=id;if(!current()){selected='';return paint();}paint({bottom:true});
      // A cached thread is rendered immediately, but switching to a conversation
      // must also fetch its current light-weight history.  Attachments stay lazy
      // and cached: this request explicitly does not include file content.
      await loadMessages(source,id,{refresh:true});
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
          // A confirmed server response may not borrow the viewer's name.
          // If 1C did not return authorName/senderName/from, keep it neutral
          // and refresh the light history where 1C supplies the real author.
          const message=api.normalizeMessage({...data.message,direction:'outgoing',isMine:true,status:data.message.status||'sent'},Date.now());
          cache[k]=mergeMessages((cache[k]||[]).filter(x=>x.id!==message.id),[message]);void persistThread(k);
          const item=records[s].find(x=>x.ref===id);if(item){item.lastMessage=message.text||'Вложение';item.updatedAt=message.createdAt;}
          if(!message.authorKnown)await loadMessages(s,id,{refresh:true});
        }else await loadMessages(s,id,{refresh:true});
        finishAttempt(s,id,signature);toast('Отправлено');if(file)closeSheet();
      }catch(e){if(generation===epoch){errors[k]=e.message;toast(e.message,true);}}
      finally{if(generation===epoch){sending[k]=false;paint({bottom:true});}}
    }
    async function legacyMedia(mi,fi){
      const message=cache[selectedKey()]?.[mi];let file=message?.attachments?.[fi];if(!file)return;
      const slot=document.getElementById(`msg-media-${mi}-${fi}`);if(!slot)return;
      let url=safeUrl(file.downloadUrl);const mime=file.mimeType||'application/octet-stream';
      if(!url&&!file.contentBase64&&file.fileRef&&message?.hasServerMessageRef){
        try{
          const response=await call(endpoints(source)+'/messages/list',{...params(source,selected),includeAttachmentContent:true,messageRef:message.messageRef,attachmentRef:file.fileRef},{silent:true});
          const fresh=sortedMessages(api.extractItems(response,['messages']).map(api.normalizeMessage));
          if(fresh.length){cache[selectedKey()]=fresh;file=cache[selectedKey()]?.[mi]?.attachments?.[fi]||file;url=safeUrl(file.downloadUrl);}
        }catch(e){return toast('Не удалось загрузить вложение: '+e.message,true);}
      }
      if(!url&&file.fileRef&&!message?.hasServerMessageRef)return toast('1С не передала идентификатор сообщения для вложения',true);
      if(!url&&file.contentBase64){
        const k=selectedKey()+':'+mi+':'+fi;url=blobUrls.get(k);
        if(!url){try{const raw=atob(file.contentBase64.replace(/^data:[^,]*,/,''));const bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));url=URL.createObjectURL(new Blob([bytes],{type:mime}));blobUrls.set(k,url);}catch{return toast('Не удалось прочитать вложение',true);}}
      }
      if(!url)return toast('1С не передала ссылку или содержимое файла',true);
      if(/^video\//.test(mime)){const v=document.createElement('video');v.controls=true;v.playsInline=true;v.preload='none';v.src=url;slot.replaceChildren(v);v.play()?.catch(()=>{});}
      else if(/^image\//.test(mime)){const img=document.createElement('img');img.src=url;img.alt=file.fileName;slot.replaceChildren(img);}
      else{const a=document.createElement('a');a.href=url;a.target='_blank';a.rel='noopener';a.download=file.fileName;a.click();}
    }
    async function media(mi,fi){
      const thread=selectedKey(),message=cache[thread]?.[mi];let file=message?.attachments?.[fi];if(!file)return;
      const slot=document.getElementById(`msg-media-${mi}-${fi}`);if(!slot)return;
      const mime=file.mimeType||'application/octet-stream',stableKey=attachmentKey(source,selected,message?.messageRef,file);
      async function asUrl(record){
        if(!record?.blob)return '';
        const existing=blobUrls.get(stableKey);if(existing)return existing;
        const url=URL.createObjectURL(record.blob);blobUrls.set(stableKey,url);return url;
      }
      let record=stableKey?mediaMemory.get(stableKey):null;
      if(!record&&stableKey){record=await readStore('media',stableKey);if(record?.owner===owner()&&Date.now()-record.updatedAt<CACHE_TTL)mediaMemory.set(stableKey,record);else record=null;}
      if(!record&&file.contentBase64){try{const raw=atob(file.contentBase64.replace(/^data:[^,]*,/,''));record={blob:new Blob([Uint8Array.from(raw,c=>c.charCodeAt(0))],{type:mime}),size:raw.length,updatedAt:Date.now(),owner:owner(),key:stableKey};}catch{record=null;}}
      if(!record&&file.fileRef&&!message?.hasServerMessageRef)return toast('1С не передала идентификатор сообщения для вложения',true);
      if(!record&&stableKey){
        let pending=mediaLoading.get(stableKey);
        if(!pending){pending=(async()=>{
          const response=await call(endpoints(source)+'/messages/list',{...params(source,selected),includeAttachmentContent:true,messageRef:message.messageRef,attachmentRef:file.fileRef},{silent:true});
          const fresh=api.extractItems(response,['messages']).map(api.normalizeMessage);cache[thread]=mergeMessages(cache[thread],fresh);void persistThread(thread);
          const matched=cache[thread].find(item=>item.messageRef===message.messageRef)?.attachments?.find(item=>item.fileRef===file.fileRef);
          if(!matched.contentBase64)return null;
          const raw=atob(matched.contentBase64.replace(/^data:[^,]*,/,''));const saved={key:stableKey,owner:owner(),blob:new Blob([Uint8Array.from(raw,c=>c.charCodeAt(0))],{type:matched.mimeType||mime}),size:raw.length,updatedAt:Date.now()};
          mediaMemory.set(stableKey,saved);await writeStore('media',saved);void trimPersistentCache();return saved;
        })().finally(()=>mediaLoading.delete(stableKey));mediaLoading.set(stableKey,pending);}
        try{record=await pending;}catch(error){return toast('Не удалось загрузить вложение: '+error.message,true);}
      }
      let url=await asUrl(record);if(!url)url=safeUrl(file.downloadUrl);
      if(!url)return toast('1С не передала содержимое или ссылку на файл',true);
      if(/^video\//.test(mime)){const v=document.createElement('video');v.controls=true;v.playsInline=true;v.preload='none';v.src=url;slot.replaceChildren(v);}
      else if(/^image\//.test(mime)){const img=document.createElement('img');img.src=url;img.alt=file.fileName;slot.replaceChildren(img);}
      else{const a=document.createElement('a');a.href=url;a.target='_blank';a.rel='noopener';a.download=file.fileName;a.click();}
    }
    function back(){if(!visible||!selected)return false;selectionEpoch++;selected='';paint();return true;}
    async function enter(preferred){visible=true;if(preferred&&permitted(preferred)&&source!==preferred){selectionEpoch++;source=preferred;selected='';}if(!permitted(source))source=allowed()[0]||'clients';paint();await loadList(source);if(selected&&current())await loadMessages(source,selected);}
    async function handle(action,button){
      if(action==='msg-new-chat'){if(!permitted('staff'))return;selectionEpoch++;source='staff';section='contacts';selected='';query='';contactsLoaded=false;paint();await loadContacts();return;}
      if(action==='msg-source'){const s=button.dataset.source;if(!permitted(s))return;selectionEpoch++;source=s;section='chats';selected='';query='';paint();if(!loaded[s])await loadList(s);}
      if(action==='msg-section'){section=button.dataset.section;paint();if(section==='contacts'&&source==='staff')await loadContacts();}
      if(action==='msg-open')await open(button.dataset.ref);
      if(action==='msg-back')back();
      if(action==='msg-refresh'){if(section==='contacts'&&source==='staff'){contactsLoaded=false;await loadContacts();}else await loadList();}
      if(action==='msg-refresh-messages')await loadMessages(source,selected,{refresh:true});
      if(action==='msg-send')await send();
      if(action==='msg-older'){const h=document.querySelector('.msg-history'),oldHeight=h?.scrollHeight||0;counts[selectedKey()]=(counts[selectedKey()]||50)+50;paint();const n=document.querySelector('.msg-history');if(n)n.scrollTop=n.scrollHeight-oldHeight;}
      if(action==='msg-media')await media(Number(button.dataset.mi),Number(button.dataset.fi));
      if(action==='msg-settings')options.settings();
      if(action==='msg-attach'){
        options.sheet('Вложения','Куда: '+current().title,`<div class="grid"><button data-action="msg-photo">Фото и видео</button><button data-action="msg-file">Документ</button></div>`);
      }
      if(action==='msg-poll') options.sheet('Опрос согласования','Ответ клиента будет сохранён в 1С',`<label for="msgPollQuestion">Вопрос</label><input id="msgPollQuestion" value="Согласовано ли выполнение работ?" maxlength="200"><p class="tiny">Варианты: «Согласовано» и «Не согласовано»</p><button class="primary" data-action="msg-poll-send">Отправить опрос</button>`);
      if(action==='msg-poll-send'){
        const question=String(document.getElementById('msgPollQuestion')?.value||'').trim();
        if(!question)return toast('Введите вопрос для опроса',true);
        const s=source,id=selected,k=key(s,id);sending[k]=true;paint();
        try{
          const result=await call('/clients/polls/send',{...params('clients',id),clientMessageId:root.crypto.randomUUID?root.crypto.randomUUID():String(Date.now()),kind:'poll',messageType:'poll',poll:{question,options:['Согласовано','Не согласовано']}},{silent:true});
          const data=result.data||result;if(data.message){cache[k]=mergeMessages(cache[k],[api.normalizeMessage(data.message,Date.now())]);void persistThread(k);}else await loadMessages(s,id,{refresh:true});
          options.closeSheet();toast('Опрос отправлен клиенту');
        }catch(e){errors[k]=e.message;toast(e.message,true);}finally{sending[k]=false;paint({bottom:true});}
      }
      if(action==='msg-poll-vote'){
        if(source!=='clients'||!selected)return;
        try{await call('/clients/polls/vote',{...params('clients',selected),messageRef:button.closest('.msg-bubble')?.dataset?.messageRef||'',option:button.dataset.value},{silent:true});await loadMessages('clients',selected,{refresh:true});toast('Ответ сохранён');}
        catch(e){toast(e.message,true);}
      }
      const target={type:'messenger',source,ref:selected};
      if(action==='msg-photo'||action==='msg-video'){
        if(options.media) options.media(target);
        else if(action==='msg-photo')photo({...target,kind:'photo'});
        else pickFile({...target,kind:'video'},'video/*');
      }
      if(action==='msg-file')pickFile({...target,kind:'file'},'*/*');
    }
    document.addEventListener('input',e=>{
      if(!visible)return;
      if(e.target.id==='msgDraft')drafts[selectedKey()]=e.target.value;
      if(e.target.id==='msgSearch'){query=e.target.value;const list=document.querySelector('.msg-thread-list');if(list)list.innerHTML=listHtml();}
    });
    document.addEventListener('keydown',e=>{
      if(!visible||!selected||e.target?.id!=='msgDraft'||e.key!=='Enter'||e.ctrlKey||e.altKey||e.metaKey||e.shiftKey||e.repeat||e.isComposing||e.keyCode===229)return;
      e.preventDefault();void send();
    });
    async function openThread(threadSource, ref){
      if(!permitted(threadSource) || !ref)return false;
      selectionEpoch++;visible=true;source=threadSource;section='chats';query='';
      await loadList(source);
      if(!records[source].some(item=>item.ref===ref))return false;
      await open(ref);return true;
    }
    function refreshInternalThreadFromPush(ref){
      const id=String(ref||'').trim();
      if(!id||!isVisibleThread('staff',id))return false;
      const k=key('staff',id);
      if(busy[k]){refreshPending[k]=true;return true;}
      void loadMessages('staff',id,{refresh:true});
      return true;
    }
    function refreshVisibleInternalThread(){return refreshInternalThreadFromPush(source==='staff'?selected:'');}
    return {enter,paint,back,handle,openThread,upload:(file,target)=>send(file,target.kind,target),
      refreshInternalThreadFromPush,refreshVisibleInternalThread,
      leave(){selectionEpoch++;visible=false;document.body.classList.remove('messenger-conversation');revokeMedia();},
      reset(){void clearPersistentCache();epoch++;selectionEpoch++;visible=false;document.body.classList.remove('messenger-conversation');revokeMedia();mediaMemory.clear();mediaLoading.clear();restored.clear();records={clients:[],staff:[]};contacts=[];contactsLoaded=false;loaded={};listBusy={};listError={};cache={};busy={};errors={};drafts={};sending={};counts={};attempts={};refreshPending={};selected='';query='';},
      async notify(event){if(event.type==='new_messages'){loaded.clients=false;loaded.staff=false;/* список обновится при открытии, чтобы не грузить чат на каждом пинге */}}
    };
  }
  root.ITUS_MESSENGER={create,safeUrl};
})(typeof window==='undefined'?globalThis:window);
