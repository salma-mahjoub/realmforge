import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {raster as render,compose} from './image.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const out=path.resolve(root,'../web/public/assets');
interface Art {id:string; category:string; source:string; width?:number; height?:number; note?:string; pack:string}
interface Recipe {art:Art[]; characters:Record<string,Record<string,{sources:string[];frameRate:number;note?:string}>>; enemies:Record<string,string[]>; audio:Record<string,{source:string;category:string;pack:string;loop?:boolean}>; themes:Record<string,string[]>}
const recipe=JSON.parse(await fs.readFile(path.join(root,'sources/recipe.json'),'utf8')) as Recipe;
const manifest:Record<string,any>={schema:1,baseUrl:'/assets/',tileSize:64,license:'CC0-1.0',elements:{},characters:{},enemies:{},themes:{},ui:{},editor:{},sfx:{},music:{}};
await fs.mkdir(out,{recursive:true});
async function save(rel:string,data:Buffer|string){await fs.mkdir(path.dirname(path.join(out,rel)),{recursive:true});await fs.writeFile(path.join(out,rel),data);}
async function json(rel:string,data:unknown){await save(rel,JSON.stringify(data,null,2)+'\n');}
async function raster(source:string,w=64,h=64){return render(path.join(root,'sources',source),w,h);}
for(const art of recipe.art){
 const rel=`${art.category}/${art.id}.png`; const w=art.width??64,h=art.height??64;
 await save(rel,await raster(art.source,w,h));
 const entry={texture:art.id,path:rel,width:w,height:h,source:art.source,pack:art.pack,...(art.note?{note:art.note}:{})};
 if(art.source.endsWith('.svg')){const svg=`${art.category}/svg/${art.id}.svg`;await save(svg,await fs.readFile(path.join(root,'sources',art.source)));Object.assign(entry,{svg});}
 if(art.category==='ui')manifest.ui[art.id]=entry;
 else if(art.category==='icons/editor')manifest.editor[art.id]=entry;
 else manifest.elements[art.id]=entry;
}
async function atlas(dir:string,entries:{name:string;source:string}[],size:number){
 const cols=Math.min(8,entries.length),rows=Math.ceil(entries.length/cols),stride=size+4;
 const frames:Record<string,unknown>={};const composites=[];
 for(const [i,entry] of entries.entries()){
  const x=(i%cols)*stride+2,y=Math.floor(i/cols)*stride+2;
  composites.push({input:await raster(entry.source,size,size),left:x,top:y});
  frames[entry.name]={frame:{x,y,w:size,h:size},rotated:false,trimmed:false,spriteSourceSize:{x:0,y:0,w:size,h:size},sourceSize:{w:size,h:size}};
  if(entry.source.endsWith('.svg'))await save(`${dir}/svg/${entry.name}.svg`,await fs.readFile(path.join(root,'sources',entry.source)));
 }
 await save(`${dir}/atlas.png`,compose(cols*stride,rows*stride,composites));
 await json(`${dir}/atlas.json`,{frames,meta:{app:'RealmForge asset builder',version:'1',image:'atlas.png',format:'RGBA8888',size:{w:cols*stride,h:rows*stride},scale:'1'}});
 return {texture:dir.replaceAll('/','-'),image:`${dir}/atlas.png`,atlas:`${dir}/atlas.json`};
}
for(const [name,anims] of Object.entries(recipe.characters)){
 const entries=Object.entries(anims).flatMap(([anim,value])=>value.sources.map((source,i)=>({name:`${anim}_${i}`,source})));
 const animations=Object.fromEntries(Object.entries(anims).map(([anim,v])=>[anim,{frames:v.sources.map((_,i)=>`${anim}_${i}`),frameRate:v.frameRate,repeat:['idle','walk','run'].includes(anim)?-1:0,...(v.note?{note:v.note}:{})}]));
 manifest.characters[name]={...await atlas(`characters/${name}`,entries,128),animations};
}
for(const [name,sources] of Object.entries(recipe.enemies)){
 const entries=sources.map((source,i)=>({name:`${name}_${i}`,source}));
 const moves=name==='walker'?entries.slice(0,2):name==='shell'?entries.slice(0,1):entries;
 const animations:Record<string,unknown>={idle:{frames:[`${name}_0`],frameRate:1,repeat:0},move:{frames:moves.map(e=>e.name),frameRate:8,repeat:-1}};
 if(name==='walker')animations.stomp={frames:['walker_2'],frameRate:1,repeat:0};
 if(name==='shell'){animations.walk={frames:['shell_1','shell_2'],frameRate:8,repeat:-1};animations.kick={frames:['shell_0'],frameRate:1,repeat:0};}
 if(name==='jumper')animations.jump={frames:['jumper_1'],frameRate:1,repeat:0};
 const value={...await atlas(`enemies/${name}`,entries,64),animations};
 manifest.enemies[name]=value;Object.assign(manifest.elements[name]??={},value,{frame:`${name}_0`});
}
for(const [theme,ids] of Object.entries(recipe.themes)){
 const composites=[];
 for(const [i,id] of ids.entries())composites.push({input:await fs.readFile(path.join(out,manifest.elements[id].path)),left:(i%8)*64,top:Math.floor(i/8)*64});
 const rel=`tiles/${theme}/tileset.png`;
 await save(rel,compose(512,Math.ceil(ids.length/8)*64,composites));
 manifest.themes[theme]={texture:`tiles-${theme}`,path:rel,tileWidth:64,tileHeight:64,margin:0,spacing:0,columns:8,tiles:Object.fromEntries(ids.map((id,i)=>[id.replace(`${theme}_`,''),i])),background:manifest.elements[`background_${theme}`]};
}
for(const [id,a] of Object.entries(recipe.audio)){
 const rel=`${a.category}/${id}${path.extname(a.source)}`;await save(rel,await fs.readFile(path.join(root,'sources',a.source)));
 manifest[a.category][id]={path:rel,pack:a.pack,loop:a.loop??false};
}
const aliases:Record<string,string>={'ground':'grass_ground','brick':'grass_brick','question':'grass_question','question-block':'grass_question','question_block':'grass_question','one-way':'grass_one_way','one-way-platform':'grass_one_way','one_way':'grass_one_way','oneWay':'grass_one_way','semi-solid':'grass_semi_solid','semi_solid':'grass_semi_solid','semisolid':'grass_semi_solid','falling-block':'falling_block','fallingBlock':'falling_block','pendulum':'pendulum_ball','wrecking-ball':'pendulum_ball','wrecking_ball':'pendulum_ball','chain':'chain_bridge','chain-bridge':'chain_bridge','spring':'spring','trampoline':'spring','conveyor':'conveyor_belt','conveyor-belt':'conveyor_belt','moving-platform':'moving_platform','movingPlatform':'moving_platform','rotating-platform':'rotating_platform','rotatingPlatform':'rotating_platform','big-coin':'big_coin','bigCoin':'big_coin','double-jump':'powerup_double_jump','doubleJump':'powerup_double_jump','dash':'powerup_dash','power-up':'powerup_double_jump','powerup':'powerup_double_jump','key-lock-door':'locked_door','keyLockDoor':'locked_door','lockedDoor':'locked_door','pipe':'door','switch-block':'switch_block'};
for(const [alias,id] of Object.entries(aliases)){if(alias===id)continue;if(!manifest.elements[id])throw Error(`Missing alias target ${id}`);manifest.elements[alias]={...manifest.elements[id],aliasOf:id};}
const packs=JSON.parse(await fs.readFile(path.join(root,'sources/packs.json'),'utf8')) as {id:string;url:string;license:string;author:string}[];
const musicPacks=JSON.parse(await fs.readFile(path.join(root,'sources/oga-packs.json'),'utf8')) as {id:string;url:string;license?:string;author?:string}[];
await json('credits.json',{license:'CC0-1.0',art:packs.map(({id,url,license,author})=>({id,url,license,author})),music:musicPacks.filter(p=>p.id.startsWith('music-')).map(p=>({id:p.id,url:p.url,license:p.license,author:p.author})),supplements:{author:'RealmForge contributors',license:'CC0-1.0'}});
manifest.credits='credits.json';
await json('manifest.json',manifest);
console.log(`Built ${recipe.art.length} images, ${Object.keys(recipe.characters).length} character atlases, ${Object.keys(recipe.enemies).length} enemy atlases, ${Object.keys(recipe.themes).length} tilesets and ${Object.keys(recipe.audio).length} audio files.`);
