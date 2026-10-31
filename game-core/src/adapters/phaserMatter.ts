import type Phaser from 'phaser';
import { COLLISION_CATEGORIES as C, FIXED_MS, MOVEMENT, PLAYER, fixedToWorld, worldToFixed, toFixed } from '../constants.js';
import { createControllerState, stepController, controllerHeight, setControllerForm, hurtController, type PlayerForm, type Contacts, type ControllerState, type MovementState, type Surface } from '../controller.js';
import { EMPTY_INPUT, type InputState } from '../input.js';
export interface MatterPlayerOptions {
  tile?:number; width?:number; height?:number;
  input?:()=>InputState;
  surface?:(ground: MatterJS.BodyType | undefined)=>Surface;
  carry?:(ground: MatterJS.BodyType | undefined)=>{x:number;y:number};
  onStateChange?:(next:MovementState,previous:MovementState,state:Readonly<ControllerState>)=>void;
  onFormChange?:(form:PlayerForm)=>void;
}
/** Caller owns the world's fixed-step clock. See installFixedMatterClock. */
export function createMatterPlayer(scene:Phaser.Scene,x:number,y:number,opts:MatterPlayerOptions={}) {
  const scale=(opts.tile??MOVEMENT.tile)/MOVEMENT.referenceTile;
  const w=opts.width??PLAYER.width*scale,h=opts.height??PLAYER.smallHeight*scale;
  const { bodies:Bodies, body:Body, query:query }=scene.matter;
  // Phaser 3.90 exposes Query.collides at runtime but omits it from QueryFactory.
  const Query=query as MatterJS.QueryFactory & {collides(body:MatterJS.BodyType,bodies:MatterJS.BodyType[]):Array<{bodyA:MatterJS.BodyType;bodyB:MatterJS.BodyType}>};
  const world=scene.matter.world;
  const mask=C.solid|C.oneWay|C.enemy|C.hazard|C.pickup|C.sensor;
  const main=Bodies.rectangle(x,y,w,h,{chamfer:{radius:scale},friction:0,frictionStatic:0,frictionAir:0,restitution:0});
  const sensor=(sx:number,sy:number,sw:number,sh:number,label:string)=>Bodies.rectangle(sx,sy,sw,sh,{isSensor:true,label});
  const sensors={foot:sensor(x,y+h/2,w-4*scale,2*scale,'foot'),left:sensor(x-w/2,y,2*scale,h-4*scale,'left'),right:sensor(x+w/2,y,2*scale,h-4*scale,'right'),head:sensor(x,y-h/2,w-4*scale,2*scale,'head')};
  const body=Body.create({parts:[main,...Object.values(sensors)],friction:0,frictionStatic:0,frictionAir:0,restitution:0,collisionFilter:{category:C.player,mask,group:0}});
  // Phaser's per-body gravity opt-out; leave gravity enabled for other world objects.
  body.ignoreGravity=true;
  for(const part of body.parts) part.collisionFilter={category:C.player,mask,group:0};
  Body.setInertia(body,Infinity);
  world.add(body);
  let state=createControllerState(x/scale,y/scale);
  let destroyed=false;
  let hullHeight=h;
  const heightFor=(s:Readonly<ControllerState>)=>h*controllerHeight(s)/PLAYER.smallHeight;
  const solids=()=>world.getAllBodies().filter(b=>b!==body && !b.isSensor && !!((b.collisionFilter.category??1)&(C.solid|C.oneWay)) && !!((b.collisionFilter.mask??0xffff)&C.player));
  const standingHeight=h*PLAYER.bigHeight/PLAYER.smallHeight;
  // Only test the space added above the short hull. A full-height probe would
  // mistake Matter's normal floor penetration/slop for a blocked ceiling.
  const standingProbe=Bodies.rectangle(x,y,w-0.02,standingHeight-h-0.02);
  function canStand(bodies=solids()) {
    if(hullHeight>=standingHeight)return true;
    Body.setPosition(standingProbe,{x:body.position.x,y:main.bounds.min.y-(standingHeight-hullHeight)/2});
    return Query.collides(standingProbe,bodies).length===0;
  }
  /** Keep part identities (and runtime references), rebuild their hull around the feet. */
  function resize(height:number) {
    if(height===hullHeight)return;
    const center={x:body.position.x,y:main.bounds.max.y-height/2};
    const shape=(part:MatterJS.BodyType,px:number,py:number,pw:number,ph:number,chamfer=false)=>{
      const replacement=Bodies.rectangle(px,py,pw,ph,chamfer?{chamfer:{radius:scale}}:{});
      Body.setPosition(part,{x:px,y:py});Body.setVertices(part,replacement.vertices!);
    };
    shape(main,center.x,center.y,w,height,true);
    shape(sensors.foot,center.x,center.y+height/2,w-4*scale,2*scale);
    shape(sensors.head,center.x,center.y-height/2,w-4*scale,2*scale);
    shape(sensors.left,center.x-w/2,center.y,2*scale,height-4*scale);
    shape(sensors.right,center.x+w/2,center.y,2*scale,height-4*scale);
    Body.setParts(body,[main,...Object.values(sensors)]);Body.setInertia(body,Infinity);
    hullHeight=height;
  }
  function notify(old:Readonly<ControllerState>) {
    if(state.form!==old.form)opts.onFormChange?.(state.form);
    if(state.mode!==old.mode)opts.onStateChange?.(state.mode,old.mode,{...state});
  }
  function applyForm(next:ControllerState) {
    const old=state;
    resize(heightFor(next));
    state={...next,x:worldToFixed(body.position.x,scale),y:worldToFixed(body.position.y,scale)};
    Body.setVelocity(body,{x:fixedToWorld(state.vx,scale),y:fixedToWorld(state.vy,scale)});
    notify(old);
  }
  const hit=(sensorBody:MatterJS.BodyType,bodies:MatterJS.BodyType[])=>Query.collides(sensorBody,bodies).map(c=>c.bodyA.parent===body ? c.bodyB.parent : c.bodyA.parent);
  function beforeStep() {
    const bodies=solids();
    const ground=hit(sensors.foot,bodies)[0];
    const contacts:Contacts={grounded:!!ground,left:hit(sensors.left,bodies).length>0,right:hit(sensors.right,bodies).length>0,head:hit(sensors.head,bodies).length>0,standBlocked:state.form==='big'&&state.crouched&&!canStand(bodies)};
    const carry=opts.carry?.(ground);
    contacts.carryX=worldToFixed(carry?.x??0,scale);contacts.carryY=worldToFixed(carry?.y??0,scale);
    state={...state,x:worldToFixed(body.position.x,scale),y:worldToFixed(body.position.y,scale)};
    if(contacts.head && state.vy<0) {
      // Probe the full future body, rather than trusting a head-only gap.
      const original={...body.position};
      outer: for(let n=1;n<=MOVEMENT.cornerCorrection;n++) for(const direction of [-1,1]) {
        Body.setPosition(body,{x:original.x+n*scale*direction,y:original.y+fixedToWorld(state.vy,scale)});
        if(Query.collides(main,bodies).length===0) {contacts.headCorrectionX=toFixed(n*direction);break outer;}
      }
      Body.setPosition(body,original);
    }
    const old=state;
    const surface=opts.surface?.(ground)??{};
    state=stepController(state,opts.input?.()??EMPTY_INPUT,contacts,surface);
    const motionY=state.y-old.y+toFixed((controllerHeight(state)-controllerHeight(old))/2);
    resize(heightFor(state));
    state={...state,y:worldToFixed(body.position.y,scale)+motionY};
    if(contacts.headCorrectionX && state.vy<0) Body.translate(body,{x:fixedToWorld(contacts.headCorrectionX,scale),y:0});
    // Include conveyor/carry displacement, but exclude the corner-correction teleport.
    Body.setVelocity(body,{x:fixedToWorld(state.x-old.x-(contacts.headCorrectionX && state.vy<0 ? contacts.headCorrectionX : 0),scale),y:fixedToWorld(motionY,scale)});
    notify(old);
  }
  function afterStep() {state={...state,x:worldToFixed(body.position.x,scale),y:worldToFixed(body.position.y,scale)};}
  world.on('beforeupdate',beforeStep);world.on('afterupdate',afterStep);
  function destroy() {
    if(destroyed)return;destroyed=true;
    world.off('beforeupdate',beforeStep);world.off('afterupdate',afterStep);if(!('localWorld' in world)||world.localWorld)world.remove(body);
    scene.events.off('shutdown',destroy);
  }
  scene.events.once('shutdown',destroy);
  return {body,sensors,get state():Readonly<ControllerState>{return {...state};},
    get form():PlayerForm{return state.form;},get invulnerable():boolean{return state.invulnerableFrames>0;},
    setForm(form:PlayerForm){if(!destroyed)applyForm(setControllerForm(state,form,!canStand()));},
    hurt(){if(!destroyed)applyForm(hurtController(state));},
    setState(next:ControllerState){const old=state;resize(heightFor(next));state={...next};Body.setPosition(body,{x:fixedToWorld(state.x,scale),y:fixedToWorld(state.y,scale)});Body.setVelocity(body,{x:fixedToWorld(state.vx,scale),y:fixedToWorld(state.vy,scale)});notify(old);},destroy};
}
/** Install once per scene (shared by all players), independent of render refresh rate. */
export function installFixedMatterClock(scene:Phaser.Scene):()=>void {
  const world=scene.matter.world;
  const previous=world.autoUpdate;world.autoUpdate=false;
  // Legacy SPEC compatibility marker; Phaser 3.90 uses runner.delta instead.
  Object.assign(world.runner,{isFixed:true,delta:FIXED_MS});
  let accumulator=0;
  const update=(_time:number,delta:number)=>{
    if(!world.enabled)return;
    accumulator+=Math.min(delta,250);
    while(accumulator>=FIXED_MS){world.step(FIXED_MS);accumulator-=FIXED_MS;}
  };
  scene.events.on('update',update);
  const stop=()=>{scene.events.off('update',update);world.autoUpdate=previous;scene.events.off('shutdown',stop);};
  scene.events.once('shutdown',stop);return stop;
}
