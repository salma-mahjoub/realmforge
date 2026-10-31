/** Run: npx tsx --tsconfig ../web/tsconfig.json test-mushroom.ts (from assets/). */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {PNG} from 'pngjs';
import {rasterTrimmedBottom} from './scripts/image.js';
import {readManifest,elementTexture} from '../web/src/game/assets/registry.ts';
import {coreTextures,toCoreDef} from '../web/src/game/elements/bridge.ts';
import {ELEMENT_TYPES} from '../game-core/src/elements/schema.ts';
import {createMushroom} from '../game-core/src/elements/mushroom.ts';
import {matterHarness} from '../game-core/test/matterHarness.ts';

const read=(relative:string)=>fs.readFile(fileURLToPath(new URL(relative,import.meta.url)));
const manifest=JSON.parse((await read('../web/public/assets/manifest.json')).toString());
const source=JSON.parse((await read('sources/custom/kenney-mushroom/source.json')).toString());
for(const entry of source.files){
 const content=await read(`sources/custom/kenney-mushroom/${entry.local}`);
 assert.equal(createHash('sha256').update(content).digest('hex'),entry.sha256);
}
const svg=await read('sources/custom/kenney-mushroom/mushroom_red.svg');
assert.deepEqual(await read('../web/public/assets/items/svg/mushroom.svg'),svg);
const png=await read('../web/public/assets/items/mushroom.png');
assert.deepEqual(png,await rasterTrimmedBottom(fileURLToPath(new URL('sources/custom/kenney-mushroom/mushroom_red.svg',import.meta.url)),128,128));
assert.deepEqual(png,await read('../web/public/assets/icons/editor/palette_mushroom.png'));
assert.notDeepEqual(png,await read('../web/public/assets/items/powerup_double_jump.png'));
assert.notDeepEqual(png,await read('../web/public/assets/items/powerup_dash.png'));
assert.deepEqual(manifest.elements.mushroom,manifest.items.mushroom);
assert.equal(manifest.elements.mushroom.pack,'new-platformer-pack');
assert.equal(manifest.elements.mushroom.animations,undefined,'Static SVG must not pretend to be an animation');

const pixels=PNG.sync.read(png),alpha=(x:number,y:number)=>pixels.data[(y*pixels.width+x)*4+3]!;
assert.equal(pixels.width,128);assert.equal(pixels.height,128);
let left=128,right=-1,top=128,bottom=-1;
for(let y=0;y<128;y++)for(let x=0;x<128;x++)if(alpha(x,y)>0){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}
assert(left<=1&&right>=126&&top>0&&top<24&&bottom===127,'Trimmed art should fill width and end at the feet baseline');
assert(alpha(64,127)>0&&alpha(0,127)===0&&alpha(127,127)===0,'Mushroom stem, not a circle/square placeholder');
console.log(`PASS mushroom provenance: exact SVG + licence hashes; 128×128 PNG; visible bounds ${left},${top}–${right},${bottom}; bottom-centered; distinct from badges and generated circle/square silhouette.`);

const files=readManifest(manifest,ELEMENT_TYPES);
const loaded=new Set(files.map(file=>file.key));
assert(files.some(file=>file.kind==='image'&&file.key==='mushroom'&&file.url==='/assets/items/mushroom.png'));
for(const theme of ['grass','desert','snow','castle'] as const){
 assert.equal(elementTexture('mushroom',theme).key,'mushroom');
 const textures=coreTextures(theme),h=matterHarness();
 assert.equal(textures.mushroom?.texture,'mushroom');
 let used='',origin:number[]=[],position:number[]=[],size:number[]=[];
 const original=h.scene.add.image;
 h.scene.add.image=((x:number,y:number,key:string)=>{
  used=key;
  return Object.assign(original(x,y,key),{
   setOrigin(x:number,y:number){origin=[x,y];return this;},
   setDisplaySize(w:number,h:number){size=[w,h];return this;},
   setPosition(x:number,y:number){position=[x,y];return this;},
  });
 }) as typeof h.scene.add.image;
 h.scene.textures.exists=(key:string)=>loaded.has(key);
 h.scene.add.graphics=(()=>{throw Error('Mushroom tried to generate fallback art');}) as typeof h.scene.add.graphics;
 const def=toCoreDef({id:'pickup',type:'mushroom',x:2,y:1})!;
 const item=createMushroom(h.scene,def,{tile:64,textures});
 assert.equal(used,'mushroom');assert.deepEqual(origin,[0.5,1]);assert.deepEqual(size,[64,64]);
 const body=item.bodies[0]!;
 assert.deepEqual(position,[body.position.x,body.bounds.max.y]);
 assert.equal(body.bounds.max.x-body.bounds.min.x,64);assert.equal(body.bounds.max.y-body.bounds.min.y,64);
 assert.equal(item.serialize().type,'mushroom');assert.equal(item.serialize().props?.speed,1);
 item.destroy();assert.equal(h.world.getAllBodies().length,0);
}
console.log('PASS real registry → coreTextures → game-core createMushroom: 4 themes select fetched texture, no fallback generation; original 64×64 body and speed; feet anchored to body bottom.');
