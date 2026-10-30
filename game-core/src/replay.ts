import {decodeInput,encodeInput,type InputState} from './input.js';
import {stepController,type ControllerState,type Contacts,type Surface} from './controller.js';
export interface Replay {version:1; inputs:number[]}
export const createReplay = ():Replay => ({version:1,inputs:[]});
export function recordInput(replay:Replay,input:InputState):void {replay.inputs.push(encodeInput(input));}
export interface ReplayEnvironment {contacts:Contacts; surface?:Surface; resolvedPosition?:{x:number;y:number}}
/** Must be the server's trusted collision solver/level, never client-provided contact claims. */
export type EnvironmentResolver=(state:Readonly<ControllerState>,frame:number)=>ReplayEnvironment;
export function simulateReplay(initial:Readonly<ControllerState>,replay:Replay,resolve:EnvironmentResolver):ControllerState {
  if(replay.version!==1) throw new RangeError('Unsupported replay version');
  let s={...initial};
  for(let frame=0;frame<replay.inputs.length;frame++) {
    const env=resolve({...s},frame);
    if(env.resolvedPosition) s={...s,...env.resolvedPosition};
    s=stepController(s,decodeInput(replay.inputs[frame]!),env.contacts,env.surface);
  }
  return s;
}
