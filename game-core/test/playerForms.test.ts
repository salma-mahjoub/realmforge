import {describe,it,expect,vi} from 'vitest';
import {createMatterPlayer} from '../src/adapters/phaserMatter.js';
import {createControllerState,controllerHeight,setControllerForm,hurtController,stepController,MovementState} from '../src/controller.js';
import {EMPTY_INPUT} from '../src/input.js';
import {PLAYER,toFixed} from '../src/constants.js';
import {createElementRuntime} from '../src/elements/index.js';
import {matterHarness,Query} from './matterHarness.js';

const hull=(player:ReturnType<typeof createMatterPlayer>)=>player.body.parts[1]!;
const height=(player:ReturnType<typeof createMatterPlayer>)=>hull(player).bounds.max.y-hull(player).bounds.min.y;
describe('player forms with real Matter bodies',()=>{
  it('grows to 48×120 with anchored feet, stable body/part identities and one callback',()=>{
    const h=matterHarness(),onFormChange=vi.fn(),player=createMatterPlayer(h.scene,100,100,{onFormChange});
    const body=player.body,main=hull(player),foot=main.bounds.max.y,footSensor=player.sensors.foot.position.y;
    player.setForm('big');player.setForm('big');
    expect(player.form).toBe('big');expect(height(player)).toBeCloseTo(120);
    expect(main.bounds.max.x-main.bounds.min.x).toBeCloseTo(48);
    expect(main.bounds.max.y).toBeCloseTo(foot);expect(player.sensors.foot.position.y).toBeCloseTo(footSensor);
    expect(player.body).toBe(body);expect(hull(player)).toBe(main);expect(onFormChange.mock.calls).toEqual([['big']]);
    expect(player.state.y).toBe(toFixed(17.5));expect(body.inertia).toBe(Infinity);
    player.destroy();expect(h.world.getAllBodies()).toHaveLength(0);
  });
  it('crouch-grows below a ceiling and stands only after clearance, with feet anchored',()=>{
    const h=matterHarness(),player=createMatterPlayer(h.scene,0,0);
    h.solid(0,62,300,64);const ceiling=h.solid(0,-70,160,64),feet=hull(player).bounds.max.y;
    player.setForm('big');
    expect(player.form).toBe('big');expect(player.state.crouched).toBe(true);expect(height(player)).toBeCloseTo(60);
    expect(Query.collides(hull(player),[ceiling])).toHaveLength(0);
    for(let i=0;i<5;i++)h.step();
    expect(height(player)).toBeCloseTo(60);expect(hull(player).bounds.max.y).toBeCloseTo(feet,1);
    h.world.remove(ceiling);h.step();
    expect(player.state.crouched).toBe(false);expect(height(player)).toBeCloseTo(120);
    expect(hull(player).bounds.max.y).toBeCloseTo(feet,1);expect(player.body.velocity.y).toBeCloseTo(0,3);
  });
  it('does not mistake normal resting floor penetration for a blocked ceiling',()=>{
    const h=matterHarness();let input={...EMPTY_INPUT};
    const player=createMatterPlayer(h.scene,0,0.04,{input:()=>input});h.solid(0,62,300,64);
    player.setForm('big');expect(height(player)).toBeCloseTo(120);expect(player.state.crouched).toBe(false);
    input.down=true;h.step();expect(height(player)).toBeCloseTo(60);
    input.down=false;h.step();expect(height(player)).toBeCloseTo(120);
  });
  it('uses a short hull when big crouches and does not stand through a newly covered tunnel',()=>{
    const h=matterHarness();let input={...EMPTY_INPUT};
    const player=createMatterPlayer(h.scene,0,0,{input:()=>input});h.solid(0,62,300,64);
    player.setForm('big');const feet=hull(player).bounds.max.y;input.down=true;h.step();
    expect(height(player)).toBeCloseTo(60);expect(player.state.mode).toBe(MovementState.crouch);
    const ceiling=h.solid(0,-70,160,64);input.down=false;h.step();
    expect(height(player)).toBeCloseTo(60);expect(Query.collides(hull(player),[ceiling])).toHaveLength(0);
    h.world.remove(ceiling);h.step();expect(height(player)).toBeCloseTo(120);
    expect(hull(player).bounds.max.y).toBeCloseTo(feet,1);
  });
  it('shrinks big on damage, ignores hits for 90 physics steps, then dies to the next hit',()=>{
    const h=matterHarness(),player=createMatterPlayer(h.scene,0,0);h.solid(0,62,300,64);
    player.setForm('big');const feet=hull(player).bounds.max.y;player.hurt();
    expect(player.form).toBe('small');expect(height(player)).toBeCloseTo(60);
    expect(hull(player).bounds.max.y).toBeCloseTo(feet);expect(player.invulnerable).toBe(true);
    for(let frame=0;frame<PLAYER.invulnerableFrames-1;frame++){player.hurt();h.step();}
    expect(player.state.invulnerableFrames).toBe(1);expect(player.state.mode).not.toBe(MovementState.dead);
    player.hurt();h.step();expect(player.invulnerable).toBe(false);
    player.hurt();expect(player.state.mode).toBe(MovementState.dead);expect(player.state.vx).toBe(0);expect(player.state.vy).toBe(0);
    player.setForm('big');expect(player.form).toBe('small');
  });
  it('kills small immediately and notifies the state callback',()=>{
    const h=matterHarness(),onStateChange=vi.fn(),player=createMatterPlayer(h.scene,0,0,{onStateChange});
    player.hurt();expect(player.state.mode).toBe(MovementState.dead);
    expect(onStateChange.mock.calls[0]?.slice(0,2)).toEqual([MovementState.dead,MovementState.idle]);
    h.step();expect(player.body.velocity.y).toBe(0);
  });
  it('restores forms, damage timer and hulls from a serialized state, then resets to small',()=>{
    const h=matterHarness(),player=createMatterPlayer(h.scene,0,0,{tile:48});
    player.setForm('big');const snapshot=JSON.parse(JSON.stringify(player.state));
    expect(height(player)).toBeCloseTo(90);player.hurt();player.setState(snapshot);
    expect(player.form).toBe('big');expect(height(player)).toBeCloseTo(90);expect(player.invulnerable).toBe(false);
    player.setState(createControllerState(10,20));expect(player.form).toBe('small');expect(height(player)).toBeCloseTo(45);
    expect(player.body.position.y).toBeCloseTo(60);
  });
  it('can detach after Phaser already tore down its Matter world',()=>{
    const h=matterHarness(),player=createMatterPlayer(h.scene,0,0);h.world.localWorld=null;
    expect(()=>player.destroy()).not.toThrow();expect(h.world.listenerCount('beforeupdate')).toBe(0);
  });
});

describe('form interactions',()=>{
  function setup(){
    const h=matterHarness(),runtime=createElementRuntime(h.scene,{tile:64});
    const player=createMatterPlayer(h.scene,0,0);runtime.attachPlayer(player);
    return {...h,runtime,player,add:(type:'brick'|'walker'|'spikes'|'lava'|'cannon',id=type)=>runtime.add({id,type,x:5,y:0})};
  }
  it('only breaks a brick hit from below in big form; small bumps leave it intact',()=>{
    const h=setup(),brick=h.runtime.add({id:'brick',type:'brick',x:0,y:-1});
    h.player.setState({...h.player.state,vy:toFixed(-2)});h.world.emit('beforeupdate');
    expect(brick.enabled).toBe(true);
    h.player.setForm('big');h.player.setState({...h.player.state,vy:toFixed(-2)});
    h.world.emit('beforeupdate');expect(brick.enabled).toBe(false);
  });
  it('enemy side contact and spikes hurt big, while lava kills even during invulnerability',()=>{
    const h=setup();h.player.setForm('big');const walker=h.add('walker');
    h.player.setState({...h.player.state,vy:toFixed(-1)});walker.activate(h.player);
    expect(h.player.form).toBe('small');expect(h.player.invulnerable).toBe(true);
    walker.activate(h.player);expect(h.player.state.mode).not.toBe(MovementState.dead);
    h.add('lava').activate(h.player);expect(h.player.state.mode).toBe(MovementState.dead);
    h.player.setState(createControllerState());h.player.setForm('big');h.add('spikes').activate(h.player);
    expect(h.player.form).toBe('small');expect(h.player.state.mode).not.toBe(MovementState.dead);
  });
  it('does not break bricks on side contact or while landing on top in big form',()=>{
    const h=setup();h.player.setForm('big');const brick=h.runtime.add({id:'brick',type:'brick',x:0,y:0});
    h.player.setState({...h.player.state,x:toFixed(13.75),y:0,vy:0});
    h.world.emit('beforeupdate');h.world.emit('afterupdate');expect(brick.enabled).toBe(true);
    h.player.setState({...h.player.state,x:0,y:toFixed(-22.9),vy:toFixed(1)});
    h.world.emit('afterupdate');expect(brick.enabled).toBe(true);
  });
});

describe('pure form helpers',()=>{
  it('keeps fixed-point feet when growing/shrinking and preserves immutable inputs',()=>{
    const initial=Object.freeze(createControllerState(3,10)),feet=initial.y+toFixed(controllerHeight(initial)/2);
    const big=setControllerForm(initial,'big');expect(big.y+toFixed(controllerHeight(big)/2)).toBe(feet);
    expect(hurtController(big).y+toFixed(PLAYER.smallHeight/2)).toBe(feet);
    expect(initial.form).toBe('small');expect(setControllerForm(initial,'big',true).crouched).toBe(true);
  });
  it('applies trusted pickup/damage contacts without adding replay input bits',()=>{
    const big=stepController(createControllerState(),EMPTY_INPUT,{grounded:true,mushroom:true});expect(big.form).toBe('big');
    const small=stepController(big,EMPTY_INPUT,{grounded:true,hurt:true});expect(small.invulnerableFrames).toBe(90);
    const protectedState=stepController(small,EMPTY_INPUT,{grounded:true,hurt:true});
    expect(protectedState.invulnerableFrames).toBe(89);expect(protectedState.mode).not.toBe(MovementState.dead);
  });
});
