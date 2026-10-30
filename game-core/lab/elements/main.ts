import Phaser from 'phaser';
import {createElementRuntime,ELEMENT_TYPES,inventoryFor,type ElementType} from '../../src/elements';
import {createMatterPlayer,installFixedMatterClock} from '../../src/adapters/phaserMatter';
import {createControllerState,MovementState} from '../../src/controller';
interface Manifest {baseUrl:string;elements:Record<string,{texture:string;path:string}>;characters:Record<string,{texture:string;image:string;atlas:string}>}
class Showcase extends Phaser.Scene {
  preload(){this.load.json('manifest','/assets/manifest.json');this.load.once('filecomplete-json-manifest',()=>{const m=this.cache.json.get('manifest') as Manifest;for(const a of Object.values(m.elements))if(!this.textures.exists(a.texture))this.load.image(a.texture,m.baseUrl+a.path);const hero=m.characters.green!;this.load.atlas(hero.texture,m.baseUrl+hero.image,m.baseUrl+hero.atlas);});}
  create(){
    const manifest=this.cache.json.get('manifest') as Manifest,tile=48;
    const keys=this.input.keyboard!.addKeys('LEFT,RIGHT,UP,DOWN,A,D,W,S,SHIFT,X,SPACE,Z,R,N,P') as Record<string,Phaser.Input.Keyboard.Key>;
    const down=(...names:string[])=>names.some(n=>keys[n]!.isDown);
    const input=()=>({left:down('LEFT','A'),right:down('RIGHT','D'),up:down('UP','W'),down:down('DOWN','S'),jump:down('SPACE','Z'),run:down('SHIFT','X')});
    const runtime=createElementRuntime(this,{tile,textures:manifest.elements,input});
    runtime.add({id:'floor',type:'ground',x:150,y:14,props:{width:300}});
    ELEMENT_TYPES.forEach((type,i)=>{
      const x=5+i*7,props:Record<string,unknown>={};
      if(type==='switch'){props.link='demo';props.timer=30;}
      if(type==='switch_block')props.group='demo';
      if(['door','pipe','locked_door'].includes(type))props.link='destination';
      if(type==='moving_platform'||type==='elevator')props.width=3;
      if(type==='chain_bridge'||type==='pendulum_ball')props.length=3;
      runtime.add({id:type,type,x,y:['brick','question_block','one_way','semi_solid','chain_bridge','pendulum_ball','moving_platform','elevator','rotating_platform'].includes(type)?10:13,props});
      this.add.text(x*tile-70,15*tile,type,{fontSize:'13px',color:'#ffffff'});
    });
    runtime.add({id:'destination',type:'door',x:275,y:13,props:{link:'door'}});
    const player=createMatterPlayer(this,2*tile,12*tile,{tile,input,surface:runtime.surface,carry:runtime.carry});runtime.attachPlayer(player);
    const hero=manifest.characters.green!;
    const graphic=this.textures.exists(hero.texture)?this.add.image(player.body.position.x,player.body.position.y,hero.texture,'idle_0').setDisplaySize(36,45):this.add.rectangle(0,0,36,45,0xffb36b);
    const hud=this.add.text(12,12,'',{fontSize:'16px',color:'#ffffff',backgroundColor:'#17263c',padding:{x:8,y:8}}).setScrollFactor(0).setDepth(10);
    this.cameras.main.setBounds(0,0,300*tile,850).startFollow(graphic,true,0.2,0.2);
    let station=0;
    this.events.on('update',()=>{
      if(Phaser.Input.Keyboard.JustDown(keys.N!))station=(station+1)%ELEMENT_TYPES.length;
      else if(Phaser.Input.Keyboard.JustDown(keys.P!))station=(station+ELEMENT_TYPES.length-1)%ELEMENT_TYPES.length;
      else station=-1;
      if(station>=0)player.setState(createControllerState((5+station*7)*16,8*16));
      station=Math.max(0,Math.min(ELEMENT_TYPES.length-1,Math.round((player.body.position.x/tile-5)/7)));
      if(down('R')||player.state.mode===MovementState.dead||player.body.position.y>950){const cp=inventoryFor(player).checkpoint;player.setState(createControllerState((cp?.x??2)*16,(cp?.y??12)*16-16));}
      graphic.setPosition(player.body.position.x,player.body.position.y);
      if(graphic instanceof Phaser.GameObjects.Image){graphic.setFlipX(player.state.facing<0);const frame=player.state.mode==='walk'||player.state.mode==='run'?`walk_${Math.floor(player.state.frame/8)%2}`:player.state.mode==='jump'?'jump_0':'idle_0';graphic.setFrame(frame);}
      const inv=inventoryFor(player);hud.setText(`ELEMENT LAB · ${ELEMENT_TYPES[station] as ElementType} · 60 Hz\nArrows/WASD · Space jump · Shift run/dash · down+jump drop · up enter/switch\nN/P next/previous station · R reset · coins ${inv.coins} · keys ${inv.keys} · double jump ${inv.doubleJump} · dash ${inv.dash} · goal ${inv.goal}`);
    });
    installFixedMatterClock(this);
  }
}
new Phaser.Game({type:Phaser.AUTO,width:1100,height:820,backgroundColor:'#203853',physics:{default:'matter',matter:{gravity:{x:0,y:1},debug:false}},scene:Showcase});
