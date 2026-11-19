(function(root){
  'use strict';
  function create({load,current,allowed,paint,onError=()=>{},now=()=>Date.now(),minInterval=10000}){
    const jobs=new Map(),loaded=new Map();
    async function refresh(){
      if(!allowed())return false;
      const context=current();if(!context?.ref||!context.scope)return false;
      const key=context.scope+'|'+context.ref;
      if(jobs.has(key))return jobs.get(key);
      if(loaded.has(key)&&now()-loaded.get(key)<minInterval)return false;
      const job=(async()=>{try{
        await load(context.ref);const after=current();
        if(after?.scope!==context.scope)return false;
        loaded.set(key,now());if(after.ref===context.ref&&allowed())paint();return true;
      }catch(error){onError(error);return false;}})();
      jobs.set(key,job);try{return await job;}finally{if(jobs.get(key)===job)jobs.delete(key);}
    }
    return {refresh};
  }
  root.ITUS_ORDER_READ_REFRESH={create};
})(typeof window==='object'?window:globalThis);
