import type Phaser from 'phaser';
import {ELEMENTS,inventoryFor,surfaceForBody,carryAtBody,type ElementInstance,type ElementPlayer,type ElementContext} from './index.js';
import type {ElementDef,EntityId} from './schema.js';
import {EMPTY_INPUT,type InputState} from '../input.js';
import {springLaunch,MovementState} from '../controller.js';
import {toFixed} from '../constants.js';
/** Construct before the Matter player: filtering and movement precede contact queries. */
export function createElementRuntime(scene:Phaser.Scene,options:{tile:number;textures?:ElementContext['textures'];input?:()=>InputState;onEvent?:(type:string,element:ElementInstance)=>void}) {
  const elements=new Map<EntityId,ElementInstance>();let player:ElementPlayer|undefined,previous=EMPTY_INPUT,drop=0,airJump=false,dashUsed=false;
  const query=scene.matter.query as MatterJS.QueryFactory & {collides(body:MatterJS.BodyType,bodies:MatterJS.BodyType[]):unknown[]};
  const touching=(a:MatterJS.BodyType,b:MatterJS.BodyType)=>query.collides(a,[b]).length>0;
  const main=()=>player!.body.parts.length>1?player!.body.parts[1]!:player!.body;
  const above=(b:MatterJS.BodyType)=>Math.abs(main().bounds.max.y-b.bounds.min.y)<options.tile/8&&main().bounds.max.x>b.bounds.min.x&&main().bounds.min.x<b.bounds.max.x;
  const before=()=>{
    const input=options.input?.()??EMPTY_INPUT;
    if(player){
      const inv=inventoryFor(player);inv.teleportCooldown=Math.max(0,inv.teleportCooldown-1);
      if(input.down&&input.jump&&!previous.jump&&[...elements.values()].some(e=>e.enabled&&['one_way','semi_solid'].includes(e.def.type)&&above(e.bodies[0]!))){drop=12;player.setState({...player.state,coyote:0,jumpBuffer:0,previousInput:player.state.previousInput|16,vy:toFixed(1)});}
      drop=Math.max(0,drop-1);
      const grounded=[...elements.values()].some(e=>e.enabled&&e.bodies.some(b=>!b.isSensor&&above(b)));
      if(grounded){airJump=false;dashUsed=false;}
      if(inv.doubleJump&&!airJump&&!grounded&&player.state.coyote===0&&input.jump&&!previous.jump&&!input.down){airJump=true;player.setState(springLaunch(player.state,-4));}
      if(inv.dash&&!dashUsed&&input.run&&!previous.run){dashUsed=true;player.setState({...player.state,vx:toFixed(6*player.state.facing),airMax:toFixed(6),vy:0});}
    }
    for(const e of elements.values()){
      if(player&&['one_way','semi_solid'].includes(e.def.type)){
        const b=e.bodies[0]!;b.isSensor=drop>0||player.state.vy<0||main().bounds.max.y>b.bounds.min.y+options.tile/8;
      }
      if(player&&e.enabled&&['brick','question_block'].includes(e.def.type)&&player.state.vy<0){
        const b=e.bodies[0]!,m=main();if(m.bounds.min.x<b.bounds.max.x&&m.bounds.max.x>b.bounds.min.x&&Math.abs(m.bounds.min.y-b.bounds.max.y)<options.tile/5)e.activate(player,input);
      }
      e.update(1);
    }
    previous={...input};
  };
  const after=()=>{
    if(!player)return;
    const input=options.input?.()??EMPTY_INPUT;
    for(const e of elements.values()){
      if(!e.enabled)continue;
      const b=e.bodies[0]!;
      if(e.def.type==='falling_block'&&above(b))e.activate(player,input);
      const nearTop=above(b)&&['spring','walker','shell','flyer','jumper'].includes(e.def.type);
      const nearDoor=['locked_door'].includes(e.def.type)&&Math.hypot(main().position.x-b.position.x,main().position.y-b.position.y)<options.tile*1.25;
      if(!nearTop&&!nearDoor&&!e.bodies.some(b=>touching(main(),b)))continue;
      if(e.def.type==='spring'&&(player.state.vy<0||main().position.y>b.position.y))continue;
      if(['door','pipe','locked_door'].includes(e.def.type)&&!input.up)continue;
      if(e.def.type==='switch'&&!input.up&&!input.down)continue;
      if(e.def.type==='falling_block'&&e.phase==='falling'&&main().position.y>b.position.y)player.setState({...player.state,mode:MovementState.dead});
      if(e.def.type==='cannon'&&e.bodies.slice(1).some(b=>touching(main(),b)))player.setState({...player.state,mode:MovementState.dead});
      if(e.activate(player,input))options.onEvent?.(e.def.type,e);
    }
    for(const shell of elements.values())if(shell.enabled&&shell.phase==='projectile'&&shell.def.type==='shell')for(const enemy of elements.values())if(enemy!==shell&&enemy.enabled&&['walker','shell','flyer','jumper','cannon'].includes(enemy.def.type)&&touching(shell.bodies[0]!,enemy.bodies[0]!))enemy.destroy();
  };
  scene.matter.world.on('beforeupdate',before);scene.matter.world.on('afterupdate',after);
  const destroy=()=>{scene.matter.world.off('beforeupdate',before);scene.matter.world.off('afterupdate',after);for(const e of elements.values())e.destroy();elements.clear();scene.events.off('shutdown',destroy);};
  scene.events.once('shutdown',destroy);
  return {elements,add(def:ElementDef){if(elements.has(def.id))throw new Error(`Duplicate element id ${def.id}`);const e=ELEMENTS[def.type].create(scene,def,{...options,linkResolver:id=>elements.get(id),groupResolver:group=>[...elements.values()].filter(e=>e.def.props?.group===group)});elements.set(def.id,e);return e;},attachPlayer(value:ElementPlayer){player=value;},surface:surfaceForBody,carry:(body:MatterJS.BodyType|undefined)=>carryAtBody(body,player?.body.position??{x:0,y:0}),destroy};
}
