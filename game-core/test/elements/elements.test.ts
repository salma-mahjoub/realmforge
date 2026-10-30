import {describe,it,expect} from 'vitest';
import {createRequire} from 'node:module';
import {EventEmitter} from 'node:events';
import type Phaser from 'phaser';
import {ELEMENTS,ELEMENT_TYPES,ELEMENT_PROPS,normalizeProps,createElementRuntime,inventoryFor,surfaceForBody,carryForBody,type ElementInstance,type ElementPlayer,type ElementDef} from '../../src/elements/index.js';
import {createControllerState,stepController,MovementState} from '../../src/controller.js';
import {EMPTY_INPUT} from '../../src/input.js';
import {toFixed,worldToFixed} from '../../src/constants.js';
const require=createRequire(import.meta.url);
const Bodies=require('phaser/src/physics/matter-js/lib/factory/Bodies.js');
const Body=require('phaser/src/physics/matter-js/lib/body/Body.js');
const Composite=require('phaser/src/physics/matter-js/lib/body/Composite.js');
const Constraint=require('phaser/src/physics/matter-js/lib/constraint/Constraint.js');
const Query=require('phaser/src/physics/matter-js/lib/collision/Query.js');
const Engine=require('phaser/src/physics/matter-js/lib/core/Engine.js');
function harness(){
  const engine=Engine.create(),events=new EventEmitter(),worldEvents=new EventEmitter();
  const graphics=()=>({fillStyle(){return this;},fillRect(){return this;},lineStyle(){return this;},strokeRect(){return this;},generateTexture(){},destroy(){}});
  const image=()=>({setDisplaySize(){return this;},setAlpha(){return this;},setPosition(){return this;},setRotation(){return this;},destroy(){}});
  const addBody=(...args:unknown[])=>{const b=Bodies.rectangle(...args);Composite.add(engine.world,b);return b;};
  const addConstraint=(options:object)=>{const c=Constraint.create(options);Composite.add(engine.world,c);return c;};
  const world=Object.assign(worldEvents,{add:(b:unknown)=>Composite.add(engine.world,b),remove:(b:unknown)=>Composite.remove(engine.world,b),removeConstraint:(c:unknown)=>Composite.remove(engine.world,c),getAllBodies:()=>Composite.allBodies(engine.world)});
  const scene={events,textures:{exists:()=>true},add:{graphics,image},matter:{body:Body,bodies:Bodies,query:Query,world,add:{rectangle:addBody,circle:(x:number,y:number,r:number,opts:object)=>{const b=Bodies.circle(x,y,r,opts);Composite.add(engine.world,b);return b;},worldConstraint:(body:unknown,length:number,stiffness:number,opts:object)=>addConstraint({bodyB:body,length,stiffness,...opts}),constraint:(bodyA:unknown,bodyB:unknown,length:number,stiffness:number,opts:object)=>addConstraint({bodyA,bodyB,length,stiffness,...opts})}}} as unknown as Phaser.Scene;
  const player:ElementPlayer={body:addBody(0,-32,24,30),state:createControllerState(0,-8),setState(s){Object.assign(this,{state:{...s}});Body.setPosition(this.body,{x:s.x/256*4,y:s.y/256*4});}};
  return {scene,player,world,engine,step(){world.emit('beforeupdate');Engine.update(engine,1000/60);world.emit('afterupdate');}};
}
function setup(){const h=harness(),map=new Map<string|number,ElementInstance>();return {...h,map,add(type:ElementDef['type'],props:Record<string,unknown>={},id:string|number=type,x=0,y=0){const e=ELEMENTS[type].create(h.scene,{id,type,x,y,props},{tile:64,linkResolver:id=>map.get(id),groupResolver:group=>[...map.values()].filter(e=>e.def.props?.group===group)});map.set(id,e);return e;}};}
describe('element palette',()=>{
  it('covers the complete SPEC palette and editor defaults are valid',()=>{
    expect(ELEMENT_TYPES).toHaveLength(38);
    for(const type of ELEMENT_TYPES){expect(ELEMENTS[type].create).toBeTypeOf('function');const p=normalizeProps(type);expect(Object.keys(p)).toHaveLength(ELEMENT_PROPS[type].length);for(const descriptor of ELEMENT_PROPS[type]){expect(descriptor).toHaveProperty('default');if(descriptor.kind==='number'){expect(p[descriptor.name]).toBeGreaterThanOrEqual(descriptor.min!);expect(p[descriptor.name]).toBeLessThanOrEqual(descriptor.max!);}}}
  });
  it('constructs, serializes and cleans up every factory using real Matter bodies',()=>{
    const h=setup();for(const type of ELEMENT_TYPES){const e=h.add(type);e.update(240);expect(e.serialize().type).toBe(type);e.destroy();e.destroy();}expect(Composite.allBodies(h.engine.world)).toHaveLength(1);expect(Composite.allConstraints(h.engine.world)).toHaveLength(0);
  });
  it('rejects invalid properties without mutating input defaults',()=>{expect(()=>normalizeProps('spring',{launch:-1})).toThrow();expect(()=>normalizeProps('moving_platform',{path:[{x:Infinity,y:2}]})).toThrow();const a=normalizeProps('moving_platform');(a.path as unknown[]).push({x:2,y:3});expect(normalizeProps('moving_platform').path).toEqual([]);});
  it('resolves door links, suppresses teleport loops and consumes a key once',()=>{
    const h=setup();const door=h.add('door',{link:'exit'});expect(door.activate(h.player)).toBe(false);h.add('pipe',{link:'door'},'exit',10,3);expect(door.activate(h.player)).toBe(true);expect(h.player.state.x).toBe(worldToFixed(640));expect(h.map.get('exit')!.activate(h.player)).toBe(false);
    const lock=h.add('locked_door',{link:'exit'});inventoryFor(h.player).teleportCooldown=0;expect(lock.activate(h.player)).toBe(false);h.add('key').activate(h.player);expect(lock.activate(h.player)).toBe(true);expect(inventoryFor(h.player).keys).toBe(0);
  });
  it('toggles a linked block or group and debounces switch presses',()=>{
    const h=setup();const block=h.add('switch_block',{group:'blue'});const sw=h.add('switch',{link:'blue',timer:5});expect(sw.activate()).toBe(true);expect(block.enabled).toBe(false);expect(block.bodies[0]!.collisionFilter.mask).toBe(0);expect(sw.activate()).toBe(false);sw.update(5);expect(sw.activate()).toBe(true);expect(block.enabled).toBe(true);
  });
  it('feeds conveyor, ice and slime into the unchanged controller surface API',()=>{
    const h=setup();const belt=h.add('conveyor_belt',{speed:4,direction:-1});const s=stepController(createControllerState(),EMPTY_INPUT,{grounded:true},surfaceForBody(belt.bodies[0]));expect(s.x).toBe(toFixed(-1));expect(surfaceForBody(h.add('ice').bodies[0]).kind).toBe('ice');expect(surfaceForBody(h.add('slime').bodies[0]).kind).toBe('slime');
  });
  it('launches springs and bounces stomps through controller helpers',()=>{
    const h=setup();h.add('spring').activate(h.player);expect(h.player.state.vy).toBe(toFixed(-7));h.player.setState({...createControllerState(0,-10),vy:toFixed(2)});const walker=h.add('walker');expect(walker.activate(h.player,{...EMPTY_INPUT,jump:true})).toBe(true);expect(h.player.state.vy).toBe(toFixed(-5));expect(walker.enabled).toBe(false);
  });
  it('shell transitions stomp → resting → kick → projectile, hazards kill',()=>{
    const h=setup();h.player.setState({...createControllerState(0,-10),vy:toFixed(1)});const shell=h.add('shell');shell.activate(h.player);expect(shell.phase).toBe('resting');h.player.setState(createControllerState(-12,0));shell.activate(h.player);expect(shell.phase).toBe('projectile');shell.update(1);expect(shell.bodies[0]!.velocity.x).toBeGreaterThan(0);h.add('spikes').activate(h.player);expect(h.player.state.mode).toBe(MovementState.dead);
  });
  it('carries the player with waypoint displacement and shakes before falling',()=>{
    const h=setup();const moving=h.add('moving_platform',{path:[{x:2,y:0}],speed:2});moving.update(1);const carry=carryForBody(moving.bodies[0]);expect(carry.x).toBe(2);const s=stepController(createControllerState(),EMPTY_INPUT,{grounded:true,carryX:worldToFixed(carry.x)});expect(s.x).toBe(worldToFixed(2));const falling=h.add('falling_block',{timer:3});falling.activate();falling.update(2);expect(falling.phase).toBe('shaking');falling.update(1);expect(falling.bodies[0]!.isStatic).toBe(false);
  });
  it('runtime filters upward/drop-through platforms before controller contacts and detaches',()=>{
    const h=harness();let input={...EMPTY_INPUT};const runtime=createElementRuntime(h.scene,{tile:64,input:()=>input});runtime.attachPlayer(h.player);const platform=runtime.add({id:1,type:'one_way',x:0,y:0});h.player.setState({...createControllerState(0,-10),vy:toFixed(-2)});h.world.emit('beforeupdate');expect(platform.bodies[0]!.isSensor).toBe(true);h.player.setState({...createControllerState(0,-6),vy:0});h.world.emit('beforeupdate');expect(platform.bodies[0]!.isSensor).toBe(false);input={...EMPTY_INPUT,down:true,jump:true};h.world.emit('beforeupdate');expect(platform.bodies[0]!.isSensor).toBe(true);expect(h.player.state.vy).toBeGreaterThan(0);runtime.destroy();expect(h.world.listenerCount('beforeupdate')).toBe(0);
  });
  it('runtime launches on spring top contact and ignores down+jump on ordinary ground',()=>{
    const h=harness();let input={...EMPTY_INPUT};const runtime=createElementRuntime(h.scene,{tile:64,input:()=>input});runtime.attachPlayer(h.player);runtime.add({id:1,type:'spring',x:0,y:0});h.player.setState({...createControllerState(0,-12),vy:toFixed(1)});h.world.emit('afterupdate');expect(h.player.state.vy).toBe(toFixed(-7));runtime.destroy();
    const ground=createElementRuntime(h.scene,{tile:64,input:()=>input});ground.attachPlayer(h.player);ground.add({id:2,type:'ground',x:0,y:0});h.player.setState(createControllerState(0,-12));input={...EMPTY_INPUT,down:true,jump:true};h.world.emit('beforeupdate');expect(h.player.state.vy).toBe(0);ground.destroy();
  });
  it('cannon projectiles expire and Matter advances dynamic bodies under gravity',()=>{
    const h=setup();const cannon=h.add('cannon',{timer:10});cannon.update(10);expect(cannon.bodies).toHaveLength(2);cannon.setEnabled(false);cannon.update(200);expect(cannon.bodies).toHaveLength(2);cannon.setEnabled(true);cannon.update(200);expect(cannon.bodies.length).toBeLessThanOrEqual(20);const crate=h.add('crate',{},'crate',20,0);const y=crate.bodies[0]!.position.y;for(let i=0;i<10;i++)h.step();expect(crate.bodies[0]!.position.y).toBeGreaterThan(y);
  });

});
