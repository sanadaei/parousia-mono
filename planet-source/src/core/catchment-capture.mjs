import {finiteNumber,positiveNumber,integerDimension} from './contract-validation.mjs';
/** An explicitly authored ideal collector, not an inferred ditch or terrain
 * edit. Include every cell intersected by the polyline, including grid edges. */
export function collectorCells(grid,points,mouth){
 integerDimension(grid.columns,'columns');integerDimension(grid.rows,'rows');positiveNumber(grid.cellSizeM,'cell size');finiteNumber(grid.originXM,'origin X');finiteNumber(grid.originYM,'origin Y');
 if(grid.columns*grid.rows>65536)throw new RangeError('Collector grid exceeds cell budget');
 finiteNumber(mouth?.xM,'mouth X');finiteNumber(mouth?.yM,'mouth Y');
 if(!Array.isArray(points)||points.length<2||points.length>64)throw new RangeError('Collector requires 2..64 points');
 const {columns,rows,cellSizeM:step,originXM:ox,originYM:oy}=grid,polyline=points.map(p=>({xM:finiteNumber(p?.xM,'collector X'),yM:finiteNumber(p?.yM,'collector Y')})),cells=new Set();
 const xmax=ox+columns*step,ymax=oy+rows*step;let lengthM=0,mouthDistance=Infinity,checks=0;
 finiteNumber(xmax,'collector grid right');finiteNumber(ymax,'collector grid top');
 const outside=polyline.some(p=>p.xM<ox||p.yM<oy||p.xM>xmax||p.yM>ymax);
 const intersects=(a,b,left,bottom,right,top)=>{
  let lo=0,hi=1;
  for(const [start,delta,min,max] of [[a.xM,b.xM-a.xM,left,right],[a.yM,b.yM-a.yM,bottom,top]]){
   if(delta===0){if(start<min||start>max)return false;continue;}
   let u=(min-start)/delta,v=(max-start)/delta;if(u>v)[u,v]=[v,u];lo=Math.max(lo,u);hi=Math.min(hi,v);if(lo>hi)return false;
  }return true;
 };
 for(let k=1;k<polyline.length;k++){
  const a=polyline[k-1],b=polyline[k],dx=b.xM-a.xM,dy=b.yM-a.yM,length=positiveNumber(Math.hypot(dx,dy),'collector segment length');lengthM+=length;
  const t=Math.max(0,Math.min(1,((mouth.xM-a.xM)*dx+(mouth.yM-a.yM)*dy)/(length*length)));
  mouthDistance=Math.min(mouthDistance,Math.hypot(mouth.xM-a.xM-t*dx,mouth.yM-a.yM-t*dy));
  const x0=Math.max(0,Math.ceil((Math.min(a.xM,b.xM)-ox)/step)-1),x1=Math.min(columns-1,Math.floor((Math.max(a.xM,b.xM)-ox)/step)),
   y0=Math.max(0,Math.ceil((Math.min(a.yM,b.yM)-oy)/step)-1),y1=Math.min(rows-1,Math.floor((Math.max(a.yM,b.yM)-oy)/step));
  if((checks+=Math.max(0,x1-x0+1)*Math.max(0,y1-y0+1))>2000000)throw new RangeError('Collector intersection budget exceeded');
  for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++)if(intersects(a,b,ox+x*step,oy+y*step,ox+(x+1)*step,oy+(y+1)*step))cells.add(y*columns+x);
 }
 if(!Number.isFinite(lengthM)||mouthDistance>1e-6)throw new RangeError('Collector must pass through its pipe mouth');
 return{cellIndices:[...cells].sort((a,b)=>a-b),polyline,lengthM,outside,checks};
}
