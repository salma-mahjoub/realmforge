import type Phaser from 'phaser';
import { COLLISION_CATEGORIES as C, worldToFixed, fixedToWorld, toFixed } from '../constants.js';
import { MovementState, springLaunch, stompBounce, type Surface, type ControllerState } from '../controller.js';
import { EMPTY_INPUT, type InputState } from '../input.js';
import { ELEMENT_TYPES, ELEMENT_PROPS, normalizeProps, type ElementType, type ElementDef, type EntityId, type Point } from './schema.js';
export * from './schema.js';
export interface ElementPlayer { body:MatterJS.BodyType; readonly state:Readonly<ControllerState>; setState(state:ControllerState):void }
export interface ElementContext { tile:number; textures?:Record<string,{texture:string}>; linkResolver:(id:EntityId)=>ElementInstance|ElementDef|undefined; groupResolver?:(group:string)=>ElementInstance[] }
export interface ElementInstance {
  readonly def:ElementDef; bodies:MatterJS.BodyType[]; constraints:MatterJS.ConstraintType[];
  enabled:boolean; phase:string; carry:Point; surface:Surface;
  update(dtFrame:number):void; destroy():void; serialize():ElementDef;
  setEnabled(enabled:boolean):void; activate(player?:ElementPlayer,input?:InputState):boolean;
}
export interface ElementFactory { (scene:Phaser.Scene,def:ElementDef,ctx:ElementContext):ElementInstance; props:typeof ELEMENT_PROPS[ElementType]; create(scene:Phaser.Scene,def:ElementDef,ctx:ElementContext):ElementInstance }
const sensors=new Set<ElementType>(['spikes','lava','saw','pendulum_ball','coin','big_coin','key','powerup_double_jump','powerup_dash','start','checkpoint','goal','door','pipe','switch']);
const enemies=new Set<ElementType>(['walker','shell','flyer','jumper','cannon']);
const dynamic=new Set<ElementType>(['crate','seesaw','pendulum_ball','chain_bridge','walker','shell','jumper']);
const instances=new WeakMap<MatterJS.BodyType,ElementInstance>();
export const elementForBody=(body:MatterJS.BodyType|undefined)=>body?instances.get(body.parent)||instances.get(body):undefined;
export const surfaceForBody=(body:MatterJS.BodyType|undefined):Surface=>elementForBody(body)?.surface??{kind:'normal'};
export const carryForBody=(body:MatterJS.BodyType|undefined):Point=>elementForBody(body)?.carry??{x:0,y:0};
export interface PlayerInventory { coins:number; keys:number; doubleJump:boolean; dash:boolean; checkpoint?:Point; goal:boolean; teleportCooldown:number }
const inventories=new WeakMap<ElementPlayer,PlayerInventory>();
export function inventoryFor(player:ElementPlayer):PlayerInventory {
  let i=inventories.get(player);if(!i){i={coins:0,keys:0,doubleJump:false,dash:false,goal:false,teleportCooldown:0};inventories.set(player,i);}return i;
}
function create(scene:Phaser.Scene,inputDef:ElementDef,ctx:ElementContext):ElementInstance {
  if(!(ctx.tile>0))throw new RangeError('tile must be positive');
  const def=structuredClone(inputDef),p=normalizeProps(def.type,def.props);def.props=p;
  const t=ctx.tile,scale=t/16,type=def.type,B=scene.matter.body;
  const x=def.x*t,y=def.y*t,w=Number(p.width)*t*(type==='seesaw'?Number(p.length):1),h=Number(p.height)*t;
  const category=enemies.has(type)?C.enemy:sensors.has(type)?(['spikes','lava','saw','pendulum_ball'].includes(type)?C.hazard:['start','checkpoint','goal','door','pipe','switch'].includes(type)?C.sensor:C.pickup):['one_way','semi_solid'].includes(type)?C.oneWay:C.solid;
  const bodies:MatterJS.BodyType[]=[],constraints:MatterJS.ConstraintType[]=[],visuals:Phaser.GameObjects.Image[]=[];
  const isSensor=sensors.has(type);
  const make=(bx:number,by:number,bw:number,bh:number,isStatic=!dynamic.has(type))=>{
    const config={isStatic,isSensor,friction:type==='ice'?0.01:type==='slime'?0.9:0.1,frictionAir:0,label:type,collisionFilter:{category,mask:0xffff,group:0}};
    const b=['saw','pendulum_ball'].includes(type)?scene.matter.add.circle(bx,by,Math.min(bw,bh)/2,config):scene.matter.add.rectangle(bx,by,bw,bh,config);
    bodies.push(b);
    const key=ctx.textures?.[type]?.texture;
    if(key && scene.textures.exists(key))visuals.push(scene.add.image(bx,by,key).setDisplaySize(bw,bh));
    else {const key=`elements-fallback-${type}`;if(!scene.textures.exists(key)){const g=scene.add.graphics();g.fillStyle(category===C.hazard?0xe85165:category===C.enemy?0xbc77ed:category===C.pickup?0xffd66b:0x66bda8);g.fillRect(0,0,32,32);g.lineStyle(2,0x182b42);g.strokeRect(0,0,32,32);g.generateTexture(key,32,32);g.destroy();}visuals.push(scene.add.image(bx,by,key).setDisplaySize(bw,bh));}
    return b;
  };
  const body=make(x,y,w,['one_way','semi_solid','moving_platform','elevator','rotating_platform','seesaw','chain_bridge','conveyor_belt'].includes(type)?h/4:h);
  if(enemies.has(type)){B.setInertia(body,Infinity);if(type==='flyer')body.ignoreGravity=true;}
  if(type==='seesaw')constraints.push(scene.matter.add.worldConstraint(body,0,1,{pointA:{x,y},pointB:{x:0,y:0}}));
  if(type==='pendulum_ball'){B.setPosition(body,{x:x+t*Number(p.length)/2,y:y+t*Number(p.length)});constraints.push(scene.matter.add.worldConstraint(body,t*Number(p.length),0.95,{pointA:{x,y}}));}
  if(type==='chain_bridge'){
    B.setStatic(body,true);
    for(let n=1;n<=Number(p.length);n++){const segment=make(x+n*t,y,t,t/4,n===Number(p.length));constraints.push(scene.matter.add.constraint(bodies[n-1]!,segment,t,0.95,{pointA:{x:t/2,y:0},pointB:{x:-t/2,y:0},length:0}));}
  }
  let frame=0,triggerFrame=-1,used=false,destroyed=false,waypoint=0,direction=Number(p.direction??1)||1;
  let lastPosition={...body.position},lastAngle=body.angle;
  let projectileAge=new Map<MatterJS.BodyType,number>();
  const basePath=(p.path as Point[]|undefined)??[];
  const path=basePath.length?basePath.map(v=>({x:v.x*t,y:v.y*t})):[{x,y},{x:x+(type==='elevator'?0:Number(p.distance??4)*t),y:y+(type==='elevator'?-Number(p.distance??4)*t:0)}];
  const item:ElementInstance={def,bodies,constraints,enabled:true,phase:'idle',carry:{x:0,y:0},surface:{kind:type==='ice'?'ice':type==='slime'?'slime':'normal',conveyor:type==='conveyor_belt'?worldToFixed(Number(p.speed)*direction,scale):0},
    setEnabled(enabled){item.enabled=enabled;for(const b of bodies)b.collisionFilter.mask=enabled?0xffff:0;for(const v of visuals)v.setAlpha(enabled?1:0.2);},
    serialize:()=>structuredClone(def),
    activate(player,input=EMPTY_INPUT){
      if(!item.enabled||destroyed)return false;
      const inv=player?inventoryFor(player):undefined;
      if(type==='switch'){
        if(triggerFrame>=0&&frame-triggerFrame<Number(p.timer))return false;
        triggerFrame=frame;item.phase=item.phase==='on'?'off':'on';
        const target=ctx.linkResolver(p.link as EntityId);
        if(target && 'setEnabled' in target)target.setEnabled(!target.enabled);
        else for(const member of ctx.groupResolver?.(String(p.link))??[])member.setEnabled(!member.enabled);
        return true;
      }
      if(type==='falling_block'){if(triggerFrame<0){triggerFrame=frame;item.phase='shaking';}return true;}
      if(type==='brick'){item.destroy();return true;}
      if(type==='question_block'){if(used)return false;used=true;item.phase='used';if(inv){if(p.reward==='key')inv.keys++;else if(p.reward==='powerup_double_jump')inv.doubleJump=true;else if(p.reward==='powerup_dash')inv.dash=true;else inv.coins+=p.reward==='big_coin'?10:1;}return true;}
      if(!player||!inv)return false;
      if(type==='spring'){player.setState(springLaunch(player.state,-Number(p.launch)));return true;}
      if(['spikes','lava','saw','pendulum_ball'].includes(type)){player.setState({...player.state,mode:MovementState.dead,vx:0,vy:0});return true;}
      if(type==='locked_door' && !used){if(inv.keys<=0)return false;inv.keys--;used=true;item.phase='unlocked';body.isSensor=true;}
      if(['door','pipe','locked_door'].includes(type)){
        if(inv.teleportCooldown>0)return false;
        const target=ctx.linkResolver(p.link as EntityId);if(!target)return false;
        const dest='def' in target?target.def:target;
        player.setState({...player.state,x:worldToFixed(dest.x*t,scale),y:worldToFixed(dest.y*t,scale),vx:0,vy:0});inv.teleportCooldown=30;return true;
      }
      if(type==='checkpoint'){inv.checkpoint={x:def.x,y:def.y};item.phase='active';return true;}
      if(type==='goal'){inv.goal=true;item.phase='complete';return true;}
      if(['coin','big_coin','key','powerup_double_jump','powerup_dash'].includes(type)){
        if(used)return false;used=true;if(type==='key')inv.keys++;else if(type==='powerup_double_jump')inv.doubleJump=true;else if(type==='powerup_dash')inv.dash=true;else inv.coins+=type==='big_coin'?10:1;item.destroy();return true;
      }
      if(enemies.has(type) && type!=='cannon'){
        const stomp=player.state.vy>=0 && player.body.bounds.max.y<=body.bounds.min.y+t*0.4;
        if(stomp){player.setState(stompBounce(player.state,input.jump));if(type==='shell'){item.phase='resting';B.setVelocity(body,{x:0,y:body.velocity.y});}else item.destroy();return true;}
        if(type==='shell' && item.phase==='resting'){item.phase='projectile';direction=player.body.position.x<body.position.x?1:-1;return true;}
        player.setState({...player.state,mode:MovementState.dead,vx:0,vy:0});return true;
      }
      return false;
    },
    update(dt){
      if(!Number.isInteger(dt)||dt<0)throw new RangeError('dtFrame must be a nonnegative integer');
      for(let step=0;step<dt&&!destroyed;step++){
        frame++;item.carry={x:0,y:0};if(!item.enabled)continue;
        
        if(type==='saw'||type==='rotating_platform')B.setAngle(body,body.angle+Number(p.speed)*direction*Math.PI/180);
        if(type==='moving_platform'||type==='elevator'){
          const target=path[waypoint]!,dx=target.x-body.position.x,dy=target.y-body.position.y,dist=Math.hypot(dx,dy),speed=Number(p.speed);
          if(dist<=speed){B.setPosition(body,target);waypoint=(waypoint+1)%path.length;}else B.setPosition(body,{x:body.position.x+dx/dist*speed,y:body.position.y+dy/dist*speed});
        }
        if(type==='flyer')B.setPosition(body,{x:x+Math.sin(frame/Number(p.period)*Math.PI*2)*t*Number(p.amplitude)*direction,y:y+Math.sin(frame/Number(p.period)*Math.PI*4)*t/2});
        if(type==='falling_block'&&triggerFrame>=0){if(frame-triggerFrame>=Number(p.timer)){B.setStatic(body,false);item.phase='falling';}else B.setPosition(body,{x:x+(frame%4<2?-1:1)*t/32,y});}
        if(type==='walker'||type==='shell'||type==='jumper'){
          if(frame>1&&Math.abs(body.velocity.x)<Number(p.speed)*0.1&&item.phase!=='resting')direction=-direction;
          if(Math.abs(body.position.x-x)>t*4)direction=body.position.x>x?-1:1;
          const vx=type==='shell'&&item.phase==='resting'?0:Number(p.speed)*direction*(item.phase==='projectile'?6:1);
          B.setVelocity(body,{x:vx,y:type==='jumper'&&frame%Number(p.timer)===0?-6*scale:body.velocity.y});
        }
        if(type==='cannon'&&frame%Number(p.timer)===0){const shot=make(body.position.x+direction*t,body.position.y,t/3,t/3,false);shot.isSensor=true;shot.ignoreGravity=true;shot.collisionFilter.category=C.hazard;B.setVelocity(shot,{x:Number(p.speed)*direction*4,y:0});projectileAge.set(shot,0);}
        for(const [shot,age] of projectileAge){if(age>=180){scene.matter.world.remove(shot);const i=bodies.indexOf(shot);bodies.splice(i,1);visuals.splice(i,1)[0]?.destroy();instances.delete(shot);projectileAge.delete(shot);}else projectileAge.set(shot,age+1);}
        item.carry={x:body.position.x-lastPosition.x,y:body.position.y-lastPosition.y};lastPosition={...body.position};
        // Angular displacement is evaluated at the player's contact point by the runtime.
        angular.set(body,body.angle-lastAngle);lastAngle=body.angle;
        bodies.forEach((b,i)=>visuals[i]?.setPosition(b.position.x,b.position.y).setRotation(b.angle));
      }
    },
    destroy(){if(destroyed)return;destroyed=true;item.enabled=false;for(const c of constraints)scene.matter.world.removeConstraint(c);for(const b of bodies){instances.delete(b);scene.matter.world.remove(b);}for(const v of visuals)v.destroy();scene.events.off('shutdown',item.destroy);},
  };
  for(const b of bodies)instances.set(b,item);
  item.setEnabled(Boolean(p.enabled));scene.events.once('shutdown',item.destroy);return item;
}
export function carryAtBody(body:MatterJS.BodyType|undefined,point:Point):Point {
 const d=carryForBody(body);if(!body)return d;const a=angular.get(body)??0,x=point.x-body.position.x,y=point.y-body.position.y;return {x:d.x+x*(Math.cos(a)-1)-y*Math.sin(a),y:d.y+x*Math.sin(a)+y*(Math.cos(a)-1)};
}
const angular=new WeakMap<MatterJS.BodyType,number>();
export const ELEMENTS=Object.fromEntries(ELEMENT_TYPES.map(type=>{
  const factory=(scene:Phaser.Scene,def:ElementDef,ctx:ElementContext)=>create(scene,def,ctx);
  return [type,Object.assign(factory,{props:ELEMENT_PROPS[type],create:factory})];
})) as Record<ElementType,ElementFactory>;

export * from './runtime.js';
