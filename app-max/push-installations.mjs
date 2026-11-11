import {mkdir,readFile,open,rename,rm,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
const digest=value=>createHash('sha256').update(value).digest('hex');
const failure=(message,status=409)=>Object.assign(Error(message),{status,code:'PUSH_INSTALLATION_CONFLICT'});

export class PushInstallations{
  constructor(directory){this.directory=directory;}
  async read(key){try{return JSON.parse(await readFile(join(this.directory,key+'.json'),'utf8'));}catch(error){if(error.code==='ENOENT')return null;throw error;}}
  async write(key,value){
    const file=join(this.directory,key+'.json'),temp=file+'.'+randomUUID()+'.tmp',handle=await open(temp,'wx',0o600);
    try{await handle.writeFile(JSON.stringify(value));await handle.sync();}finally{await handle.close();}
    await rename(temp,file);
    if(process.platform!=='win32'){const folder=await open(this.directory,'r');try{await folder.sync();}finally{await folder.close();}}
  }
  async locked(key,fn){
    await mkdir(this.directory,{recursive:true,mode:0o700});const lock=join(this.directory,key+'.lock');
    for(let n=0;;n++){
      try{await mkdir(lock);break;}catch(error){
        if(error.code!=='EEXIST')throw error;
        try{if(Date.now()-(await stat(lock)).mtimeMs>60000)await rm(lock,{recursive:true,force:true});}catch(error){if(error.code!=='ENOENT')throw error;}
        if(n>=100)throw failure('Push registration busy',503);
        await new Promise(resolve=>setTimeout(resolve,25));
      }
    }
    try{return await fn();}finally{await rm(lock,{recursive:true,force:true});}
  }
  key(platform,instance){if(!['android','web'].includes(platform)||!/^[-\w:]{8,160}$/.test(instance||''))throw failure('Invalid installation',400);return digest(platform+'|'+instance);}
  async begin(userId,environment,{platform,clientInstanceId,token,subscription}){
    const key=this.key(platform,clientInstanceId);
    return this.locked(key,async()=>{
      const record={userId,environment,activationId:randomUUID(),enabled:false};await this.write(key,record);
      const resource=platform==='android'?token:subscription?.endpoint;
      if(typeof resource==='string'&&resource&&resource.length<=4096)await this.write(digest('recipient|'+platform+'|'+resource),{installation:key,activationId:record.activationId});
      return record;
    });
  }
  async bind(userId,environment,input){
    const key=this.key(input.platform,input.clientInstanceId),resource=input.platform==='android'?input.token:input.subscription?.endpoint;
    if(typeof resource!=='string'||!resource||resource.length>4096)throw failure('Invalid Push recipient',400);
    return this.locked(key,async()=>{
      const current=await this.read(key);
      if(!current||current.userId!==userId||current.environment!==environment||current.activationId!==input.activationId)throw failure('Installation changed');
      const resourceKey=digest('recipient|'+input.platform+'|'+resource);
      await this.write(resourceKey,{installation:key,activationId:current.activationId});
      await this.write(key,{...current,enabled:true});return current;
    });
  }
  async pause(userId,environment,input){
    const key=this.key(input.platform,input.clientInstanceId);
    return this.locked(key,async()=>{
      const current=await this.read(key);
      if(current&&(current.userId!==userId||current.environment!==environment||current.activationId!==input.activationId))throw failure('Installation changed');
      if(current)await this.write(key,{...current,enabled:false,activationId:randomUUID()});
      return {enabled:false};
    });
  }
  async recipient(platform,resource,environment){
    const ref=await this.read(digest('recipient|'+platform+'|'+resource));
    if(!ref)return environment==='test'?{legacy:true}:null;
    const record=await this.read(ref.installation);
    return record?.enabled&&record.environment===environment&&record.activationId===ref.activationId?{environment,activationId:record.activationId}:null;
  }
}
