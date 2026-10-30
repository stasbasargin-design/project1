import {mkdir,open,readFile,rename,readdir,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash,randomBytes} from 'node:crypto';

export const digest=value=>createHash('sha256').update(value).digest('hex');
export const mediaError=(message,status=400,code='MEDIA_INVALID')=>Object.assign(new Error(message),{status,code});
export function assertMediaIdentity(userId,envelope){
  if(String(envelope?.userId)!==userId)throw mediaError('Пользователь не совпадает с подключённым устройством',403,'MEDIA_OWNER_MISMATCH');
  for(const field of ['maxUserId','authId'])if(envelope[field]&&String(envelope[field])!==userId)throw mediaError('Пользователь не совпадает',403,'MEDIA_OWNER_MISMATCH');
  for(const field of ['userId','maxUserId'])if(envelope.max?.[field]&&String(envelope.max[field])!==userId)throw mediaError('Пользователь не совпадает',403,'MEDIA_OWNER_MISMATCH');
}
const keyPattern=/^[a-f0-9]{64}$/;

// State is outside the application directory. Atomic rename + fsync prevents a
// restart/deployment from turning an accepted job into a partial JSON document.
export class MediaStore {
  constructor(directory){this.directory=directory;this.locks=new Map();}
  async init(){for(const kind of ['jobs','receipts','codes','devices','writes'])await mkdir(join(this.directory,kind),{recursive:true,mode:0o700});}
  path(kind,key){if(!['jobs','receipts','codes','devices','writes'].includes(kind)||!keyPattern.test(key))throw mediaError('Неверный идентификатор');return join(this.directory,kind,key+'.json');}
  async get(kind,key){try{return JSON.parse(await readFile(this.path(kind,key),'utf8'));}catch(error){if(error.code==='ENOENT')return null;throw error;}}
  async put(kind,key,value){
    const target=this.path(kind,key),temp=target+'.'+randomBytes(8).toString('hex')+'.tmp';
    const file=await open(temp,'wx',0o600);
    try{await file.writeFile(JSON.stringify(value));await file.sync();}finally{await file.close();}
    await rename(temp,target);
    if(process.platform!=='win32'){const folder=await open(join(this.directory,kind),'r');try{await folder.sync();}finally{await folder.close();}}
    return value;
  }
  async remove(kind,key){try{await unlink(this.path(kind,key));}catch(error){if(error.code!=='ENOENT')throw error;}}
  async list(kind){const names=await readdir(join(this.directory,kind));const values=[];for(const name of names){if(!/^[a-f0-9]{64}\.json$/.test(name))continue;const value=await this.get(kind,name.slice(0,-5));if(value)values.push(value);}return values;}
  async locked(key,fn){const previous=this.locks.get(key)||Promise.resolve();const task=previous.catch(()=>{}).then(fn);this.locks.set(key,task);try{return await task;}finally{if(this.locks.get(key)===task)this.locks.delete(key);}}
  async issueCode(userId){
    if(!/^\d{1,30}$/.test(userId))throw mediaError('Нужен числовой MAX ID');
    const code=randomBytes(12).toString('hex').toUpperCase();
    await this.put('codes',digest(code),{userId,expires:Date.now()+15*60*1000,used:false});
    return code;
  }
  async redeem(userId,code){
    const key=digest(String(code||'').replace(/[\s-]/g,'').toUpperCase());
    return this.locked('code:'+key,async()=>{
      const record=await this.get('codes',key);
      if(!record||record.used||record.expires<Date.now()||record.userId!==userId)throw mediaError('Код недействителен или уже использован',401,'DEVICE_CODE_INVALID');
      await this.put('codes',key,{...record,used:true});
      return this.issueDevice(userId);
    });
  }
  async issueDevice(userId){
    if(!/^\d{1,30}$/.test(userId))throw mediaError('Нужен числовой MAX ID');
    const token=randomBytes(32).toString('hex'),expires=Date.now()+30*24*60*60*1000;
    await this.put('devices',digest(token),{userId,expires,createdAt:new Date().toISOString()});
    return {token,expires};
  }
  async authenticate(token){
    if(!/^[a-f0-9]{64}$/.test(token||''))throw mediaError('Требуется обновить подключение файлов',401,'DEVICE_REQUIRED');
    const record=await this.get('devices',digest(token));
    if(!record||record.expires<Date.now())throw mediaError('Требуется обновить подключение файлов',401,'DEVICE_REQUIRED');
    return {...record,device:digest(token)};
  }
}
