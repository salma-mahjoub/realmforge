import {createRequire} from 'node:module';
import {EventEmitter} from 'node:events';
import type Phaser from 'phaser';
import {COLLISION_CATEGORIES as C,FIXED_MS} from '../src/constants.js';
const require=createRequire(import.meta.url);
export const Bodies=require('phaser/src/physics/matter-js/lib/factory/Bodies.js');
export const Body=require('phaser/src/physics/matter-js/lib/body/Body.js');
export const Composite=require('phaser/src/physics/matter-js/lib/body/Composite.js');
export const Query=require('phaser/src/physics/matter-js/lib/collision/Query.js');
const Engine=require('phaser/src/physics/matter-js/lib/core/Engine.js');

/** Headless Phaser boundary with the same Matter implementation shipped by Phaser 3.90. */
export function matterHarness(){
  const engine=Engine.create(),events=new EventEmitter(),worldEvents=new EventEmitter();
  const image=()=>({setDisplaySize(){return this;},setAlpha(){return this;},setPosition(){return this;},setRotation(){return this;},setFlipX(){return this;},destroy(){}});
  const graphics=()=>({fillStyle(){return this;},fillRect(){return this;},lineStyle(){return this;},strokeRect(){return this;},generateTexture(){},destroy(){}});
  const rectangle=(x:number,y:number,w:number,h:number,opts:object={})=>{
    const b=Bodies.rectangle(x,y,w,h,opts);Composite.add(engine.world,b);return b as MatterJS.BodyType;
  };
  const world=Object.assign(worldEvents,{localWorld:engine.world,add:(b:unknown)=>Composite.add(engine.world,b),remove:(b:unknown)=>Composite.remove(engine.world,b),getAllBodies:()=>Composite.allBodies(engine.world)});
  const scene={events,textures:{exists:()=>true},add:{image,graphics},matter:{body:Body,bodies:Bodies,query:Query,world,add:{rectangle}}} as unknown as Phaser.Scene;
  return {scene,world,engine,solid:(x:number,y:number,w:number,h:number)=>rectangle(x,y,w,h,{isStatic:true,collisionFilter:{category:C.solid,mask:0xffff,group:0}}),
    step(){world.emit('beforeupdate');Engine.update(engine,FIXED_MS);world.emit('afterupdate');},
  };
}
