import { MOVEMENT as M, PLAYER, toFixed as fp } from './constants.js';
import { encodeInput, decodeInput, inputEdges, type InputState } from './input.js';
export enum MovementState { idle='idle', walk='walk', run='run', skid='skid', jump='jump', fall='fall', crouch='crouch', wallSlide='wallSlide', dead='dead' }
export type PlayerForm = 'small' | 'big';
export interface ControllerState {
  x:number; y:number; vx:number; vy:number; frame:number; mode:MovementState; facing:-1|1;
  coyote:number; jumpBuffer:number; previousInput:number; jumpRow:number; jumpCut:boolean;
  airMax:number; wallLock:number;
  form:PlayerForm; crouched:boolean; invulnerableFrames:number;
}
export interface Contacts {
  grounded?:boolean; left?:boolean; right?:boolean; head?:boolean;
  /** Collision solver supplies a verified clear lateral offset in reference fixed units. */
  headCorrectionX?:number;
  /** Moving platform displacement per frame, reference fixed units. */
  carryX?:number; carryY?:number;
  /** Trusted level events/clearance, derived again when resolving a replay. */
  mushroom?:boolean; hurt?:boolean; standBlocked?:boolean;
}
export interface Surface { kind?:'normal'|'ice'|'slime'; conveyor?:number }
export const NORMAL_SURFACE: Readonly<Surface> = Object.freeze({kind:'normal'});
export function createControllerState(x=0,y=0): ControllerState {
  return {x:fp(x),y:fp(y),vx:0,vy:0,frame:0,mode:MovementState.idle,facing:1,coyote:0,jumpBuffer:0,previousInput:0,jumpRow:0,jumpCut:false,airMax:fp(M.walkMax),wallLock:0,form:'small',crouched:false,invulnerableFrames:0};
}
export const controllerHeight = (s:Pick<ControllerState,'form'|'crouched'>):number => s.form==='big'&&!s.crouched ? PLAYER.bigHeight : PLAYER.smallHeight;
function resizeState(state:Readonly<ControllerState>,form:PlayerForm,crouched:boolean):ControllerState {
  const next={...state,form,crouched};
  next.y-=fp((controllerHeight(next)-controllerHeight(state))/2);
  return next;
}
/** Keep feet anchored. A blocked growth succeeds in the short, crouched big hull. */
export function setControllerForm(state:Readonly<ControllerState>,form:PlayerForm,standBlocked=false):ControllerState {
  if(state.mode===MovementState.dead||state.form===form)return {...state};
  return resizeState(state,form,form==='big'&&(standBlocked||state.mode===MovementState.crouch));
}
export function hurtController(state:Readonly<ControllerState>):ControllerState {
  if(state.mode===MovementState.dead||state.invulnerableFrames>0)return {...state};
  if(state.form==='small')return {...state,mode:MovementState.dead,vx:0,vy:0};
  return {...setControllerForm(state,'small'),invulnerableFrames:PLAYER.invulnerableFrames};
}
const approach = (v:number,target:number,delta:number) => v < target ? Math.min(target,v+delta) : Math.max(target,v-delta);
function launch(s:ControllerState, velocity:number):void {
  s.vy=fp(velocity); s.coyote=0; s.jumpBuffer=0; s.jumpCut=false; s.mode=MovementState.jump;
}
/** No mutation, clocks, random numbers, browser or engine dependencies. +Y is down. */
export function stepController(state:Readonly<ControllerState>, input:InputState, contacts:Contacts={}, surface:Surface=NORMAL_SURFACE):ControllerState {
  let s={...state,frame:state.frame+1,previousInput:encodeInput(input),invulnerableFrames:Math.max(0,state.invulnerableFrames-1)};
  if(s.mode===MovementState.dead) return {...s,vx:0,vy:0};
  if(contacts.mushroom)s=setControllerForm(s,'big',contacts.standBlocked);
  if(contacts.hurt&&state.invulnerableFrames===0)s=hurtController(s);
  if(s.mode===MovementState.dead)return {...s,vx:0,vy:0};
  const edge=inputEdges(input,decodeInput(state.previousInput));
  // A rising body must not regain jumps from a trailing foot sensor.
  let grounded=!!contacts.grounded && s.vy>=0;
  s.coyote=grounded ? M.coyoteFrames : state.coyote;
  s.jumpBuffer=edge.jumpPressed ? M.jumpBufferFrames : state.jumpBuffer;
  s.wallLock=Math.max(0,state.wallLock-1);
  const dir=Number(input.right)-Number(input.left);
  const crouch=(grounded && input.down)||(s.form==='big'&&(!!contacts.standBlocked||(s.crouched&&input.down)));
  s=resizeState(s,s.form,s.form==='big'&&crouch);
  const ice=surface.kind==='ice', slime=surface.kind==='slime';
  const max=fp((input.run ? M.runMax : M.walkMax)*(slime ? 0.5 : 1));
  const friction=fp(M.releaseFriction*(ice ? 0.2 : slime ? 3 : 1));
  let skid=false;
  if(grounded) {
    s.vy=0; s.airMax=max;
    if(!crouch && dir) {
      s.facing=dir as -1|1;
      skid=s.vx*dir<0;
      const accel=fp((skid ? M.skidDeceleration : input.run ? M.runAcceleration : M.walkAcceleration)*(ice ? 0.25 : 1));
      s.vx=approach(s.vx,dir*max,Math.abs(s.vx)>max && !skid ? friction : accel);
    } else s.vx=approach(s.vx,0,friction);
  } else if(dir && !s.wallLock) {
    // No passive air friction; retain takeoff run cap even after releasing run.
    const cap=Math.max(fp(M.walkMax),s.airMax);
    const accel=fp(s.vx*dir<0 ? M.airReverseAcceleration : M.airAcceleration);
    if(s.vx*dir<cap) s.vx=approach(s.vx,dir*cap,accel);
    s.facing=dir as -1|1;
  }
  let jumped=false;
  const wall=contacts.left ? -1 : contacts.right ? 1 : 0;
  if(s.jumpBuffer>0 && (grounded || s.coyote>0)) {
    s.jumpRow=M.jumpSpeedThresholds.filter(t=>Math.abs(s.vx)>=fp(t)).length;
    launch(s,M.jumpVelocity[s.jumpRow]!); grounded=false; jumped=true;
  } else if(s.jumpBuffer>0 && wall && !grounded && !s.wallLock) {
    launch(s,M.wallJumpY); s.vx=-wall*fp(M.wallJumpX); s.airMax=fp(M.runMax);
    s.wallLock=M.wallLockFrames; s.facing=-wall as -1|1; s.jumpRow=3; jumped=true;
  }
  if(!grounded) {
    if(edge.jumpReleased || !input.jump || s.vy>=0) s.jumpCut=true;
    if(!jumped) s.vy=Math.min(fp(M.maxFallSpeed),s.vy+fp((s.jumpCut ? M.heavyGravity : M.heldGravity)[s.jumpRow]!));
    if(contacts.head && s.vy<0) {
      const correction=contacts.headCorrectionX ?? 0;
      if(Number.isInteger(correction) && correction!==0 && Math.abs(correction)<=fp(M.cornerCorrection)) s.x+=correction;
      else {s.vy=0;s.jumpCut=true;}
    }
    if(wall && dir===wall && s.vy>0 && !s.wallLock) {s.vy=Math.min(s.vy,fp(M.wallSlideMax));s.mode=MovementState.wallSlide;}
    else s.mode=s.vy<0 ? MovementState.jump : MovementState.fall;
  } else s.mode=crouch ? MovementState.crouch : skid ? MovementState.skid : s.vx===0 ? MovementState.idle : Math.abs(s.vx)>fp(M.walkMax) ? MovementState.run : MovementState.walk;
  if((contacts.left && s.vx<0)||(contacts.right && s.vx>0)) s.vx=0;
  s.x+=s.vx+(grounded ? (surface.conveyor??0)+(contacts.carryX??0) : 0);
  s.y+=s.vy+(grounded ? contacts.carryY??0 : 0);
  if(!grounded && !jumped) s.coyote=Math.max(0,s.coyote-1);
  if(!jumped) s.jumpBuffer=Math.max(0,s.jumpBuffer-1);
  return s;
}
export function stompBounce(state:Readonly<ControllerState>,jumpHeld:boolean):ControllerState {
  const s={...state,jumpRow:3}; launch(s,jumpHeld ? M.heldStompVelocity : M.stompVelocity);return s;
}
export function springLaunch(state:Readonly<ControllerState>,velocity:number=M.springVelocity):ControllerState {
  const s={...state,jumpRow:3};launch(s,velocity);return s;
}
