import {createSphericalProjection} from './spherical.mjs';
function random(key){let h=2166136261;for(const c of key)h=Math.imul(h^c.charCodeAt(0),16777619);return(h>>>0)/4294967296;}
function mixedRandom(key){let h=2166136261;for(const c of key)h=Math.imul(h^c.charCodeAt(0),16777619);h=Math.imul(h^(h>>>16),0x7feb352d);h=Math.imul(h^(h>>>15),0x846ca68b);return((h^(h>>>16))>>>0)/4294967296;}
function clip(polygon,nx,ny,limit){const out=[];for(let i=0;i<polygon.length;i++){const a=polygon[i],b=polygon[(i+1)%polygon.length],da=a.xM*nx+a.yM*ny-limit,db=b.xM*nx+b.yM*ny-limit;if(da<=1e-8)out.push(a);if((da<0&&db>0)||(da>0&&db<0)){const t=da/(da-db);out.push({xM:a.xM+(b.xM-a.xM)*t,yM:a.yM+(b.yM-a.yM)*t});}}return out;}
/** Fixed, jittered geographic ownership seeds define non-overlapping convex
 * field domains. The streaming cell is not a visible rectangular field edge. */
export function landscapeParcelBoundary(grid,tile,radiusM,seed,pattern=null){
 const projection=createSphericalProjection({centerLatDeg:tile.latDeg,centerLonDeg:tile.lonDeg,radiusM,maxRadiusM:4096});
 const varied=pattern==='surveyed-furlongs@2',rand=varied?mixedRandom:random,jitter=varied?.8:.4;
 const center=t=>({latDeg:t.latDeg+(rand(seed+t.id+'lat')-.5)*t.latSpanDeg*jitter,lonDeg:t.lonDeg+(rand(seed+t.id+'lon')-.5)*t.lonSpanDeg*jitter});
 const c=center(tile),origin=projection.toLocalIfWithin(c.latDeg,c.lonDeg);let polygon=[{xM:-600,yM:-600},{xM:600,yM:-600},{xM:600,yM:600},{xM:-600,yM:600}];const seen=new Set([tile.id]);
 for(let row=Math.max(0,tile.row-3);row<=Math.min(grid.rows-1,tile.row+3);row++){const middle=grid.at(90-(row+.5)*180/grid.rows,tile.lonDeg).col;for(let dc=-4;dc<=4;dc++){const other=grid.tile(row,middle+dc);if(seen.has(other.id))continue;seen.add(other.id);const g=center(other),p=projection.toLocalIfWithin(g.latDeg,g.lonDeg);if(!p)continue;const nx=p.xM-origin.xM,ny=p.yM-origin.yM;polygon=clip(polygon,nx,ny,(p.xM*p.xM+p.yM*p.yM-origin.xM*origin.xM-origin.yM*origin.yM)/2);}}
 return{projection,polygon,center:origin};
}
/** Long strips follow the local contour when a slope exists. These are rain-fed
 * cereal candidates, never rice paddies or irrigated soil invented by colour. */
export function createLandscapeFields(base,config,tile,grid,ecology,settlements,clearance=null,settlementClearance=null){
 const partial=config.fieldSurvey==='local-triangle-clearance@1',varied=config.fieldPattern==='surveyed-furlongs@2',rand=varied?mixedRandom:random;
 const usable=cover=>cover.kind==='arable'||(config.landUseMosaic==='mixed-rainfed-hinterland@1'&&cover.kind==='pasture');
 const {projection,polygon,center}=landscapeParcelBoundary(grid,tile,base.frame.radiusM,config.seed,config.fieldPattern),geo=p=>projection.toGeographic(p.xM,p.yM),surface=p=>{const g=geo(p);return base.sampleSurfaceAt(g.latDeg,g.lonDeg);},at=surface(center),g=geo(center),classification=ecology.sample(g,at,{settlements,settlementClearance});let ownerClass=classification;if(!usable(classification)&&(settlementClearance||partial))for(const p of polygon){const c=ecology.sample(geo(p),surface(p),{settlements,settlementClearance});if(usable(c)){ownerClass=c;break;}}if(!usable(ownerClass)||polygon.length<3)return[];
 const z=at.groundElevationM,dx=(surface({xM:center.xM+10,yM:center.yM}).groundElevationM-z)/10,dy=(surface({xM:center.xM,yM:center.yM+10}).groundElevationM-z)/10,magnitude=Math.hypot(dx,dy),angle=magnitude>.005?Math.atan2(dy,dx):(rand(config.seed+tile.id+'strips')*Math.PI),nx=Math.cos(angle),ny=Math.sin(angle),values=polygon.map(p=>p.xM*nx+p.yM*ny),low=Math.min(...values),high=Math.max(...values),count=ownerClass.kind==='pasture'?1:Math.max(1,Math.ceil((high-low)/(varied?20+14*rand(config.seed+tile.id+'width'):24))),result=[];
 const weights=Array.from({length:count},(_,i)=>varied?.65+.7*rand(config.seed+tile.id+'/strip/'+i):1),total=weights.reduce((a,b)=>a+b,0),cuts=[low];for(const weight of weights)cuts.push(cuts.at(-1)+(high-low)*weight/total);
 for(let i=0;i<count;i++){const gap=ownerClass.kind==='pasture'?0:.7,a=(varied?cuts[i]:low+(high-low)*i/count)+gap,b=(varied?cuts[i+1]:low+(high-low)*(i+1)/count)-gap,shape=clip(clip(polygon,nx,ny,b),-nx,-ny,-a);if(shape.length<3)continue;const centroid={xM:shape.reduce((s,p)=>s+p.xM,0)/shape.length,yM:shape.reduce((s,p)=>s+p.yM,0)/shape.length},triangles=[];let valid=true;
  // Subdivide in world metres; render LOD never changes the parcel's boundary.
  const vertex=p=>{const s=surface(p),g=geo(p),cover=ecology.sample(g,s,{settlements,settlementClearance});if(s.waterDepthM>0||cover.kind!==ownerClass.kind||cover.ownerId!==ownerClass.ownerId)valid=false;return{...p,elevationM:s.groundElevationM+.045};};
  function triangle(a,b,c,depth=0){const lengths=[Math.hypot(a.xM-b.xM,a.yM-b.yM),Math.hypot(b.xM-c.xM,b.yM-c.yM),Math.hypot(c.xM-a.xM,c.yM-a.yM)],long=Math.max(...lengths);if(long<=24||depth>=8){const t=[vertex(a),vertex(b),vertex(c)];if((Math.max(...t.map(p=>p.elevationM))-Math.min(...t.map(p=>p.elevationM)))/Math.max(1,long)>.12)valid=false;triangles.push(t);return;}const k=lengths.indexOf(long),v=[a,b,c],p=v[k],q=v[(k+1)%3],r=v[(k+2)%3],mid={xM:(p.xM+q.xM)/2,yM:(p.yM+q.yM)/2};triangle(p,mid,r,depth+1);triangle(mid,q,r,depth+1);}
  for(let k=0;k<shape.length;k++)triangle(centroid,shape[k],shape[(k+1)%shape.length]);
  let accepted=triangles;
  if(partial){
   const suitable=p=>{const s=surface(p),cover=ecology.sample(geo(p),s,{settlements,settlementClearance});return Number.isFinite(s.groundElevationM)&&s.waterDepthM===0&&cover.kind===ownerClass.kind&&cover.ownerId===ownerClass.ownerId;};
   accepted=triangles.filter(t=>{
    const [a,b,c]=t,dx=b.xM-a.xM,dy=b.yM-a.yM,ex=c.xM-a.xM,ey=c.yM-a.yM,det=dx*ey-dy*ex;
    if(Math.abs(det)<1e-8)return false;
    const dz=b.elevationM-a.elevationM,ez=c.elevationM-a.elevationM,slope=Math.hypot((dz*ey-ez*dy)/det,(dx*ez-ex*dz)/det);
    return slope<=.12&&t.every(suitable)&&suitable({xM:(a.xM+b.xM+c.xM)/3,yM:(a.yM+b.yM+c.yM)/3})&&!settlementClearance?.intersectsGeographicTriangle(t.map(geo))&&!clearance?.intersectsTriangle(t);
   });
   valid=accepted.length>0;
  }else{
   if(settlementClearance&&triangles.some(t=>settlementClearance.intersectsGeographicTriangle(t.map(geo))))valid=false;
   if(clearance&&triangles.some(t=>clearance.intersectsTriangle(t)))valid=false;
  }
  if(valid)result.push({id:`${tile.id}/strip:${i}`,type:ownerClass.kind==='pasture'?'common_grazing_candidate':'rainfed_cereal_strip',ownerId:ownerClass.ownerId,...(partial?{sourceBoundary:shape,fieldSurvey:config.fieldSurvey,rejectedTriangles:triangles.length-accepted.length}:{boundary:shape}),triangles:accepted,color:ownerClass.kind==='pasture'?[.39,.46,.23]:(varied?[[.48,.48,.23],[.49,.41,.26],[.41,.43,.22]][Math.floor(rand(config.seed+tile.id+'/crop/'+i)*3)]:i%3===0?[.48,.48,.23]:i%3===1?[.49,.41,.26]:[.41,.43,.22]),provenance:'Stable land partition and local water/grade survey; crop rotation and grain productivity are scenario assumptions'});
 }
 return result;
}
