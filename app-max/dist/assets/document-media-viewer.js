(function(root){
  'use strict';
  function create(){
    let dialog=null,media=null,owned='',focus=null,positions=[],revision=0;
    function close({restorePosition=true}={}){
      if(!dialog?.open&&!media)return false;
      const expected=++revision,savedFocus=focus,savedPositions=positions;
      const restore=()=>{if(revision!==expected)return;try{if(savedFocus?.isConnected)savedFocus.focus({preventScroll:true});}catch{}for(const item of savedPositions)if(item.element.isConnected){item.element.scrollTop=item.top;item.element.scrollLeft=item.left;}};
      try{media?.pause?.();media?.removeAttribute('src');media?.load?.();}catch{}
      media?.remove();media=null;
      if(owned)root.URL.revokeObjectURL(owned);owned='';
      dialog?.close();
      if(restorePosition){restore();root.requestAnimationFrame?.(restore);}
      return true;
    }
    function ensure(){
      if(dialog)return;
      dialog=root.document.createElement('dialog');dialog.id='documentMediaViewer';dialog.className='document-media-viewer';
      dialog.setAttribute('aria-labelledby','documentMediaTitle');
      dialog.innerHTML='<header><h2 id="documentMediaTitle"></h2><button type="button" aria-label="Закрыть просмотр файла">×</button></header><div data-document-media></div><p data-document-media-error role="status" hidden></p>';
      dialog.querySelector('button').addEventListener('click',()=>close());
      dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
      dialog.addEventListener('click',event=>{if(event.target===dialog)close();});
      root.document.body.append(dialog);
    }
    function open({url,mimeType,fileName,ownedUrl=false,returnFocus=null}={}){
      const parsed=new URL(url,root.document.baseURI);
      if(!['https:','http:','blob:'].includes(parsed.protocol)||!/^image\/|^video\//.test(mimeType||''))throw Error('Неподдерживаемый файл для просмотра');
      close({restorePosition:false});ensure();focus=returnFocus||root.document.activeElement;
      revision++;
      positions=[root.document.getElementById('sheetBody'),root.document.querySelector('.defect-history'),root.document.querySelector('#overlay .sheet')].filter(Boolean).map(element=>({element,top:element.scrollTop,left:element.scrollLeft}));
      owned=ownedUrl?url:'';
      dialog.querySelector('h2').textContent=fileName||(/^video\//.test(mimeType)?'Видео дефекта':'Фото дефекта');
      const error=dialog.querySelector('[data-document-media-error]');error.hidden=true;error.textContent='';
      media=root.document.createElement(/^video\//.test(mimeType)?'video':'img');
      if(media.tagName==='VIDEO'){media.controls=true;media.playsInline=true;media.preload='metadata';}
      else media.alt=fileName||'Фото дефекта';
      media.addEventListener('error',()=>{error.textContent='Не удалось загрузить файл. Закройте просмотр и попробуйте ещё раз.';error.hidden=false;});
      media.src=url;dialog.querySelector('[data-document-media]').replaceChildren(media);dialog.showModal();
    }
    return {open,close,back:()=>close(),isOpen:()=>Boolean(dialog?.open)};
  }
  root.ITUS_DOCUMENT_MEDIA_VIEWER={create};
})(window);
