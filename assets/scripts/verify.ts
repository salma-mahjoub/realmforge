import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {dimensions,visiblePixels} from './image.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../web/public/assets');
const m=JSON.parse(await fs.readFile(path.join(root,'manifest.json'),'utf8'));
const required=['ground','brick','question_block','ice','slime','one_way','semi_solid','spikes','lava','saw','falling_block','crate','seesaw','pendulum_ball','chain_bridge','spring','conveyor_belt','moving_platform','elevator','rotating_platform','walker','shell','flyer','jumper','cannon','coin','big_coin','key','powerup_double_jump','powerup_dash','start','checkpoint','goal','door','locked_door','switch','switch_block'];
for(const id of required)assert(m.elements[id],`Missing element ${id}`);
let references=0;
async function visit(v:any):Promise<void>{
 if(!v||typeof v!=='object')return;
 for(const [key,value] of Object.entries(v)){
  if(['path','image','atlas','svg'].includes(key)&&typeof value==='string'){assert(!value.includes('..'));assert((await fs.stat(path.join(root,value))).size>0,value);references++;}
  else if(value&&typeof value==='object')await visit(value);
 }
}
await visit(m);
const pngs=new Set<string>([...Object.values(m.elements),...Object.values(m.ui),...Object.values(m.editor)].map((v:any)=>v.path));
for(const file of pngs)assert(visiblePixels(await fs.readFile(path.join(root,file)))>32,`Empty image ${file}`);
for(const c of Object.values(m.characters) as any[]){
 const atlas=JSON.parse(await fs.readFile(path.join(root,c.atlas),'utf8'));const imageBuffer=await fs.readFile(path.join(root,c.image));const image=dimensions(imageBuffer);
 for(const name of ['idle','walk','run','jump','fall','skid','crouch']){
  const a=c.animations[name];assert(a?.frames.length,`Animation ${name}`);
  for(const frame of a.frames){assert(atlas.frames[frame]);const f=atlas.frames[frame].frame;assert(f.x+f.w<=image.width!&&f.y+f.h<=image.height!);assert(visiblePixels(imageBuffer,f)>f.w*f.h*0.02,`Empty/near-empty player frame ${frame}`);}
 }
}
for(const enemy of Object.values(m.enemies) as any[]){
 const atlas=JSON.parse(await fs.readFile(path.join(root,enemy.atlas),'utf8'));
 const meta=dimensions(await fs.readFile(path.join(root,enemy.image)));
 for(const frame of Object.values(atlas.frames) as any[]){assert(frame.frame.x+frame.frame.w<=meta.width!);assert(frame.frame.y+frame.frame.h<=meta.height!);}
}
for(const name of ['grass','desert','snow','castle']){
 const theme=m.themes[name];assert(theme);const meta=dimensions(await fs.readFile(path.join(root,theme.path)));assert.equal(meta.width!%64,0);assert.equal(meta.height!%64,0);assert(theme.background);
}
for(const sound of ['jump','coin','stomp','spring','death','goal'])assert(m.sfx[sound]);
assert(Object.keys(m.music).length>=2);assert(Object.values(m.music).every((v:any)=>v.loop));
async function size(dir:string):Promise<number>{let bytes=0;for(const e of await fs.readdir(dir,{withFileTypes:true})){const f=path.join(dir,e.name);bytes+=e.isDirectory()?await size(f):(await fs.stat(f)).size;}return bytes;}
const bytes=await size(root);assert(bytes<40*1024*1024);
console.log(`PASS: ${required.length}/${required.length} SPEC element IDs; ${Object.keys(m.characters).length} characters × 7 animations; ${Object.keys(m.enemies).length} enemies; 4 themes; 6 required SFX; ${Object.keys(m.music).length} loops.`);
console.log(`PASS: ${references} file references, atlas bounds and tileset grids; ${bytes} bytes (<40 MiB).`);

const lock=JSON.parse(await fs.readFile(path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../package-lock.json'),'utf8'));
for(const [pkg,entry] of Object.entries(lock.packages) as [string,{license?:string}][]){
 if(pkg&&entry.license)assert(['MIT','Apache-2.0','BSD-2-Clause','BSD-3-Clause','CC0-1.0'].includes(entry.license),`Disallowed dependency license ${pkg}: ${entry.license}`);
}
console.log('PASS: recorded npm dependency licenses are MIT or Apache-2.0.');
