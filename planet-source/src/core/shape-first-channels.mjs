/** A deterministic post-shape channel design, not a hydraulic solver.
 * Geometry is never moved. Supply controls bounded design dimensions only.
 * A single source-local spatial index serves all tiles and zoom levels. */
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const lerp=(a,b,t)=>a+(b-a)*t;
const smooth=t=>t*t*(3-2*t);
const check=(v,m)=>{if(!v)throw new TypeError(`Shape-first channels: ${m}`);};
function project(x,y,a,b){const dx=b.xM-a.xM,dy=b.yM-a.yM,l=dx*dx+dy*dy,t=l?clamp(((x-a.xM)*dx+(y-a.yM)*dy)/l,0,1):0;return {t,d:Math.hypot(x-a.xM-t*dx,y-a.yM-t*dy)};}
function raster(c,x,y){const g=c.grid,fx=clamp(x/g.cellSizeM,0,g.columns-1),fy=clamp(y/g.cellSizeYM,0,g.rows-1),ix=Math.min(g.columns-2,Math.floor(fx)),iy=Math.min(g.rows-2,Math.floor(fy)),tx=fx-ix,ty=fy-iy,k=iy*g.columns+ix,h=c.elevation;return lerp(lerp(h[k],h[k+1],tx),lerp(h[k+g.columns],h[k+g.columns+1],tx),ty);}
export function createShapeFirstCandidateChannels(candidate,water,options={}){
 const g=candidate?.grid;
 check(g?.row0==='north'&&g.yDirection==='south'&&Number.isInteger(g.columns)&&g.columns>=2&&Number.isInteger(g.rows)&&g.rows>=2&&[g.cellSizeM,g.cellSizeYM].every(v=>Number.isFinite(v)&&v>0),'invalid grid');
 check(candidate.elevation?.length===g.columns*g.rows&&candidate.elevation.every(Number.isFinite),'invalid elevations');
 check(Array.isArray(candidate.rivers)&&candidate.rivers.length>0&&water?.rivers?.length===candidate.rivers.length,'river metadata mismatch');
 const minWidthM=options.minWidthM??3,maxWidthM=options.maxWidthM??42,minDepthM=options.minDepthM??.3,maxDepthM=options.maxDepthM??3;
 check([minWidthM,maxWidthM,minDepthM,maxDepthM].every(v=>Number.isFinite(v)&&v>0)&&minWidthM<=maxWidthM&&maxWidthM<=100&&minDepthM<=maxDepthM&&maxDepthM<=10,'invalid dimension bounds');
 const metadata=options.nativeTerrain?.rivers??candidate.riverDesign?.rivers??[];
 const byId=new Map(),rivers=candidate.rivers.map((points,i)=>{
  const a=water.rivers[i];check(typeof a.id==='string'&&!byId.has(a.id),'duplicate river ID');
  check(points.length>=2&&points.every(p=>Number.isFinite(p.xM)&&Number.isFinite(p.yM)),'invalid geometry');
  check(a.segmentFlowM3PerSecond?.length===points.length-1&&a.segmentFlowM3PerSecond.every(q=>Number.isFinite(q)&&q>=0),'invalid supply');
  const meta=metadata.find(m=>m.id===a.id),raw=meta?.designBedElevationM??points.map(p=>raster(candidate,p.xM,p.yM));
  check(raw.length===points.length&&raw.every(Number.isFinite),'invalid designed beds');
  const r={id:a.id,parent:a.parent,points:points.map(p=>({...p})),waterLevelM:[],widthM:[],depthM:[],bedElevationM:[],raw:[...raw],flow:[...a.segmentFlowM3PerSecond]};byId.set(r.id,r);return r;
 });
 const state=new Map(),confluences=[];
 function design(r){
  check(state.get(r)!==1,'cyclic parent graph');if(state.get(r)===2)return;state.set(r,1);
  let join=null;
  if(r.parent!==null){const parent=byId.get(r.parent);check(parent,'unknown parent');design(parent);let best={d:Infinity};for(let i=0;i<parent.points.length-1;i++){const p=project(r.points[0].xM,r.points[0].yM,parent.points[i],parent.points[i+1]);if(p.d<best.d)best={...p,i};}check(best.d<=.02,'disconnected confluence');const {i,t}=best;join={level:lerp(parent.waterLevelM[i],parent.waterLevelM[i+1],t),depth:lerp(parent.depthM[i],parent.depthM[i+1],t),width:lerp(parent.widthM[i],parent.widthM[i+1],t)};confluences.push({childId:r.id,parentId:r.parent,parentSegment:i,parentT:t,gapM:best.d,waterLevelM:join.level});}
  let distance=0;
  for(let i=0;i<r.points.length;i++){
   if(i)distance+=Math.hypot(r.points[i].xM-r.points[i-1].xM,r.points[i].yM-r.points[i-1].yM);
   const q=r.flow[Math.min(i,r.flow.length-1)],width=clamp(minWidthM+8*Math.sqrt(q),minWidthM,maxWidthM),depth=clamp(minDepthM+.55*Math.cbrt(q),minDepthM,maxDepthM),blend=join?smooth(clamp(distance/Math.max(50,join.width*3),0,1)):1;
   const w=join?lerp(join.width,width,blend):width,d=join?lerp(join.depth,depth,blend):depth;
   // Fixed junction datum plus the chosen original bed rise. Monotone clamp
   // prevents upstream water flowing uphill downstream after width/depth fits.
   const desired=join?join.level+Math.max(0,r.raw[i]-r.raw[0]):r.raw[i]-.15;
   const level=i?Math.max(r.waterLevelM[i-1],desired):desired;
   r.widthM.push(w);r.depthM.push(d);r.waterLevelM.push(level);r.bedElevationM.push(level-d);
  }
  delete r.raw;delete r.flow;state.set(r,2);
 }
 for(const r of rivers)design(r);
 const cellSize=maxWidthM*2,index=new Map(),segments=[];
 for(const r of rivers)for(let i=0;i<r.points.length-1;i++){
  const a=r.points[i],b=r.points[i+1],radius=Math.max(r.widthM[i],r.widthM[i+1]),s={r,i,a,b};segments.push(s);
  for(let y=Math.floor((Math.min(a.yM,b.yM)-radius)/cellSize);y<=Math.floor((Math.max(a.yM,b.yM)+radius)/cellSize);y++)for(let x=Math.floor((Math.min(a.xM,b.xM)-radius)/cellSize);x<=Math.floor((Math.max(a.xM,b.xM)+radius)/cellSize);x++){const key=`${x},${y}`;if(!index.has(key))index.set(key,[]);index.get(key).push(s);}
 }
 let minSource=Infinity,maxSource=-Infinity,minBed=Infinity,maxWater=-Infinity;
 for(const z of candidate.elevation){minSource=Math.min(minSource,z);maxSource=Math.max(maxSource,z);}for(const r of rivers)for(let i=0;i<r.points.length;i++){minBed=Math.min(minBed,r.bedElevationM[i]);maxWater=Math.max(maxWater,r.waterLevelM[i]);}
 function sample(xM,yM,baseGroundM=raster(candidate,xM,yM)){
  check([xM,yM,baseGroundM].every(Number.isFinite),'nonfinite sample');
  const hits=new Map();
  for(const s of index.get(`${Math.floor(xM/cellSize)},${Math.floor(yM/cellSize)}`)??[]){const p=project(xM,yM,s.a,s.b),old=hits.get(s.r.id);if(!old||p.d<old.d)hits.set(s.r.id,{...p,...s});}
  let total=0,ground=0,waterLevel=0,activation=0,nearest=null;
  for(const h of hits.values()){
   const {r,i,t,d}=h,width=lerp(r.widthM[i],r.widthM[i+1],t),half=width/2,u=d/half;if(u>=2)continue;
   const depth=lerp(r.depthM[i],r.depthM[i+1],t),level=lerp(r.waterLevelM[i],r.waterLevelM[i+1],t),a=u<=1?1:1-smooth(u-1);
   const target=level-depth+depth*u*u,modified=lerp(baseGroundM,target,a),w=(2-u)**2/(d*d+1e-12);
   total+=w;ground+=modified*w;waterLevel+=level*w;activation=Math.max(activation,a);
   if(!nearest||d<nearest.d)nearest={d,r,width,u};
  }
  if(!total)return {groundElevationM:baseGroundM,waterLevelM:null,waterDepthM:0,wet:false,riverId:null,channelWidthM:0};
  ground/=total;waterLevel/=total;
  const wet=nearest.u<1&&waterLevel>ground+1e-8;
  return {groundElevationM:ground,waterLevelM:wet?waterLevel:null,waterDepthM:wet?waterLevel-ground:0,wet,riverId:nearest.r.id,channelWidthM:nearest.width,bankInfluence:activation};
 }
 function localSegments(box){
  check(['minXM','minYM','maxXM','maxYM'].every(k=>Number.isFinite(box[k]))&&box.minXM<=box.maxXM&&box.minYM<=box.maxYM,'invalid bounds');
  if((2+(box.maxXM-box.minXM)/cellSize)*(2+(box.maxYM-box.minYM)/cellSize)>index.size*2)return segments.filter(s=>{const radius=Math.max(s.r.widthM[s.i],s.r.widthM[s.i+1]);return Math.max(s.a.xM,s.b.xM)+radius>=box.minXM&&Math.min(s.a.xM,s.b.xM)-radius<=box.maxXM&&Math.max(s.a.yM,s.b.yM)+radius>=box.minYM&&Math.min(s.a.yM,s.b.yM)-radius<=box.maxYM;});
  const set=new Set();for(let y=Math.floor(box.minYM/cellSize);y<=Math.floor(box.maxYM/cellSize);y++)for(let x=Math.floor(box.minXM/cellSize);x<=Math.floor(box.maxXM/cellSize);x++)for(const s of index.get(`${x},${y}`)??[])set.add(s);return [...set];
 }
 function intersectsBounds(box,{waterOnly=false}={}){const cx=(box.minXM+box.maxXM)/2,cy=(box.minYM+box.maxYM)/2,rad=Math.hypot(box.maxXM-box.minXM,box.maxYM-box.minYM)/2;return localSegments(box).some(s=>project(cx,cy,s.a,s.b).d<=rad+Math.max(s.r.widthM[s.i],s.r.widthM[s.i+1])*(waterOnly?.5:1));}
 function bounds(box,nativeRange){
  const cx=(box.minXM+box.maxXM)/2,cy=(box.minYM+box.maxYM)/2,rad=Math.hypot(box.maxXM-box.minXM,box.maxYM-box.minYM)/2;
  const candidates=localSegments(box).map(s=>({...s,p:project(cx,cy,s.a,s.b)})),nearest=new Map();
  for(const s of candidates)nearest.set(s.r.id,Math.min(nearest.get(s.r.id)??Infinity,s.p.d));
  const groups=new Map();
  for(const s of candidates){
   // Distance to a segment is 1-Lipschitz. A segment farther than this
   // cannot win the same-river nearest-segment query anywhere in the box.
   if(s.p.d-rad>nearest.get(s.r.id)+rad+1e-10)continue;
   const {r,i,a,b,p}=s,len=Math.hypot(b.xM-a.xM,b.yM-a.yM),dt=len?rad/len:0,t0=clamp(p.t-dt,0,1),t1=clamp(p.t+dt,0,1);
   const widths=[lerp(r.widthM[i],r.widthM[i+1],t0),lerp(r.widthM[i],r.widthM[i+1],t1)],depths=[lerp(r.depthM[i],r.depthM[i+1],t0),lerp(r.depthM[i],r.depthM[i+1],t1)],levels=[lerp(r.waterLevelM[i],r.waterLevelM[i+1],t0),lerp(r.waterLevelM[i],r.waterLevelM[i+1],t1)];
   const d0=Math.max(0,p.d-rad),d1=p.d+rad,u0=d0/(Math.max(...widths)/2),u1=d1/(Math.min(...widths)/2);
   const w0=Math.max(0,2-u1)**2/(d1*d1+1e-12),w1=Math.max(0,2-u0)**2/(d0*d0+1e-12);
   let lo=Infinity,hi=-Infinity;
   if(u0<2){const v0=Math.min(2,u0),v1=Math.min(2,u1),a0=v1<=1?1:1-smooth(v1-1),a1=v0<=1?1:1-smooth(v0-1);
    for(const z of nativeRange)for(const level of levels)for(const depth of depths)for(const u of [v0,v1])for(const blend of [a0,a1]){const v=lerp(z,level+depth*(u*u-1),blend);lo=Math.min(lo,v);hi=Math.max(hi,v);}
   }
   const group=groups.get(r.id)??{lo:Infinity,hi:-Infinity,w0:Infinity,w1:0};group.lo=Math.min(group.lo,lo);group.hi=Math.max(group.hi,hi);group.w0=Math.min(group.w0,w0);group.w1=Math.max(group.w1,w1);groups.set(r.id,group);
  }
  const active=[...groups.values()].filter(g=>g.w1>0);if(!active.length)return [...nativeRange];
  const union=[Math.min(...active.map(g=>g.lo)),Math.max(...active.map(g=>g.hi))],den0=active.reduce((s,g)=>s+g.w0,0),den1=active.reduce((s,g)=>s+g.w1,0);
  if(!(den0>0))return [Math.min(union[0],nativeRange[0]),Math.max(union[1],nativeRange[1])];
  // Centering the numerator avoids widening from large absolute elevation
  // datums. Interval weights converge with box size even at tributary overlap.
  const ref=sample(cx,cy,(nativeRange[0]+nativeRange[1])/2).groundElevationM;
  let num0=0,num1=0;
  for(const g of active){const products=[g.w0*(g.lo-ref),g.w0*(g.hi-ref),g.w1*(g.lo-ref),g.w1*(g.hi-ref)];num0+=Math.min(...products);num1+=Math.max(...products);}
  const quotients=[num0/den0,num0/den1,num1/den0,num1/den1];
  return [Math.max(union[0],ref+Math.min(...quotients)),Math.min(union[1],ref+Math.max(...quotients))];
 }
 return {schema:'shape-first-designed-channels@2' ,status:'Designed channel geometry and water datum; provisional supply scaling, not hydraulic certification',method:'Bounded supply-scaled width/depth; parent-first matching confluences; upstream-monotone water levels; parabolic wet section and compact smooth bank blend',rivers,confluences,sample,intersectsBounds,bounds,minimumHalfWidthM:minWidthM/2,segments:segments.map(s=>({riverId:s.r.id,a:s.a,b:s.b,halfWidthM:Math.max(s.r.widthM[s.i],s.r.widthM[s.i+1])/2})),
 maximumIncisionM:Math.max(0,maxSource-minBed),maximumGroundRiseM:Math.max(0,maxWater+3*maxDepthM-minSource),maximumWaterRiseM:Math.max(0,maxWater-minSource),elevationRangeM:[Math.min(minSource,minBed),Math.max(maxSource,maxWater+3*maxDepthM)],designBounds:{minWidthM,maxWidthM,minDepthM,maxDepthM,bankRadiusFactor:2}};
}
