/** Draped design-line symbols, never physical water or fabricated river width. */
import {sphereBasis} from '../core/spherical.mjs';
import {tileBound,tileDirection,normalize,cross,dot,geographic} from './cube.mjs';
export function buildShapeFirstRiverSymbols(source,tile,{maxVertices=8192}={}){
 const region=source.shapeFirstRegion,triangles=[],stats={kind:'provisional-draped-river-symbols',limited:false,segments:0};
 if(!region||region.showSymbols===false||tile.level<9)return{triangles,stats};
 const radius=region.projection.contract.radiusM,bound=tileBound(tile,radius);if(!region.intersects(bound))return{triangles,stats};
 const center=geographic(bound.center),local=region.local(center.latDeg,center.lonDeg);if(!local)return{triangles,stats};
 const reach=bound.angular*radius*1.002+40,corners=[[0,0],[1,0],[1,1],[0,1]].map(q=>tileDirection(tile,...q)),planes=corners.map((a,i)=>{let n=normalize(cross(a,corners[(i+1)%4]));return dot(n,bound.center)<0?n.map(v=>-v):n;});
 const record=(x,y)=>{const p=region.geographic(x,y),direction=sphereBasis(p).up;return{direction,elevationM:source.sampleWithoutCover(p.latDeg,p.lonDeg).groundElevationM};};
 const clip=polygon=>{for(const plane of planes){const next=[];for(let i=0;i<polygon.length;i++){const a=polygon[i],b=polygon[(i+1)%polygon.length],da=dot(plane,a.direction),db=dot(plane,b.direction),ia=da>=0,ib=db>=0;if(ia)next.push(a);if(ia!==ib){const t=da/(da-db),direction=normalize(a.direction.map((v,k)=>v*(1-t)+b.direction[k]*t)),p=geographic(direction),q=region.local(p.latDeg,p.lonDeg);next.push({direction,elevationM:source.sampleWithoutCover(p.latDeg,p.lonDeg).groundElevationM});}}polygon=next;if(polygon.length<3)return[];}return polygon;};
 for(const river of [...region.rivers,...(region.connector?.rivers??[])])for(let i=1;i<river.points.length;i++){
  const a=river.points[i-1],b=river.points[i];if(Math.max(a.xM,b.xM)<local.xM-reach||Math.min(a.xM,b.xM)>local.xM+reach||Math.max(a.yM,b.yM)<local.yM-reach||Math.min(a.yM,b.yM)>local.yM+reach)continue;
  const dx=b.xM-a.xM,dy=b.yM-a.yM,length=Math.hypot(dx,dy);if(!length)continue;stats.segments++;
  // Fixed metre symbol width is disclosed as a drawing convention, independent
  // of provisional flow. Split below native spacing only to drape interpolation.
  const half=24,n=Math.max(1,Math.ceil(length/25)),ox=-dy/length*half,oy=dx/length*half;
  for(let k=0;k<n;k++){const t=k/n,u=(k+1)/n,ax=a.xM+dx*t,ay=a.yM+dy*t,bx=a.xM+dx*u,by=a.yM+dy*u;
   const polygon=clip([[ax+ox,ay+oy],[ax-ox,ay-oy],[bx-ox,by-oy],[bx+ox,by+oy]].map(([x,y])=>record(x,y)));
   if((triangles.length+polygon.length-2)*3>maxVertices){stats.limited=true;return{triangles,stats};}for(let j=2;j<polygon.length;j++)triangles.push([polygon[0],polygon[j-1],polygon[j]]);
  }
 }
 return{triangles,stats};
}
