import {createCanvas,loadImage} from '@napi-rs/canvas';
import {PNG} from 'pngjs';
import fs from 'node:fs/promises';
export interface Layer {input:Buffer;left:number;top:number}
export function blank(width:number,height:number,color:[number,number,number,number]=[0,0,0,0]):PNG{
 const png=new PNG({width,height});for(let i=0;i<png.data.length;i+=4){png.data[i]=color[0];png.data[i+1]=color[1];png.data[i+2]=color[2];png.data[i+3]=color[3];}return png;
}
export function dimensions(data:Buffer){const p=PNG.sync.read(data);return {width:p.width,height:p.height};}
export function encode(p:PNG):Buffer{return PNG.sync.write(p,{colorType:6,filterType:4});}
export function compose(width:number,height:number,layers:Layer[],color?:[number,number,number,number]):Buffer{
 const dst=blank(width,height,color);
 for(const layer of layers){
  const src=PNG.sync.read(layer.input);
  for(let y=0;y<src.height;y++)for(let x=0;x<src.width;x++){
   const dx=layer.left+x,dy=layer.top+y;if(dx<0||dy<0||dx>=width||dy>=height)continue;
   const s=(y*src.width+x)*4,d=(dy*width+dx)*4,a=src.data[s+3]!/255,b=dst.data[d+3]!/255,alpha=a+b*(1-a);
   for(let c=0;c<3;c++)dst.data[d+c]=alpha===0?0:Math.round((src.data[s+c]!*a+dst.data[d+c]!*b*(1-a))/alpha);
   dst.data[d+3]=Math.round(alpha*255);
  }
 }
 return encode(dst);
}
export async function svg(data:string|Buffer,width?:number):Promise<Buffer>{
 const img=await loadImage(typeof data==='string'?Buffer.from(data):data);
 const w=width??img.width,h=Math.max(1,Math.round(img.height*w/img.width));
 const canvas=createCanvas(w,h);canvas.getContext('2d').drawImage(img,0,0,w,h);return canvas.toBuffer('image/png');
}
export async function raster(file:string,width:number,height:number):Promise<Buffer>{
 const img=await loadImage(await fs.readFile(file)),scale=Math.min(width/img.width,height/img.height),w=img.width*scale,h=img.height*scale;
 const canvas=createCanvas(width,height);canvas.getContext('2d').drawImage(img,(width-w)/2,(height-h)/2,w,h);return canvas.toBuffer('image/png');
}
export function thumbnail(data:Buffer,width:number,height:number):Buffer{
 const src=PNG.sync.read(data),scale=Math.min(width/src.width,height/src.height),w=Math.max(1,Math.round(src.width*scale)),h=Math.max(1,Math.round(src.height*scale)),dst=blank(w,h);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const s=(Math.min(src.height-1,Math.floor(y/scale))*src.width+Math.min(src.width-1,Math.floor(x/scale)))*4,d=(y*w+x)*4;
  for(let c=0;c<4;c++)dst.data[d+c]=src.data[s+c]!;
 }
 return compose(width,height,[{input:encode(dst),left:Math.floor((width-w)/2),top:Math.floor((height-h)/2)}]);
}
export function visiblePixels(data:Buffer,rect?:{x:number;y:number;w:number;h:number}):number{
 const p=PNG.sync.read(data),r=rect??{x:0,y:0,w:p.width,h:p.height};let count=0;
 for(let y=r.y;y<r.y+r.h;y++)for(let x=r.x;x<r.x+r.w;x++)if(p.data[(y*p.width+x)*4+3]!>0)count++;
 return count;
}
