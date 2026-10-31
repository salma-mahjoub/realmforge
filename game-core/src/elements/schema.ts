export const ELEMENT_TYPES = ['ground','brick','question_block','ice','slime','one_way','semi_solid','spikes','lava','saw','falling_block','crate','seesaw','pendulum_ball','chain_bridge','spring','conveyor_belt','moving_platform','elevator','rotating_platform','walker','shell','flyer','jumper','cannon','coin','big_coin','key','powerup_double_jump','powerup_dash','start','checkpoint','goal','door','pipe','locked_door','switch','switch_block','mushroom'] as const;
export type ElementType = typeof ELEMENT_TYPES[number];
export type EntityId = string | number;
export interface Point { x:number; y:number }
export interface ElementDef { id:EntityId; type:ElementType; x:number; y:number; props?:Record<string,unknown> }
export interface PropDescriptor { name:string; kind:'number'|'boolean'|'string'|'link'|'path'; min?:number; max?:number; default:unknown }
const number=(name:string,min:number,max:number,value:number):PropDescriptor=>({name,kind:'number',min,max,default:value});
const common:PropDescriptor[]=[number('width',0.1,300,1),number('height',0.1,30,1),{name:'group',kind:'string',default:''},{name:'enabled',kind:'boolean',default:true}];
export const ELEMENT_PROPS = Object.fromEntries(ELEMENT_TYPES.map(type=>[type,[...common,
  ...(['saw','conveyor_belt','moving_platform','elevator','rotating_platform','walker','shell','flyer','jumper','cannon','mushroom'].includes(type)?[number('speed',0,32,1),number('direction',-1,1,1)]:[]),
  ...(['moving_platform','elevator'].includes(type)?[{name:'path',kind:'path' as const,default:[]},number('distance',0,100,4)]:[]),
  ...(['falling_block','jumper','cannon','switch'].includes(type)?[number('timer',1,3600,type==='falling_block'?30:120)]:[]),
  ...(['door','pipe','locked_door','switch'].includes(type)?[{name:'link',kind:'link' as const,default:''}]:[]),
  ...(['seesaw','pendulum_ball','chain_bridge'].includes(type)?[number('length',1,32,4)]:[]),
  ...(type==='spring'?[number('launch',1,20,7)]:[]),
  ...(type==='flyer'?[number('amplitude',0,20,2),number('period',1,3600,180)]:[]),
  ...(type==='question_block'?[{name:'reward',kind:'string' as const,default:'coin'}]:[]),
]])) as Record<ElementType,PropDescriptor[]>;
export function normalizeProps(type:ElementType,props:Record<string,unknown>={}):Record<string,unknown> {
  const result:Record<string,unknown>={};
  for(const p of ELEMENT_PROPS[type]) {
    const v=props[p.name]??structuredClone(p.default);
    if(p.kind==='number' && (typeof v!=='number'||!Number.isFinite(v)||v<p.min!||v>p.max!)) throw new RangeError(`${type}.${p.name} out of range`);
    if(p.kind==='boolean' && typeof v!=='boolean') throw new TypeError(p.name);
    if(p.kind==='string' && typeof v!=='string') throw new TypeError(p.name);
    if(p.kind==='link' && typeof v!=='string' && typeof v!=='number') throw new TypeError(p.name);
    if(p.kind==='path' && (!Array.isArray(v)||v.some(p=>!p||typeof p.x!=='number'||typeof p.y!=='number'||!Number.isFinite(p.x)||!Number.isFinite(p.y)))) throw new TypeError('path must contain finite tile coordinates');
    result[p.name]=structuredClone(v);
  }
  return result;
}
