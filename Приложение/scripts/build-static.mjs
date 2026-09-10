import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
const out=join(root,'dist');
rmSync(out,{recursive:true,force:true});mkdirSync(out,{recursive:true});
for(const name of ['index.html','assets','config']) cpSync(join(root,name),join(out,name),{recursive:true});
console.log('Готовая версия создана в dist; все адреса ресурсов относительные.');
