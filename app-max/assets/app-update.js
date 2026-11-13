(function(root){
  'use strict';
  const messages={
    UPDATE_NETWORK_ERROR:'Не удалось проверить или скачать обновление. Проверьте интернет и попробуйте позже.',
    UPDATE_DOWNLOAD_FAILED:'Сервер обновлений временно недоступен. Попробуйте позже.',
    UPDATE_STORAGE_FULL:'Для обновления недостаточно свободного места на телефоне.',
    UPDATE_INCOMPATIBLE_SIGNATURE:'Эта сборка несовместима с подписью установленного I-MAX. Обратитесь в поддержку; удалять приложение не нужно.',
    UPDATE_CANCELLED:'Скачивание отменено.',
    UPDATE_BUSY:'Проверка или скачивание уже выполняется.',
    UPDATE_NOT_READY:'Сначала скачайте обновление.',
    UPDATE_INVALID_APK:'Скачанный APK не прошёл проверку. Установка остановлена.',
    UPDATE_HASH_MISMATCH:'Файл обновления повреждён. Скачайте его повторно.',
    UPDATE_SIZE_MISMATCH:'Файл скачан не полностью. Скачайте его повторно.'
  };
  function create({shouldCheck=()=>true,canPrompt=()=>true,canInstall=async()=>true,now=Date.now}={}){
    if(root.ITUS_REVIEW_MODE||root.ITUS_VITE_DEV)return null;
    const cap=root.Capacitor;
    if(!(cap?.isNativePlatform?.()||cap?.getPlatform?.()==='android'))return null;
    const plugin=cap?.Plugins?.AppUpdate||(cap?.isPluginAvailable?.('AppUpdate')?cap.registerPlugin?.('AppUpdate'):null);
    if(!plugin?.check||!plugin?.download||!plugin?.install)return null;
    let job=null,info=null,stage='idle',error='',received=0,dialog=null,lastCheck=0,checking=false,installing=false,timer=null,closed=false;
    const saved=()=>{try{return JSON.parse(root.localStorage.getItem('itus.android-update.remind')||'null');}catch{return null;}};
    const remind=()=>{if(info?.available){try{root.localStorage.setItem('itus.android-update.remind',JSON.stringify({code:info.versionCode,until:now()+24*60*60*1000}));}catch{}}};
    function ensureDialog(){
      if(dialog)return dialog;
      dialog=root.document.createElement('dialog');dialog.id='appUpdateDialog';dialog.className='app-update-dialog';dialog.setAttribute('aria-labelledby','appUpdateTitle');
      dialog.innerHTML='<div class="app-update-content"><h2 id="appUpdateTitle"></h2><p data-update-description></p><ul data-update-notes></ul><progress data-update-progress max="100" value="0" hidden></progress><p data-update-status role="status" aria-live="polite"></p><div class="app-update-actions"><button type="button" data-update-primary class="primary"></button><button type="button" data-update-close>Позже</button></div></div>';
      dialog.querySelector('[data-update-primary]').addEventListener('click',()=>void primary());
      dialog.querySelector('[data-update-close]').addEventListener('click',hide);
      dialog.addEventListener('cancel',event=>{event.preventDefault();hide();});
      root.document.body.append(dialog);return dialog;
    }
    function paint(){
      if(!dialog)return;
      dialog.querySelector('h2').textContent=info?.available?'Обновление I-MAX '+info.version:'Обновление I-MAX';
      dialog.querySelector('[data-update-description]').textContent=info?.available?'Новая версия устанавливается поверх текущей. Удалять приложение не нужно.':'Проверка новой версии выполняется отдельно от 1С.';
      const notes=dialog.querySelector('[data-update-notes]');notes.replaceChildren();
      for(const note of (Array.isArray(info?.notes)?info.notes:[]).slice(0,8)){const li=root.document.createElement('li');li.textContent=String(note).slice(0,400);notes.append(li);}
      const progress=dialog.querySelector('progress');progress.hidden=stage!=='downloading';progress.value=info?.bytes?Math.min(100,100*received/info.bytes):0;
      const status=error||(stage==='checking'?'Проверяем новую версию…':stage==='downloading'?`Скачивание: ${Math.floor(progress.value)}%`:stage==='ready'?'APK проверен. Можно установить обновление.':stage==='permission'?'Разрешите установку обновлений из I-MAX, вернитесь сюда и нажмите «Установить».':stage==='installer'?'Продолжите установку в системном окне Android. Если отменили — нажмите «Установить» повторно.':info?.available?`Размер: ${(info.bytes/1024/1024).toFixed(1)} МиБ`:'У вас установлена актуальная версия.');
      dialog.querySelector('[data-update-status]').textContent=status;
      const primary=dialog.querySelector('[data-update-primary]');
      primary.disabled=checking||stage==='downloading'||installing;
      primary.setAttribute('aria-busy',String(primary.disabled));primary.classList.toggle('is-pending',primary.disabled);
      primary.textContent=checking?'Проверяем…':stage==='downloading'?'Скачивание…':['ready','permission','installer'].includes(stage)?'Установить':info?.available?'Скачать обновление':'Проверить ещё раз';
      dialog.querySelector('[data-update-close]').textContent=stage==='downloading'?'Свернуть':stage==='ready'?'Позже':'Закрыть';
    }
    function show(){if(closed)return;ensureDialog();paint();if(!dialog.open)dialog.showModal();}
    function hide(){remind();dialog?.close();}
    function prompt(){
      if(closed||!shouldCheck()||!info?.available||root.document.hidden)return;
      const reminder=saved();if(reminder?.code===info.versionCode&&reminder.until>now())return;
      if(!canPrompt()){if(!timer)timer=root.setTimeout(()=>{timer=null;prompt();},5000);return;}
      show();
    }
    async function check({manual=false}={}){
      if(closed||(!manual&&!shouldCheck()))return;
      if(job){if(manual)show();return job;}
      if(['downloading','ready','permission','installer'].includes(stage)){if(manual)show();return info;}
      if(!manual&&lastCheck&&now()-lastCheck<6*60*60*1000)return info;
      lastCheck=now();checking=true;stage='checking';error='';if(manual)show();
      const task=(async()=>{
        try{info=await plugin.check();stage=info?.available?'available':'current';if(manual)show();else prompt();return info;}
        catch(e){lastCheck=0;stage='error';error=messages[e.code]||'Обновление пока недоступно. Работа с 1С продолжается.';if(manual)show();}
        finally{checking=false;paint();}
      })();job=task;try{return await task;}finally{if(job===task)job=null;}
    }
    async function primary(){
      if(checking||stage==='downloading'||installing)return;
      error='';
      if(['ready','permission','installer'].includes(stage)){
        installing=true;paint();
        try{
          if(!await canInstall()){error='Сначала завершите активную отправку и закройте редактор. Сохранённые очереди останутся на устройстве.';return;}
          const result=await plugin.install();stage=result.status==='permission_required'?'permission':'installer';
        }catch(e){error=messages[e.code]||'Не удалось открыть установку. Попробуйте ещё раз.';}
        finally{installing=false;paint();}return;
      }
      if(!info?.available)return check({manual:true});
      stage='downloading';received=0;paint();
      try{await plugin.download();stage='ready';}
      catch(e){stage='available';error=messages[e.code]||'Не удалось скачать обновление. Повторите позже.';}
      paint();
    }
    const listener=plugin.addListener?.('progress',progress=>{if(stage==='downloading'){received=Number(progress.received)||0;paint();}});
    const resume=()=>{if(!root.document.hidden)void check();};root.document.addEventListener('visibilitychange',resume);
    return {check,show:()=>void check({manual:true}),hide,back:()=>{if(!dialog?.open)return false;hide();return true;},snapshot:()=>({stage,available:Boolean(info?.available),checking,installing}),
      destroy(){closed=true;if(timer)root.clearTimeout(timer);root.document.removeEventListener('visibilitychange',resume);dialog?.remove();void Promise.resolve(listener).then(x=>x?.remove());}};
  }
  root.ITUS_APP_UPDATE={create};
})(window);
