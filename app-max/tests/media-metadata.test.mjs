import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {scanMediaJson} from '../media-metadata.mjs';
import '../assets/api-normalizers.js';
const png=Buffer.from([137,80,78,71,13,10,26,10,1,2,3]);
const data={success:true,data:{documentRef:'doc',entries:[{entryRef:'entry',type:'application/octet-stream',file:{fileRef:'file',fileName:'photo',mimeType:'application/octet-stream',contentBase64:png.toString('base64')}},{entryRef:'video',type:'video/mp4',file:{fileRef:'movie',fileName:'movie',mimeType:'video/mp4',contentBase64:'A'.repeat(5*1024*1024)}}]}};
const {metadata,upstreamBytes}=await scanMediaJson(Readable.from([JSON.stringify(data)]));assert.ok(upstreamBytes>5*1024*1024);assert.ok(JSON.stringify(metadata).length<1000);assert.equal(metadata.data.entries[0].file.mimeType,'image/png');
const normalized=globalThis.ITUS_API.normalizeProcess(metadata,'defectSheet');assert.equal(normalized.entries[0].type,'photo');assert.equal(normalized.entries[0].file.fileName,'photo.png');assert.equal(normalized.entries[1].type,'video');assert.equal(normalized.entries[1].file.fileName,'movie.mp4');assert.ok(normalized.entries.every(x=>!x.file.contentBase64));
console.log('Media metadata: oversized legacy Base64 removed in bounded memory; PNG signature, MIME kinds and file extension preserved');
