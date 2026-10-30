"""Curate a small, explicit input set from downloaded, license-verified packs."""
from pathlib import Path
import json,shutil,xml.etree.ElementTree as ET,re
ET.register_namespace('', 'http://www.w3.org/2000/svg')
ET.register_namespace('xlink', 'http://www.w3.org/1999/xlink')
root=Path(__file__).resolve().parents[1];src=root/'sources';dl=root/'_downloads'
recipe={'art':[],'characters':{},'enemies':{},'audio':{},'themes':{}}
used={}
def select(pack,name):
 candidates=list((dl/pack).rglob(name+'.svg'))
 if not candidates:candidates=[p for p in (dl/pack).rglob(name+'.png') if 'Double' not in str(p) and 'double' not in str(p)]
 if not candidates:raise FileNotFoundError((pack,name))
 p=sorted(candidates,key=lambda p:len(str(p)))[0];rel=Path(pack)/p.relative_to(dl/pack);dest=src/rel;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(p,dest)
 used[str(rel)]=str(p.relative_to(dl));return str(rel)
def add(id,category,name=None,pack='new-platformer-pack',note=None,width=64,height=64):
 s='custom/'+id+'.svg' if pack=='realmforge-supplements' else select(pack,name or id)
 a=dict(id=id,category=category,source=s,pack=pack,width=width,height=height)
 if note:a['note']=note
 recipe['art'].append(a);return a
# Names below are matched exactly against the upstream archive.
# Shared native art.
for id,cat,name in [
 ('spikes','hazards','spikes'),('lava','hazards','lava_top'),('saw','hazards','saw'),('falling_block','hazards','block_idle'),
 ('crate','dynamic','block_planks'),('spring','dynamic','spring'),('spring_extended','dynamic','spring_out'),('conveyor_belt','dynamic','conveyor'),
 ('chain_link','dynamic','chain'),('pendulum_ball','dynamic','weight'),('coin','items','coin_gold'),('coin_side','items','coin_gold_side'),('key','items','key_yellow'),
 ('start','items','sign_right'),('checkpoint','items','flag_blue_a'),('checkpoint_active','items','flag_blue_b'),('goal','items','flag_green_a'),('goal_wave','items','flag_green_b'),('switch','items','switch_blue'),('switch_on','items','switch_blue_pressed'),('switch_block','items','block_blue')]:add(id,cat,name)
# Supplemental mechanical graphics and pickups; all original CC0 SVGs.
for id,cat in [('ice','tiles/shared'),('slime','tiles/shared'),('seesaw','dynamic'),('chain_bridge','dynamic'),('moving_platform','dynamic'),('elevator','dynamic'),('rotating_platform','dynamic'),('cannon','enemies'),('powerup_double_jump','items'),('powerup_dash','items')]:add(id,cat,pack='realmforge-supplements',note='Original RealmForge CC0 supplement.')
add('big_coin','items','coin_gold',note='Native coin enlarged to 96 px; gameplay value comes from the entity.',width=96,height=96)
# Flatten SVG viewport containers for consistent renderer support.
def group(source,x=0,y=0,w=None,h=None,prefix=''):
 text=(src/source).read_text()
 for id in sorted(re.findall(r'id="([^"]+)"',text),key=len,reverse=True):
  text=text.replace('id="'+id+'"','id="'+prefix+id+'"').replace('#'+id,'#'+prefix+id)
 node=ET.fromstring(text);nw=float(node.attrib.get('width','64'));nh=float(node.attrib.get('height','64'))
 node.tag='{http://www.w3.org/2000/svg}g'
 for attr in ['width','height','viewBox','x','y']:node.attrib.pop(attr,None)
 node.set('transform',f'translate({x} {y}) scale({(w or nw)/nw} {(h or nh)/nh})')
 return ET.tostring(node,encoding='unicode')
# Composite full-height door from the exact native halves, optionally with a key lock.
def composite(id,parts,w=64,h=128):
 body=''
 for name,x,y,pw,ph in parts:
  source=select('new-platformer-pack',name);body+=group(source,x,y,pw,ph,prefix=name+'_')
 dest=src/'custom'/f'{id}.svg';dest.write_text(f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}">{body}</svg>')
 a=add(id,'items',pack='realmforge-supplements',note='Composition of Kenney New Platformer Pack CC0 sprites.',width=w,height=h);a['pack']='new-platformer-pack (composition)'
composite('door',[('door_closed_top',0,0,64,64),('door_closed',0,64,64,64)])
composite('door_open',[('door_open_top',0,0,64,64),('door_open',0,64,64,64)])
composite('locked_door',[('door_closed_top',0,0,64,64),('door_closed',0,64,64,64),('lock_yellow',17,63,30,30)])
# Native terrain. Every theme has exactly the same semantic index order.
for theme,native in [('grass','grass'),('desert','sand'),('snow','snow'),('castle','stone')]:
 names=[('ground',f'terrain_{native}_block_top'),('fill',f'terrain_{native}_block_center'),('left',f'terrain_{native}_block_top_left'),('right',f'terrain_{native}_block_top_right'),('bottom',f'terrain_{native}_block_bottom'),('brick','bricks_grey' if theme in ['snow','castle'] else 'bricks_brown'),('question','block_coin'),('one_way',f'terrain_{native}_horizontal_middle'),('semi_solid',f'terrain_{native}_cloud_middle')]
 ids=[]
 for id,n in names:
  full=f'{theme}_{id}';add(full,'tiles/'+theme,n);ids.append(full)
 ids+=['ice','slime'];recipe['themes'][theme]=ids
# Existing backgrounds for open air themes, original silhouettes for snow/castle.
add('background_grass','backgrounds','background_color_hills',width=256,height=256)
add('background_desert','backgrounds','background_color_desert',width=256,height=256)
for theme,sky,far,near in [('snow','#c8e7f2','#acc5db','#e5f5f7'),('castle','#252a46','#39405b','#505773')]:
 mountains='<path d="M0 310L130 140L240 280L390 100L540 310L700 150L840 300L1024 120V512H0Z" fill="'+far+'"/>'
 if theme=='snow':
  front='<path d="M0 380Q120 300 256 380T512 380T768 380T1024 380V512H0Z" fill="'+near+'"/><path d="M310 200L390 100L470 214L390 180L355 207Z" fill="#f5fdff"/>'
 else:
  front=''.join(f'<path d="M{x} 512V250H{x+20}V228H{x+40}V250H{x+60}V228H{x+80}V250H{x+100}V512Z" fill="{near}"/><rect x="{x+42}" y="290" width="16" height="28" rx="8" fill="{sky}"/>' for x in [70,300,560,810])
 (src/'custom'/f'background_{theme}.svg').write_text(f'<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="512"><rect width="1024" height="512" fill="{sky}"/>{mountains}{front}</svg>')
 add('background_'+theme,'backgrounds',pack='realmforge-supplements',width=1024,height=512,note='Original CC0 theme silhouette; repeat horizontally.')
# Four characters with native poses and explicit derived fall/skid poses.
for char in ['green','pink','purple','beige']:
 native={a:select('new-platformer-pack',f'character_{char}_{a}') for a in ['idle','walk_a','walk_b','jump','duck']}
 def pose(anim,base,transform,dust=''):
  body=group(native[base])
  rel=f'custom/{char}_{anim}.svg';(src/rel).write_text(f'<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><g transform="{transform}">{body}</g>{dust}</svg>');return rel
 fall=pose('fall','jump','translate(0 5) translate(64 90) rotate(6) translate(-64 -90)')
 skid=pose('skid','duck','translate(64 105) rotate(-12) translate(-64 -105)','<path d="M9 117H22M3 109H14" stroke="#d4b48d" stroke-width="5" stroke-linecap="round"/>')
 recipe['characters'][char]={
  'idle':dict(sources=[native['idle']],frameRate=1),
  'walk':dict(sources=[native['walk_a'],native['walk_b']],frameRate=8),
  'run':dict(sources=[native['walk_a'],native['walk_b']],frameRate=14,note='Native walk cycle reused at higher playback speed.'),
  'jump':dict(sources=[native['jump']],frameRate=1),
  'fall':dict(sources=[fall],frameRate=1,note='Derived native jump pose with downward offset and slight tilt; CC0.'),
  'skid':dict(sources=[skid],frameRate=1,note='Derived native crouch pose with braking tilt and original dust strokes; CC0.'),
  'crouch':dict(sources=[native['duck']],frameRate=1)}
# Five explicit enemy atlases.
for id,names in {'walker':['slime_normal_walk_a','slime_normal_walk_b','slime_normal_flat'],'shell':['snail_shell','snail_walk_a','snail_walk_b'],'flyer':['fly_a','fly_b'],'jumper':['frog_idle','frog_jump'],'cannon':[]}.items():
 if names:
  recipe['enemies'][id]=[select('new-platformer-pack',n) for n in names]
  add(id,'enemies',names[0])
 else:recipe['enemies'][id]=['custom/cannon.svg']
# Selected scalable UI controls.
for id,name in {'button_primary':'button_rectangle_depth_flat','button_pressed':'button_rectangle_flat','button_square':'button_square_depth_flat','checkmark':'icon_checkmark','close':'icon_cross','arrow_left':'arrow_basic_w','arrow_right':'arrow_basic_e','star':'star','checkbox':'check_square_color_checkmark'}.items():
 p=dl/'ui-pack'/'Vector'/'Green'/(name+'.svg');rel=Path('ui-pack/Vector/Green')/p.name;dest=src/rel;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(p,dest);used[str(rel)]=str(p.relative_to(dl));recipe['art'].append(dict(id=id,category='ui',source=str(rel),pack='ui-pack',width=192 if 'button' in id and 'square' not in id else 64,height=64))
for id in ['hud_heart','hud_heart_empty','hud_coin','hud_key_yellow']:add(id,'ui',id)
# Original editor tool icons plus thumbnails for each canonical palette element.
for p in sorted((src/'custom').glob('tool_*.svg')):add(p.stem,'icons/editor',pack='realmforge-supplements')
canonical=['ground','brick','question_block','ice','slime','one_way','semi_solid','spikes','lava','saw','falling_block','crate','seesaw','pendulum_ball','chain_bridge','spring','conveyor_belt','moving_platform','elevator','rotating_platform','walker','shell','flyer','jumper','cannon','coin','big_coin','key','powerup_double_jump','powerup_dash','start','checkpoint','goal','door','locked_door','switch','switch_block']
renames={'ground':'grass_ground','brick':'grass_brick','question_block':'grass_question','one_way':'grass_one_way','semi_solid':'grass_semi_solid'}
byid={a['id']:a for a in recipe['art']}
for id in canonical:
 a=byid[renames.get(id,id)].copy();a.update(id='palette_'+id,category='icons/editor',width=64,height=64);recipe['art'].append(a)
# Audio: keep Ogg originals; no runtime transcoding or external tools needed.
for id,name in {'jump':'sfx_jump','coin':'sfx_coin','stomp':'sfx_bump','spring':'sfx_jump-high','death':'sfx_hurt'}.items():
 p=dl/'new-platformer-pack'/'Sounds'/(name+'.ogg');rel=Path('new-platformer-pack/Sounds')/p.name;dest=src/rel;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(p,dest);used[str(rel)]=str(p.relative_to(dl));recipe['audio'][id]=dict(source=str(rel),category='sfx',pack='new-platformer-pack')
for id,pack,sub in [('goal','music-jingles','Audio/Pizzicato jingles/jingles_PIZZI01.ogg'),('ui_click','interface-sounds','Audio/click_001.ogg')]:
 p=dl/pack/sub;assert p.exists(),p;rel=Path(pack)/sub;dest=src/rel;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(p,dest);used[str(rel)]=str(p.relative_to(dl));recipe['audio'][id]=dict(source=str(rel),category='sfx',pack=pack)
for id,name in [('grass_01','music-overworld'),('snow_01','music-bass'),('castle_01','music-sprinter')]:
 p=dl/(name+'.ogg');rel=Path('music')/p.name;dest=src/rel;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(p,dest);used[str(rel)]=str(p.relative_to(dl));recipe['audio'][id]=dict(source=str(rel),category='music',pack=name,loop=True)
# Preserve every downloaded pack's license, including packs evaluated but not shipped.
for pack in ['new-platformer-pack','ui-pack','interface-sounds','music-jingles','game-icons','pixel-platformer','pixel-platformer-blocks','platformer-art-requests']:
 p=next(p for p in (dl/pack).iterdir() if p.name.lower()=='license.txt');shutil.copyfile(p,root/'licenses'/(pack+'.txt'))
(src/'recipe.json').write_text(json.dumps(recipe,indent=2)+'\n');(src/'used-files.json').write_text(json.dumps(used,indent=2)+'\n')
print('Curated',len(recipe['art']),'images;',len(used),'upstream input files;',len(recipe['characters']),'characters.')

# Drop unused original supplements after the final recipe is assembled.
refs={a["source"] for a in recipe["art"]}
refs.update(s for anims in recipe["characters"].values() for a in anims.values() for s in a["sources"])
refs.update(s for sources in recipe["enemies"].values() for s in sources)
for p in (src/"custom").glob("*.svg"):
 if "custom/"+p.name not in refs:p.unlink()
