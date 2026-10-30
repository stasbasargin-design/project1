(function(root){
  'use strict';
  const contentType='application/vnd.itus.video';
  const paths={
    '/defects/entries/add':['entry','file'],
    '/clients/files/send':['file'],
    '/internal-chat/files/send':['file']
  };
  const isBlob=value=>typeof root.Blob==='function' && value instanceof root.Blob;
  const isVideo=file=>/^video\//i.test(file?.type || '') || /\.(mp4|mov|m4v|webm|3gp|mkv|avi)$/i.test(file?.name || '');
  const mime=file=>/^video\//i.test(file?.type || '')?file.type:({mov:'video/quicktime',webm:'video/webm',mkv:'video/x-matroska',avi:'video/x-msvideo','3gp':'video/3gpp',m4v:'video/mp4',mp4:'video/mp4'}[String(file?.name || '').split('.').pop().toLowerCase()] || 'video/mp4');
  function encode(method,envelope){
    const path=paths[method];
    if(!path)return null;
    const file=path.reduce((value,key)=>value?.[key],envelope);
    if(!isBlob(file?.contentBlob))return null;
    const blob=file.contentBlob;
    if(!/^video\//i.test(file.mimeType || '') || blob.size!==file.sizeBytes)throw Error('Неверные параметры видео');
    const copy={...envelope};
    if(path.length===2)copy.entry={...envelope.entry};
    const target=path.length===2?copy.entry:copy;
    const metadata={...file,contentBase64:''};delete metadata.contentBlob;delete metadata.transport;
    target.file=metadata;
    const header=new TextEncoder().encode(JSON.stringify({envelope:copy,sizeBytes:blob.size}));
    if(header.length>256*1024)throw Error('Слишком большой объём сопутствующих данных видео');
    const length=new Uint8Array(4);new DataView(length.buffer).setUint32(0,header.length);
    return {body:new Blob([length,header,blob],{type:contentType}),contentType};
  }
  root.ITUS_VIDEO_TRANSPORT={encode,contentType,isVideo,mime};
})(typeof window!=='undefined'?window:globalThis);
