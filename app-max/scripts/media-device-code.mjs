import {MediaStore} from '../media-store.mjs';
const directory=process.env.MEDIA_STATE_DIR;
if(!directory||!/^\d{1,30}$/.test(process.argv[2]||''))throw Error('Set MEDIA_STATE_DIR and pass a numeric MAX ID. Run as the service owner.');
const store=new MediaStore(directory);await store.init();
console.log(await store.issueCode(process.argv[2]));
