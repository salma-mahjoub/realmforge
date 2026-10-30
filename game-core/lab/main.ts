import Phaser from 'phaser';
import {createMatterPlayer,installFixedMatterClock} from '../src/adapters/phaserMatter';
import {COLLISION_CATEGORIES as C,createControllerState,fixedToWorld,fromFixed,springLaunch} from '../src/index';
class Lab extends Phaser.Scene {
  create(){
    this.cameras.main.setBounds(0,0,3000,850);
    const labels=this.add.text(16,16,'',{fontSize:'18px',color:'#ffffff',backgroundColor:'#101625',padding:{x:10,y:8}}).setScrollFactor(0).setDepth(10);
    const platform=(x:number,y:number,w:number,h:number,color:number,kind='normal')=>{
      this.add.rectangle(x,y,w,h,color);
      const body=this.matter.add.rectangle(x,y,w,h,{isStatic:true,friction:0,collisionFilter:{category:C.solid,mask:0xffff,group:0},label:kind});
      return body;
    };
    platform(450,760,900,64,0x48664a);platform(1100,760,400,64,0x55d9ee,'ice');platform(1400,760,200,64,0x9972cf,'slime');platform(1650,760,300,64,0xeac557,'conveyor');platform(2400,760,1200,64,0x48664a);
    platform(430,650,160,32,0x617a96);platform(630,570,160,32,0x617a96);platform(830,490,160,32,0x617a96);
    platform(1950,696,64,64,0x617a96);platform(2014,664,64,128,0x617a96);platform(2078,632,64,192,0x617a96);
    platform(2320,712,96,32,0xec82b4,'spring');platform(2500,520,64,416,0x617a96);platform(2750,570,64,316,0x617a96);platform(2625,290,320,32,0x617a96);
    const keyboard=this.input.keyboard!;
    const keys=keyboard.addKeys('LEFT,RIGHT,UP,DOWN,A,D,W,S,SHIFT,X,SPACE,Z,R') as Record<string,Phaser.Input.Keyboard.Key>;
    const down=(...names:string[])=>names.some(n=>keys[n]!.isDown);
    const read=()=>({left:down('LEFT','A'),right:down('RIGHT','D'),up:down('UP','W'),down:down('DOWN','S'),run:down('SHIFT','X'),jump:down('SPACE','Z')});
    const player=createMatterPlayer(this,120,650,{input:read,surface:ground=>{
      if(ground?.label==='spring' && player.state.vy>=0) player.setState(springLaunch(player.state));
      return {kind:ground?.label==='ice'?'ice':ground?.label==='slime'?'slime':'normal',conveyor:ground?.label==='conveyor'?128:0};
    }});
    const graphic=this.add.rectangle(120,650,48,60,0xffb36b).setDepth(2);
    this.cameras.main.startFollow(graphic,true,0.15,0.15);
    installFixedMatterClock(this);
    this.events.on('update',()=>{
      if(down('R')||player.body.position.y>1000)player.setState(createControllerState(30,150));
      graphic.setPosition(player.body.position.x,player.body.position.y);
      const s=player.state;
      labels.setText(`60 Hz · tile 64 · scale 4\nvx ${fromFixed(s.vx).toFixed(3)} / vy ${fromFixed(s.vy).toFixed(3)} ref px/frame\nworld vx ${fixedToWorld(s.vx).toFixed(2)} · ${s.mode}\ncoyote ${s.coyote} · buffer ${s.jumpBuffer} · frame ${s.frame}`);
    });
  }
}
export const game = new Phaser.Game({type:Phaser.AUTO,width:1100,height:800,backgroundColor:'#1c2c43',physics:{default:'matter',matter:{gravity:{x:0,y:1},debug:false,runner:{delta:1000/60}}},scene:Lab});
