/** Candidate service parcels follow the saved street geometry. This module
 * supplies land, not missing resources, institutions or production capacity. */
export function serviceFrontageCenters(roads){
 const out=[],seen=new Set();for(const road of roads)for(let i=1;i<road.samples.length;i++){const a=road.samples[i-1],b=road.samples[i],dx=b.xM-a.xM,dy=b.yM-a.yM,d=Math.hypot(dx,dy);if(!d)continue;for(let at=Math.ceil(a.distanceM/30)*30;at<=b.distanceM;at+=30){const t=(at-a.distanceM)/(b.distanceM-a.distanceM);for(const side of [-1,1]){const x=a.xM+t*dx-side*dy/d*24,y=a.yM+t*dy+side*dx/d*24,key=`${Math.round(x)},${Math.round(y)}`;if(Math.abs(x)>175||Math.abs(y)>205||seen.has(key))continue;seen.add(key);out.push([x,y]);}}}
 return out.sort((a,b)=>Math.hypot(...a)-Math.hypot(...b)||a[0]-b[0]||a[1]-b[1]).slice(0,96);
}
export function nearestStreetPoint(x,y,roads){let best=null;for(const r of roads)for(let i=1;i<r.samples.length;i++){const a=r.samples[i-1],b=r.samples[i],dx=b.xM-a.xM,dy=b.yM-a.yM,t=Math.max(0,Math.min(1,((x-a.xM)*dx+(y-a.yM)*dy)/(dx*dx+dy*dy||1))),p={xM:a.xM+dx*t,yM:a.yM+dy*t,distanceM:Math.hypot(x-a.xM-dx*t,y-a.yM-dy*t),roadId:r.roadId,halfWidthM:r.halfWidthM};if(!best||p.distanceM<best.distanceM)best=p;}return best;}
export function servicePlotClear(x,y,{roads,ground,water,occupied,strictSurvey=false}){
 let min=Infinity,max=-Infinity;for(let dy=-9;dy<=9;dy+=3)for(let dx=-9;dx<=9;dx+=3){const xx=x+dx,yy=y+dy,z=ground(xx,yy),street=nearestStreetPoint(xx,yy,roads);if(!Number.isFinite(z)||(strictSurvey?water(xx,yy).waterDepthM!==0:water(xx,yy).waterDepthM>0)||occupied(xx,yy)||street&&street.distanceM<street.halfWidthM+1)return false;min=Math.min(min,z);max=Math.max(max,z);}return max-min<=1.2;
}

/** Built footprint and work yard share one reserved parcel. Dimensions are
 * game-scale scenario choices; resource prerequisites remain in the planner. */
export function servicePlotGeometry(placement,roads,ground){
 const {xM:x,yM:y,id,type}=placement,near=nearestStreetPoint(x,y,roads);if(!near)return null;
 const dx=near.xM-x,dy=near.yM-y,nx=Math.abs(dx)>Math.abs(dy)?Math.sign(dx):0,ny=nx?0:Math.sign(dy)||1,at=(u,v)=>({xM:x+ny*u+nx*v,yM:y-nx*u+ny*v}),box=(u0,u1,v0,v1)=>{const points=[at(u0,v0),at(u1,v0),at(u1,v1),at(u0,v1)];return{minXM:Math.min(...points.map(p=>p.xM)),maxXM:Math.max(...points.map(p=>p.xM)),minYM:Math.min(...points.map(p=>p.yM)),maxYM:Math.max(...points.map(p=>p.yM))};},dimensions={hall:[14,8,5],granary:[12,8,4.8],carpenter:[14,7,3.5],handmill:[8,6,3.2],warehouse:[14,8,4.5]},[length,depth,height]=dimensions[type]??[12,8,4],bounds=box(-length/2,length/2,-8,-8+depth),z=Math.max(...[[bounds.minXM,bounds.minYM],[bounds.maxXM,bounds.minYM],[bounds.maxXM,bounds.maxYM],[bounds.minXM,bounds.maxYM]].map(([a,b])=>ground(a,b)))+.1,steps=3,points=[];
 for(let v=0;v<=steps;v++)for(let u=0;u<=steps;u++){const p=at(-9+18*u/steps,9*v/steps);points.push({...p,elevationM:ground(p.xM,p.yM)+.04});}
 const start=at(0,9),end=nearestStreetPoint(start.xM,start.yM,roads),distance=Math.hypot(end.xM-start.xM,end.yM-start.yM),count=Math.max(1,Math.ceil(distance/2)),samples=Array.from({length:count+1},(_,i)=>{const t=i/count,xM=start.xM+(end.xM-start.xM)*t,yM=start.yM+(end.yM-start.yM)*t;return{xM,yM,distanceM:t*distance,roadElevationM:ground(xM,yM)+.04,structureKind:'fill',segmentKind:'fill'};});
 return{building:{id,facilityType:type,sector:placement.sector,bounds,baseElevationM:z,heightM:height,roofHeightM:type==='hall'?3:2,wallColor:[.64,.60,.46],roofColor:[.37,.29,.23]},yard:{id:id+'/yard',type:'service_workyard',facilityId:id,steps,points,color:[.49,.43,.3]},reservation:box(-9,9,-9,9),accessRoad:{roadId:id+'/access',halfWidthM:1,surfaceMaterial:'compacted-earth',samples}};
}

/** Bounded one-metre survey across the whole access width for new urban parcels. */
export function serviceAccessClear(road,{ground,water,occupied=()=>false}){
 for(let i=1;i<road.samples.length;i++){
  const a=road.samples[i-1],b=road.samples[i],dx=b.xM-a.xM,dy=b.yM-a.yM,d=Math.hypot(dx,dy);if(d<1e-9)continue;
  const count=Math.max(1,Math.ceil(d));let prior=null;
  for(let k=0;k<=count;k++){
   const x=a.xM+dx*k/count,y=a.yM+dy*k/count,z=ground(x,y);
   if(!Number.isFinite(z)||prior!=null&&Math.abs(z-prior)/(d/count)>.18)return false;prior=z;
   for(const side of [-road.halfWidthM,0,road.halfWidthM]){
    const xx=x-dy/d*side,yy=y+dx/d*side,zz=ground(xx,yy);
    if(!Number.isFinite(zz)||Math.abs(zz-z)>.25||water(xx,yy).waterDepthM!==0||occupied(xx,yy))return false;
   }
  }
 }
 return road.samples.length>=2;
}
