/** Physical design-water strips. Every vertex must be wet in the canonical
 * post-shape channel query; no symbol width or display lift substitutes for it. */
import {sphereBasis} from '../core/spherical.mjs';
import {tileBound,tileDirection,normalize,cross,dot,geographic} from './cube.mjs';
export function buildShapeFirstWaterStrips(source,tile,{maxVertices=8192}={}){
 const region=source.shapeFirstRegion,triangles=[],stats={kind:'designed-channel-water',segments:0,limited:false};
 if(!region||tile.level<12)return{triangles,stats};const radius=region.projection.contract.radiusM,bound=tileBound(tile,radius);if(!region.intersects(bound))return{triangles,stats};
 const p=geographic(bound.center),local=region.local(p.latDeg,p.lonDeg);if(!local)return{triangles,stats};const reach=bound.angular*radius*1.002+50;
 const corners=[[0,0],[1,0],[1,1],[0,1]].map(q=>tileDirection(tile,...q)),planes=corners.map((a,i)=>{let n=normalize(cross(a,corners[(i+1)%4]));return dot(n,bound.center)<0?n.map(v=>-v):n;});
 const at=(x,y)=>{const p=region.geographic(x,y),sample=source.sampleWithoutCover(p.latDeg,p.lonDeg);return sample.waterDepthM>0?{direction:sphereBasis(p).up,waterLevelElevationM:sample.waterLevelElevationM}:null;};
 const clip=polygon=>{for(const plane of planes){const next=[];for(let i=0;i<polygon.length;i++){const a=polygon[i],b=polygon[(i+1)%polygon.length],da=dot(plane,a.direction),db=dot(plane,b.direction),ia=da>=0,ib=db>=0;if(ia)next.push(a);if(ia!==ib){const t=da/(da-db),direction=normalize(a.direction.map((v,k)=>v*(1-t)+b.direction[k]*t)),p=geographic(direction),q=region.local(p.latDeg,p.lonDeg),wet=at(q.xM,q.yM);if(!wet)return[];next.push(wet);}}polygon=next;if(polygon.length<3)return[];}return polygon;};
 for(const river of [...region.channels.rivers,...(region.connector?.rivers??[])])for(let i=1;i<river.points.length;i++){
  const a=river.points[i-1],b=river.points[i];if(Math.max(a.xM,b.xM)<local.xM-reach||Math.min(a.xM,b.xM)>local.xM+reach||Math.max(a.yM,b.yM)<local.yM-reach||Math.min(a.yM,b.yM)>local.yM+reach)continue;
  const dx=b.xM-a.xM,dy=b.yM-a.yM,length=Math.hypot(dx,dy);if(!length)continue;stats.segments++;const steps=Math.max(1,Math.ceil(length/5));let previous=null;
  for(let k=0;k<=steps;k++){const t=k/steps,width=(river.widthM[i-1]*(1-t)+river.widthM[i]*t)*.45,x=a.xM+dx*t,y=a.yM+dy*t,ox=-dy/length*width,oy=dx/length*width,left=at(x+ox,y+oy),right=at(x-ox,y-oy),row=left&&right?[left,right]:null;
   if(row&&previous){const polygon=clip([previous[0],previous[1],row[1],row[0]]);if((triangles.length+polygon.length-2)*3>maxVertices){stats.limited=true;return{triangles,stats};}for(let j=2;j<polygon.length;j++)triangles.push([polygon[0],polygon[j-1],polygon[j]]);}previous=row;
  }
 }
 return{triangles,stats};
}
