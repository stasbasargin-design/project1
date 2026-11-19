import {createHash} from 'node:crypto';
const hash=value=>createHash('sha256').update(value).digest('hex');
const version=value=>/^\d+\.\d+\.\d+$/.test(value||'')?value.split('.').map(Number):null;
export function olderAndroidVersion(installed,released){
  const a=version(installed),b=version(released);if(!a||!b||[...a,...b].some(x=>!Number.isSafeInteger(x)))return false;
  for(let n=0;n<3;n++){if(a[n]!==b[n])return a[n]<b[n];}return false;
}
const identity=release=>`${release.versionCode}|${release.commit}|${release.sha256}`;
function permitted(release){return release?.enabled===true&&release.notify===true&&release.packageName==='ru.eazia.imax'
  &&version(release.version)&&Number.isSafeInteger(release.versionCode)&&release.versionCode>0&&release.versionCode<=2100000000
  &&/^[a-f0-9]{64}$/.test(release.sha256||'')&&/^[a-f0-9]{40}$/.test(release.commit||'');}

// At-most-once attempts are persisted before contacting FCM. A lost FCM reply
// stays uncertain, never silently replays. In-app version checks remain the fallback.
export class AndroidUpdateNotices{
  constructor({registry,environment,release,verify,send}){Object.assign(this,{registry,environment,release,verify,send});this.active=null;}
  run(){if(this.active)return this.active;this.active=this.execute().finally(()=>{this.active=null;});return this.active;}
  async execute(){
    const summary={attempted:0,sent:0,failed:0,skipped:0};
    if(!this.registry||!['test','production'].includes(this.environment))return summary;
    const release=await this.release();if(!permitted(release))return summary;
    let verified=false;
    for(const {key} of await this.registry.androidInstallations()){
      const receipt=hash('apk-update|'+this.environment+'|'+key+'|'+release.versionCode);
      if(await this.registry.read(receipt)){summary.skipped++;continue;}
      const initial=await this.registry.read(key);
      if(!initial?.enabled||initial.environment!==this.environment||!olderAndroidVersion(initial.androidUpdate?.version,release.version)){summary.skipped++;continue;}
      if(!verified){await this.verify(release);verified=true;}
      const claimed=await this.registry.locked(receipt,async()=>{
        if(await this.registry.read(receipt))return null;
        const latest=await this.release(),record=await this.registry.read(key);
        if(!permitted(latest)||identity(latest)!==identity(release)||!record?.enabled||record.environment!==this.environment
          ||!olderAndroidVersion(record.androidUpdate?.version,release.version))return null;
        const routing=await this.registry.recipient('android',record.androidUpdate.token,this.environment,{type:'app_update_available'});
        if(!routing||routing.legacy||routing.activationId!==record.activationId)return null;
        const eventId='apk-update-'+receipt;
        await this.registry.write(receipt,{state:'attempted',versionCode:release.versionCode,environment:this.environment,at:new Date().toISOString()});
        return {token:record.androidUpdate.token,data:{type:'app_update_available',eventId,version:release.version,versionCode:String(release.versionCode),...routing,
          itusTitle:'Обновление I-MAX '+release.version,itusBody:'Доступна новая версия. Откройте I-MAX → Настройки → Проверить обновление. Удалять приложение не нужно.'}};
      });
      if(!claimed){summary.skipped++;continue;}
      summary.attempted++;
      try{
        // Recheck immediately before sending. In-flight messages are also
        // filtered by the Android activation/environment guard after a switch.
        const current=await this.registry.recipient('android',claimed.token,this.environment,claimed.data);
        if(current?.activationId!==claimed.data.activationId){summary.skipped++;continue;}
        await this.send(claimed);summary.sent++;
        await this.registry.write(receipt,{state:'sent',versionCode:release.versionCode,environment:this.environment,at:new Date().toISOString()});
      }catch(error){summary.failed++;await this.registry.write(receipt,{state:'uncertain',versionCode:release.versionCode,environment:this.environment,at:new Date().toISOString(),code:/^[a-zA-Z0-9_/-]{1,80}$/.test(error?.code||'')?error.code:'FCM_RESULT_UNKNOWN'});}
    }
    return summary;
  }
}

// Observe a clone only. The original 1C subscription response remains untouched.
export async function androidSubscriptionActivation(registry,body,environment){
  if(!registry)return null;
  let input;try{input=JSON.parse(Buffer.from(body).toString('utf8'));}catch{return null;}
  if(input.platform!=='android')return null;
  const record=await registry.read(registry.key('android',input.clientInstanceId));
  return record?.environment===environment&&record.userId===String(input.userId)?record.activationId:null;
}
export async function captureAndroidSubscription(registry,response,body,environment,activation){
  if(!registry||!activation||response.status!==200)return false;
  let input;try{input=JSON.parse(Buffer.from(body).toString('utf8'));}catch{return false;}
  if(input.platform!=='android')return false;
  const clone=response.clone(),reader=clone.body.getReader();let length=0;const chunks=[];
  try{
    while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>65536)throw Error('Registration response too large');chunks.push(value);}
    const result=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if(result.success===false||result.data?.registered!==true)return false;
    return await registry.confirmedAndroidSubscription(environment,input,activation);
  }finally{void reader.cancel().catch(()=>{});reader.releaseLock();}
}
