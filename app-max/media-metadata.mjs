import streamJson from 'stream-json';
import {Readable} from 'node:stream';
import {mediaError} from './media-store.mjs';

export function detectedMime(file,prefix=''){
  const declared=String(file.mimeType||file.contentType||'');if(declared&&declared!=='application/octet-stream')return declared;
  const bytes=Buffer.from(prefix.replace(/^data:[^,]*,/,''),'base64');
  if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'image/png';
  if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return 'image/jpeg';
  if(bytes.subarray(0,4).toString()==='GIF8')return 'image/gif';
  if(bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP')return 'image/webp';
  if(bytes.subarray(4,8).toString()==='ftyp')return 'video/mp4';
  return declared||'application/octet-stream';
}

// 1C currently ignores includeAttachmentContent:false on defects/start. Build
// bounded metadata while discarding streamed Base64; never pack that string.
export async function scanMediaJson(stream,{binaryStart,binaryChunk,binaryEnd,containerEnd,signal,maxMetadataBytes=4*1024*1024}={}){
  const parser=streamJson.parser({packKeys:true,packStrings:false,packNumbers:true,streamKeys:false,streamNumbers:false,streamStrings:true});
  const source=stream?.getReader?Readable.fromWeb(stream):stream;
  let upstreamBytes=0;
  const counted=Readable.from((async function*(){for await(const chunk of source){upstreamBytes+=Buffer.byteLength(chunk);yield chunk;}})());
  const failed=error=>parser.destroy(error);counted.on('error',failed);counted.pipe(parser);
  let metadata,nodes=0,chars=0,text='',binary=false,binaryContext,prefix='',started=false,tokens=0;
  const stack=[];
  function attach(value){if(++nodes>50000)throw mediaError('Слишком много метаданных',502,'MEDIA_METADATA_LIMIT');const parent=stack.at(-1);if(!parent){metadata=value;return;}if(Array.isArray(parent.value))parent.value.push(value);else parent.value[parent.key]=value;}
  try{
    for await(const token of parser){
      signal?.throwIfAborted();if(++tokens%1024===0)await new Promise(resolve=>setImmediate(resolve));
      if(token.name==='startObject'||token.name==='startArray'){if(stack.length>100)throw mediaError('Слишком глубокий JSON',502);const value=token.name==='startArray'?[]:Object.create(null);attach(value);stack.push({value,key:''});}
      else if(token.name==='endObject'||token.name==='endArray'){const item=stack.pop();await containerEnd?.(item.value);}
      else if(token.name==='keyValue'){chars+=Buffer.byteLength(token.value);stack.at(-1).key=token.value;}
      else if(token.name==='startString'){text='';prefix='';started=false;binary=['contentBase64','base64','previewBase64','thumbnailBase64'].includes(stack.at(-1)?.key);binaryContext=binary?{node:stack.at(-1).value,ancestors:stack.map(x=>x.value),primary:['contentBase64','base64'].includes(stack.at(-1)?.key)}:null;}
      else if(token.name==='stringChunk'){
        if(binary){if(!started&&token.value.length){started=true;if(binaryContext.primary)await binaryStart?.(binaryContext);}if(prefix.length<128)prefix+=(token.value.slice(0,128-prefix.length));if(started&&binaryContext.primary)await binaryChunk?.(binaryContext,token.value);}
        else{chars+=Buffer.byteLength(token.value);text+=token.value;}
      }else if(token.name==='endString'){
        if(binary){if(started&&binaryContext.primary){binaryContext.node.mimeType=detectedMime(binaryContext.node,prefix);await binaryEnd?.(binaryContext);}attach('');}else attach(text);
      }else if(['numberValue','trueValue','falseValue','nullValue'].includes(token.name))attach(token.name==='numberValue'?Number(token.value):token.value);
      if(chars>maxMetadataBytes)throw mediaError('Метаданные превышают допустимый объём',502,'MEDIA_METADATA_LIMIT');
    }
    return {metadata,upstreamBytes};
  }finally{counted.off('error',failed);counted.destroy();source.destroy?.();parser.destroy();}
}
