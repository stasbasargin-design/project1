(function(root){
  'use strict';
  const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function create({id='messageActionsDialog',valid=()=>true,toast=()=>{}}={}){
    let dialog=null,job=null;
    function close(){const open=Boolean(dialog?.open);dialog?.close();job=null;return open;}
    function ensure(){
      if(dialog)return;dialog=root.document.createElement('dialog');dialog.id=id;dialog.className='message-actions-dialog';
      dialog.setAttribute('aria-label','Действия с сообщением');
      dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
      dialog.addEventListener('click',event=>{
        if(event.target===dialog){close();return;}
        const button=event.target.closest('[data-message-choice]');if(!button||button.disabled||!job)return;
        const active=job,action=active.actions.find(x=>x.id===button.dataset.messageChoice);
        if(!action||!valid(active.context)){close();return;}
        close();Promise.resolve().then(()=>{if(valid(active.context))return action.run(active.context);}).catch(error=>toast(error.message,true));
      });root.document.body.append(dialog);
    }
    function open(context,actions,{title='Действия с сообщением',emojiGrid=false}={}){
      if(!valid(context))return;ensure();job={context,actions};
      dialog.innerHTML=`<header><strong>${escape(title)}</strong><button type="button" data-message-choice="close" aria-label="Закрыть меню">×</button></header>${context.preview?`<p class="message-actions-preview">${escape(context.preview)}</p>`:''}<div class="message-actions-options${emojiGrid?' message-actions-emojis':''}">${actions.map(action=>`<button type="button" data-message-choice="${escape(action.id)}" ${action.disabled?'disabled':''}><span>${escape(action.label)}</span>${action.hint?`<small>${escape(action.hint)}</small>`:''}</button>`).join('')}</div><button type="button" class="message-actions-cancel" data-message-choice="cancel">Отмена</button>`;
      job.actions=[...actions,{id:'close',run(){}},{id:'cancel',run(){}}];if(!dialog.open)dialog.showModal();
    }
    return {open,close,back:()=>dialog?.open?close():false,isOpen:()=>Boolean(dialog?.open)};
  }
  root.ITUS_MESSAGE_ACTIONS={create};
})(typeof window==='undefined'?globalThis:window);
