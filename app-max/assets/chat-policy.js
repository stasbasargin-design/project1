(function(root){
  'use strict';
  const emojis=Object.freeze(['👍','❤️','😂','😮','😢','🙏','✅','👎']);
  function thread(source,ref){
    if(!['clients','staff'].includes(source)||typeof ref!=='string'||!ref.trim()||ref.trim().length>160||/[\u0000-\u001f\u007f]/.test(ref))return null;
    return {source,ref:ref.trim()};
  }
  function pushThread(data){
    const type=String(data?.type||data?.eventType||'').trim().toLowerCase().replace(/[\s-]+/g,'_');
    const source=['internal_chat_message','internal_message','staff_message'].includes(type)?'staff':['new_messages','new_message','client_message','client_chat_message'].includes(type)?'clients':null;
    return source?thread(source,data.topicRef||data.topicId||data.groupRef||data.groupId||''):null;
  }
  const stamp=value=>{const result=Date.parse(value);return Number.isFinite(result)?result:0;};
  const activity=item=>Math.max(stamp(item.lastMessageAt),stamp(item.createdAt))||stamp(item.updatedAt);
  function sortTopics(items,source){return items.map((value,index)=>({value,index})).sort((a,b)=>
    (source==='staff'?(Number(Boolean(b.value.common))-Number(Boolean(a.value.common))||Number(Boolean(b.value.shiftGroup))-Number(Boolean(a.value.shiftGroup))):0)
    ||activity(b.value)-activity(a.value)||a.index-b.index).map(x=>x.value);}
  root.ITUS_CHAT_POLICY=Object.freeze({emojis,thread,pushThread,sortTopics,activity});
})(typeof window==='undefined'?globalThis:window);
