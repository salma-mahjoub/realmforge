import type Phaser from 'phaser';
import { COLLISION_CATEGORIES as C, worldToFixed, fixedToWorld } from '../constants.js';
import { MovementState, setControllerForm } from '../controller.js';
import { normalizeProps, type ElementDef } from './schema.js';
import { createElementVisual, positionElementVisual } from './display.js';
import type { ElementContext, ElementInstance } from './index.js';

/** A physical pickup: gravity/floor contact with a fixed-step horizontal patrol. */
export function createMushroom(scene:Phaser.Scene,inputDef:ElementDef,ctx:ElementContext):ElementInstance {
  if(!(ctx.tile>0))throw new RangeError('tile must be positive');
  const def=structuredClone(inputDef),p=normalizeProps('mushroom',def.props);def.props=p;
  const scale=ctx.tile/16,w=Number(p.width)*ctx.tile,h=Number(p.height)*ctx.tile;
  const B=scene.matter.body,body=scene.matter.add.rectangle(def.x*ctx.tile,def.y*ctx.tile,w,h,{
    friction:0,frictionStatic:0,frictionAir:0,restitution:0,label:'mushroom',
    collisionFilter:{category:C.pickup,mask:C.player|C.solid|C.oneWay,group:0},
  });
  B.setInertia(body,Infinity);
  const candidate=ctx.textures?.mushroom,ref=candidate&&scene.textures.exists(candidate.texture)?candidate:undefined;
  const fallback='elements-fallback-mushroom';
  if(!ref&&!scene.textures.exists(fallback)){
    const g=scene.add.graphics();g.fillStyle(0xffd66b);g.fillRect(0,0,32,32);g.generateTexture(fallback,32,32);g.destroy();
  }
  const visual=createElementVisual(scene,'mushroom',ref??{texture:fallback},body.position.x,body.position.y,w,h,ctx.tile);
  const query=scene.matter.query as MatterJS.QueryFactory & {collides(body:MatterJS.BodyType,bodies:MatterJS.BodyType[]):unknown[]};
  let destroyed=false,direction=Number(p.direction)||1;
  const speed=fixedToWorld(worldToFixed(Number(p.speed)*scale,scale),scale);
  const probe=scene.matter.bodies.rectangle(body.position.x,body.position.y,w+speed,h-0.2);
  const item:ElementInstance={def,bodies:[body],constraints:[],enabled:true,phase:'moving',carry:{x:0,y:0},surface:{kind:'normal'},
    serialize:()=>structuredClone(def),
    setEnabled(enabled){item.enabled=enabled;body.collisionFilter.mask=enabled?C.player|C.solid|C.oneWay:0;B.setStatic(body,!enabled);B.setInertia(body,Infinity);visual.setAlpha(enabled?1:0.2);},
    activate(player){
      if(!item.enabled||destroyed||!player||player.state.mode===MovementState.dead)return false;
      if(player.setForm)player.setForm('big');else player.setState(setControllerForm(player.state,'big'));
      item.destroy();return true;
    },
    update(dt){
      if(!Number.isInteger(dt)||dt<0)throw new RangeError('dtFrame must be a nonnegative integer');
      for(let frame=0;frame<dt&&!destroyed;frame++){
        if(!item.enabled)continue;
        const obstacles=scene.matter.world.getAllBodies().filter(b=>b!==body&&!b.isSensor&&!!((b.collisionFilter.category??1)&(C.solid|C.oneWay))&&!!((b.collisionFilter.mask??0xffff)&C.pickup)&&b.bounds.min.y<body.bounds.max.y-0.1&&b.bounds.max.y>body.bounds.min.y+0.1);
        B.setPosition(probe,{x:body.position.x+direction*(speed/2+0.1),y:body.position.y});
        if(query.collides(probe,obstacles).length)direction=-direction;
        B.setVelocity(body,{x:speed*direction,y:body.velocity.y});
        positionElementVisual(visual,body.position.x,body.position.y,0);
      }
    },
    destroy(){if(destroyed)return;destroyed=true;item.enabled=false;const world=scene.matter.world;if(!('localWorld' in world)||world.localWorld)world.remove(body);visual.destroy();scene.events.off('shutdown',item.destroy);},
  };
  item.setEnabled(Boolean(p.enabled));scene.events.once('shutdown',item.destroy);return item;
}
