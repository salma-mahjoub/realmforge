import {describe,it,expect,vi} from 'vitest';
import {createElementRuntime,ELEMENTS,ELEMENT_PROPS,normalizeProps} from '../../src/elements/index.js';
import {createMatterPlayer} from '../../src/adapters/phaserMatter.js';
import {createReplay,recordInput,simulateReplay} from '../../src/replay.js';
import {EMPTY_INPUT,decodeInput} from '../../src/input.js';
import {createControllerState} from '../../src/controller.js';
import {toFixed} from '../../src/constants.js';
import {matterHarness,Query} from '../matterHarness.js';

describe('mushroom',()=>{
  function setup(){
    const h=matterHarness(),onEvent=vi.fn(),runtime=createElementRuntime(h.scene,{tile:64,onEvent});
    const player=createMatterPlayer(h.scene,0,0);runtime.attachPlayer(player);
    const add=(props:Record<string,unknown>={})=>runtime.add({id:'mushroom',type:'mushroom',x:2,y:0,props});
    return {...h,runtime,player,add,onEvent};
  }
  it('registers speed and direction defaults and validates them',()=>{
    expect(ELEMENTS.mushroom.create).toBeTypeOf('function');expect(normalizeProps('mushroom')).toMatchObject({speed:1,direction:1});
    expect(ELEMENT_PROPS.mushroom.some(p=>p.name==='speed')).toBe(true);
    expect(()=>normalizeProps('mushroom',{speed:-1})).toThrow(RangeError);
  });
  it('grows on contact exactly once and removes the pickup body',()=>{
    const h=setup(),item=h.add();h.player.setState({...h.player.state,x:toFixed(32)});
    const feet=h.player.body.parts[1]!.bounds.max.y;h.world.emit('afterupdate');
    expect(h.player.form).toBe('big');expect(h.player.body.parts[1]!.bounds.max.y).toBeCloseTo(feet);
    expect(item.enabled).toBe(false);expect(h.world.getAllBodies()).not.toContain(item.bodies[0]);
    expect(h.onEvent).toHaveBeenCalledTimes(1);expect(h.onEvent.mock.calls[0]?.[0]).toBe('mushroom');
    expect(item.activate(h.player)).toBe(false);
  });
  it('uses crouch-growth when collected under a ceiling without clipping',()=>{
    const h=setup(),item=h.add(),ceiling=h.solid(128,-70,160,64);
    h.player.setState({...h.player.state,x:toFixed(32)});item.activate(h.player);
    expect(h.player.form).toBe('big');expect(h.player.state.crouched).toBe(true);
    expect(Query.collides(h.player.body.parts[1],[ceiling])).toHaveLength(0);
  });
  it('falls under gravity, patrols at fixed speed and reverses at walls',()=>{
    const h=setup(),item=h.add({speed:1,direction:1}),body=item.bodies[0]!;
    h.solid(128,100,400,64);h.solid(240,0,64,200);
    h.step();expect(body.velocity.x).toBeCloseTo(4);expect(body.position.y).toBeGreaterThan(0);
    for(let i=0;i<15;i++)h.step();expect(body.velocity.x).toBeLessThan(0);
    expect(body.bounds.max.x).toBeLessThanOrEqual(208.1);
  });
  it('disables movement/pickup, serializes props, and cleans up on shutdown',()=>{
    const h=setup(),item=h.add({enabled:false,speed:0.5,direction:-1}),body=item.bodies[0]!,position={...body.position};
    h.step();expect(body.position).toEqual(position);expect(item.activate(h.player)).toBe(false);
    expect(item.serialize()).toMatchObject({type:'mushroom',props:{enabled:false,speed:0.5,direction:-1}});
    item.setEnabled(true);h.step();expect(body.velocity.x).toBeCloseTo(-2);
    h.scene.events.emit('shutdown');expect(h.world.getAllBodies()).toHaveLength(0);
  });
  it('replays the same bitmasks through real pickup collisions with identical forms and positions',()=>{
    const replay=createReplay();for(let i=0;i<100;i++)recordInput(replay,{...EMPTY_INPUT,right:i<65,run:true});
    function run(inputs:number[]){
      const h=matterHarness();let input={...EMPTY_INPUT};const events:Array<[number,string]>=[];
      const runtime=createElementRuntime(h.scene,{tile:64,input:()=>input,onEvent:(event)=>events.push([player.state.frame,event])});
      runtime.add({id:'floor',type:'ground',x:4,y:2,props:{width:20}});
      const mushroom=runtime.add({id:'pickup',type:'mushroom',x:2,y:1,props:{direction:-1,speed:0.5}});
      const player=createMatterPlayer(h.scene,0,66,{input:()=>input,surface:runtime.surface,carry:runtime.carry});runtime.attachPlayer(player);
      const states=[];
      for(const mask of inputs){input=decodeInput(mask);h.step();states.push(player.state);}
      expect(mushroom.enabled).toBe(false);expect(player.form).toBe('big');expect(events.filter(([,e])=>e==='mushroom')).toHaveLength(1);
      h.scene.events.emit('shutdown');return {states,events};
    }
    const first=run(replay.inputs),second=run(JSON.parse(JSON.stringify(replay)).inputs);
    expect(first).toEqual(second);expect(first.states.some(s=>s.form==='small')).toBe(true);
    expect(first.states.some(s=>s.form==='big')).toBe(true);
  });
  it('re-simulates trusted mushroom overlap events in the pure replay solver',()=>{
    const replay=createReplay();for(let i=0;i<80;i++)recordInput(replay,{...EMPTY_INPUT,right:true});
    const resolve=(s:Readonly<ReturnType<typeof createControllerState>>)=>({contacts:{grounded:true,mushroom:s.x>=toFixed(12)},surface:{}});
    const initial=createControllerState();const first=simulateReplay(initial,replay,resolve);
    expect(first.form).toBe('big');expect(first.y).toBe(toFixed(-7.5));
    expect(simulateReplay(initial,JSON.parse(JSON.stringify(replay)),resolve)).toEqual(first);
    expect(initial.form).toBe('small');expect(replay.inputs.every(mask=>mask<64)).toBe(true);
  });
});
