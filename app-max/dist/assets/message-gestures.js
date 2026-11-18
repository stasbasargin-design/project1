(function(root){
  'use strict';
  function create({selector,resolve,hold,reply,holdMs=500,swipePx=60}={}){
    const doc=root.document;if(!doc?.addEventListener)return {cancel(){},destroy(){}};
    let active=null,suppress=null;
    const listeners=[];
    function on(target,name,fn,options){target?.addEventListener?.(name,fn,options);listeners.push(()=>target?.removeEventListener?.(name,fn,options));}
    function clearVisual(item){if(item?.node?.style){item.node.style.removeProperty('--message-swipe-x');item.node.classList.remove('message-swiping');}}
    function cancel(){if(active){root.clearTimeout(active.timer);clearVisual(active);}active=null;}
    function choose(event){
      const target=event.target?.closest?.(selector);if(!target)return null;
      if(event.target.closest?.('input,textarea,select,[contenteditable="true"],video,audio'))return null;
      const context=resolve(target);return context?{node:target,context}:null;
    }
    function trigger(item,kind){
      root.clearTimeout(item.timer);clearVisual(item);item.used=true;
      suppress={node:item.node,until:Date.now()+900,untilNextDown:true};
      if(kind==='hold')hold(item.context);else reply?.(item.context);
    }
    on(doc,'pointerdown',event=>{
      if(suppress?.untilNextDown)suppress=null;
      if(active){cancel();return;}
      if(event.isPrimary===false||event.button&&event.button!==0)return;
      const chosen=choose(event);if(!chosen)return;
      const item=active={...chosen,pointerId:event.pointerId,x:event.clientX,y:event.clientY,dx:0,dy:0,used:false,horizontal:false};
      item.timer=root.setTimeout(()=>{if(active===item&&!item.horizontal)trigger(item,'hold');},holdMs);
    },{passive:true});
    on(doc,'pointermove',event=>{
      const item=active;if(!item||event.pointerId!==item.pointerId||item.used)return;
      item.dx=event.clientX-item.x;item.dy=event.clientY-item.y;
      if(Math.abs(item.dx)>8||Math.abs(item.dy)>8)root.clearTimeout(item.timer);
      if(!item.horizontal){
        if(Math.abs(item.dy)>12&&Math.abs(item.dy)>=Math.abs(item.dx)*.7){cancel();return;}
        if(!reply||item.dx>=-12||Math.abs(item.dx)<Math.abs(item.dy)*1.5)return;
        item.horizontal=true;
      }
      if(event.cancelable)event.preventDefault();
      const distance=Math.max(-84,Math.min(0,item.dx));
      item.node.style?.setProperty('--message-swipe-x',distance+'px');item.node.classList.add('message-swiping');
    },{passive:false});
    on(doc,'pointerup',event=>{
      const item=active;if(!item||event.pointerId!==item.pointerId)return;
      root.clearTimeout(item.timer);
      if(!item.used&&item.horizontal&&item.dx<=-swipePx&&Math.abs(item.dx)>Math.abs(item.dy)*1.5)trigger(item,'reply');
      else if(item.horizontal)suppress={node:item.node,until:Date.now()+500};
      clearVisual(item);active=null;
    },{passive:true});
    for(const name of ['pointercancel','lostpointercapture'])on(doc,name,cancel,{passive:true});
    on(doc,'scroll',()=>{if(active&&!active.used)cancel();},{capture:true,passive:true});
    on(doc,'click',event=>{
      if(suppress&&suppress.until>Date.now()&&(suppress.node.contains(event.target)||(suppress.untilNextDown&&event.detail!==0))){
        event.preventDefault();event.stopImmediatePropagation();suppress=null;
      }
    },true);
    on(doc,'contextmenu',event=>{
      const chosen=choose(event);if(!chosen)return;
      event.preventDefault();
      if(active?.used){cancel();return;}
      cancel();suppress={node:chosen.node,until:Date.now()+500};hold(chosen.context);
    });
    on(doc,'keydown',event=>{
      if(event.key!=='ContextMenu'&&!(event.key==='F10'&&event.shiftKey))return;
      const chosen=choose(event);if(!chosen)return;event.preventDefault();cancel();hold(chosen.context);
    });
    on(doc,'visibilitychange',()=>{if(doc.hidden)cancel();});on(root,'blur',cancel);
    return {cancel,destroy(){cancel();for(const off of listeners)off();suppress=null;}};
  }
  root.ITUS_MESSAGE_GESTURES={create};
})(typeof window==='undefined'?globalThis:window);
