import {join} from 'node:path';

// Only server configuration can select an upstream. Browser input is a fixed key.
export function oneCEnvironments(env=process.env){
  const test={id:'test',target:String(env.ONE_C_TARGET||'https://1c.eazia.ru/aa6_ea_test9/ru/hs/max-service').replace(/\/+$/,''),token:env.ONE_C_TOKEN||'',basicUser:env.ONE_C_BASIC_USER||'',basicPassword:env.ONE_C_BASIC_PASSWORD||''};
  const production=env.ONE_C_PRODUCTION_TARGET?{id:'production',target:String(env.ONE_C_PRODUCTION_TARGET).replace(/\/+$/,''),token:env.ONE_C_PRODUCTION_TOKEN||'',basicUser:env.ONE_C_PRODUCTION_BASIC_USER||'',basicPassword:env.ONE_C_PRODUCTION_BASIC_PASSWORD||''}:null;
  for(const connection of [test,production].filter(Boolean)){
    const url=new URL(connection.target);
    if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw Error('Invalid 1C server target');
  }
  if(production&&production.target===test.target)throw Error('1C environments must have distinct targets');
  return {test,production};
}

export function environmentRoute(pathname,connections){
  const match=pathname.match(/^\/contours\/([^/]+)(\/.*)?$/);
  if(!match)return {connection:connections.test,pathname};
  const connection=connections[match[1]];
  if(!connection||!['test','production'].includes(match[1]))return null;
  return {connection,pathname:match[2]||'/'};
}

export function mediaEnvironment(env,connection){
  return {...env,ONE_C_TARGET:connection.target,MEDIA_STATE_DIR:connection.id==='test'?env.MEDIA_STATE_DIR:env.MEDIA_STATE_DIR&&join(env.MEDIA_STATE_DIR,'production'),MEDIA_CONTEXT:env.MEDIA_CONTEXT||'test'};
}

export function upstreamHeaders(connection){
  return {'Content-Type':'application/json; charset=utf-8',Accept:'application/json',...(connection.token?{'X-ITUS-Token':connection.token}:{}),...(connection.basicUser?{Authorization:'Basic '+Buffer.from(connection.basicUser+':'+connection.basicPassword).toString('base64')}:{})};
}
