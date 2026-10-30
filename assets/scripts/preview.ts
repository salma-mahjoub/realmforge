import fs from 'node:fs/promises';
import path from 'node:path';
import {thumbnail,compose,svg} from './image.js';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');const out=path.resolve(root,'../web/public/assets');
const m=JSON.parse(await fs.readFile(path.join(out,'manifest.json'),'utf8'));
const entries=[...Object.entries(m.themes).map(([id,v]:[string,any])=>({id,path:v.path})),...Object.entries(m.elements).filter(([id,v]:[string,any])=>!v.aliasOf&&!id.includes('background')).map(([id,v]:[string,any])=>({id,path:v.path})),...Object.entries(m.characters).map(([id,v]:[string,any])=>({id,path:v.image})),...Object.entries(m.editor).filter(([id])=>id.startsWith('tool')).map(([id,v]:[string,any])=>({id,path:v.path}))];
const w=960,cell=96,h=Math.ceil(entries.length/10)*112;const composites=[];
for(const [i,e] of entries.entries()){
 const x=i%10*cell,y=Math.floor(i/10)*112;
 composites.push({input:thumbnail(await fs.readFile(path.join(out,e.path)),88,88),left:x+4,top:y});
 const label=Buffer.from(`<svg width="96" height="20"><text x="48" y="12" text-anchor="middle" font-family="sans-serif" font-size="8" fill="white">${e.id}</text></svg>`);
 composites.push({input:await svg(label),left:x,top:y+88});
}
await fs.writeFile(path.join(root,'PREVIEW.png'),compose(w,h,composites,[37,51,69,255]));
console.log('Wrote assets/PREVIEW.png');
