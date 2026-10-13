/** Bounded, draft-only connection to a VERIFIED existing receiving river.
 * Chooses a curve first, then one monotone datum and a compact channel section.
 * This is geometry continuity, not a runoff/storage-balance certification. */
import {createHash} from './sha256.mjs';
const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x)),mix=(a,b,t)=>a+(b-a)*t,smooth=t=>{t=clamp(t);return t*t*(3-2*t);};
const distance=(a,b)=>Math.hypot(a.xM-b.xM,a.yM-b.yM);
const unit=v=>{const l=Math.hypot(v.xM,v.yM);return l?{xM:v.xM/l,yM:v.yM/l}:{xM:1,yM:0};};
function project(x,y,a,b){const dx=b.xM-a.xM,dy=b.yM-a.yM,l=dx*dx+dy*dy,t=l?clamp(((x-a.xM)*dx+(y-a.yM)*dy)/l):0;return{t,d:Math.hypot(x-a.xM-t*dx,y-a.yM-t*dy),along:l?((x-a.xM)*dx+(y-a.yM)*dy)/Math.sqrt(l):0};}
export function chooseShapeFirstOutletReceiver(network,{local,extent,outlet,transitionM=4000,maxDistanceM=30000}){
 if(!(maxDistanceM>0&&maxDistanceM<=100000))throw new RangeError('Outlet receiver search must be bounded to 100 km');
 const found=[];for(const profile of network?.profiles??[])for(let i=1;i<profile.points.length;i++){
  const point=profile.points[i],p=local(point.latDeg,point.lonDeg);if(!p)continue;
  const outside=Math.hypot(Math.max(0,-p.xM,p.xM-extent.widthM),Math.max(0,-p.yM,p.yM-extent.heightM));
  const d=distance(outlet,p);if(outside<transitionM+Math.max(100,point.halfWidthM*2)||d>maxDistanceM||d<1)continue;
  const previous=profile.points[i-1],q=local(previous.latDeg,previous.lonDeg),direction=q?unit({xM:p.xM-q.xM,yM:p.yM-q.yM}):unit({xM:p.xM-outlet.xM,yM:p.yM-outlet.yM});
  // Reject a receiver approached against its downstream direction. This also
  // avoids connecting to the upstream half of a nearby parent river.
  if((p.xM-outlet.xM)*direction.xM+(p.yM-outlet.yM)*direction.yM<=0)continue;
  found.push({kind:'existing-river',regionExtent:{...extent},id:profile.id,pointIndex:i,...p,latDeg:point.latDeg,lonDeg:point.lonDeg,waterLevelM:point.waterLevelElevationM,depthM:point.depthM,widthM:point.halfWidthM*2,direction,distanceM:d});
 }
 found.sort((a,b)=>a.distanceM-b.distanceM||a.id.localeCompare(b.id)||a.pointIndex-b.pointIndex);return found[0]??null;
}
export function designShapeFirstOutletRoute(outlet,receiver,{segments=96}={}){
 if(!Number.isInteger(segments)||segments<8||segments>512)throw new RangeError('Invalid connector geometry budget');
 const d=distance(outlet,receiver);if(!(d>0&&d<=100000))throw new RangeError('Connector length outside bounded design scope');
 const startDirection=unit(outlet.direction??{xM:receiver.xM-outlet.xM,yM:receiver.yM-outlet.yM}),endDirection=unit(receiver.direction??startDirection),handle=Math.min(2000,d*.3);
 const a=outlet,b={xM:a.xM+startDirection.xM*handle,yM:a.yM+startDirection.yM*handle},e=receiver,c={xM:e.xM-endDirection.xM*handle,yM:e.yM-endDirection.yM*handle};
 const points=[];let lengthM=0;for(let i=0;i<=segments;i++){const t=i/segments,u=1-t,p={xM:u*u*u*a.xM+3*u*u*t*b.xM+3*u*t*t*c.xM+t*t*t*e.xM,yM:u*u*u*a.yM+3*u*u*t*b.yM+3*u*t*t*c.yM+t*t*t*e.yM};if(i)lengthM+=distance(p,points.at(-1));points.push({...p,distanceM:lengthM});}const extent=receiver.regionExtent;
 if(extent&&points.slice(1).some(p=>p.xM>1e-5&&p.xM<extent.widthM-1e-5&&p.yM>1e-5&&p.yM<extent.heightM-1e-5))return exteriorRoute(outlet,receiver,extent,segments);
 return{points,lengthM,method:'direct-cubic'};
}
function exteriorRoute(outlet,receiver,extent,budget){
 const margin=500,W=extent.widthM,H=extent.heightM,side=[{d:Math.abs(outlet.xM),p:{xM:-margin,yM:outlet.yM}},{d:Math.abs(outlet.xM-W),p:{xM:W+margin,yM:outlet.yM}},{d:Math.abs(outlet.yM),p:{xM:outlet.xM,yM:-margin}},{d:Math.abs(outlet.yM-H),p:{xM:outlet.xM,yM:H+margin}}].sort((a,b)=>a.d-b.d)[0];
 const nodes=[side.p,{xM:-margin,yM:-margin},{xM:W+margin,yM:-margin},{xM:W+margin,yM:H+margin},{xM:-margin,yM:H+margin},receiver],N=nodes.length;
 // Slab interval tests forbid every open-interior crossing of the expanded box.
 const visible=(a,b)=>{let lo=0,hi=1;for(const[k,min,max]of[['xM',-margin+1e-5,W+margin-1e-5],['yM',-margin+1e-5,H+margin-1e-5]]){const d=b[k]-a[k];if(Math.abs(d)<1e-12){if(a[k]<=min||a[k]>=max)return true;continue;}const u=(min-a[k])/d,v=(max-a[k])/d;lo=Math.max(lo,Math.min(u,v));hi=Math.min(hi,Math.max(u,v));if(lo>=hi)return true;}return hi<=0||lo>=1;};
 const dist=Array(N).fill(Infinity),previous=Array(N).fill(-1),done=new Set();dist[0]=0;for(let k=0;k<N;k++){let i=-1;for(let j=0;j<N;j++)if(!done.has(j)&&(i<0||dist[j]<dist[i]))i=j;if(i<0||!Number.isFinite(dist[i]))break;done.add(i);for(let j=0;j<N;j++)if(i!==j&&visible(nodes[i],nodes[j])){const d=dist[i]+distance(nodes[i],nodes[j]);if(d<dist[j]){dist[j]=d;previous[j]=i;}}}
 if(!Number.isFinite(dist[N-1]))throw new Error('No exterior outlet route within bounded perimeter');
 const polygon=[];for(let i=N-1;i>=0;i=previous[i]){polygon.unshift(nodes[i]);if(i===0)break;}polygon.unshift(outlet);
 const dense=[{xM:outlet.xM,yM:outlet.yM}];const append=p=>{if(distance(dense.at(-1),p)>1e-8)dense.push(p);};
 // Round corners by <=150m: stays at least350m outside the native shape.
 for(let i=1;i<polygon.length-1;i++){const a=polygon[i-1],b=polygon[i],c=polygon[i+1],r=Math.min(150,distance(a,b)/4,distance(b,c)/4),ab=unit({xM:a.xM-b.xM,yM:a.yM-b.yM}),cb=unit({xM:c.xM-b.xM,yM:c.yM-b.yM}),p={xM:b.xM+ab.xM*r,yM:b.yM+ab.yM*r},q={xM:b.xM+cb.xM*r,yM:b.yM+cb.yM*r};append(p);for(let k=1;k<=8;k++){const t=k/8,u=1-t;append({xM:u*u*p.xM+2*u*t*b.xM+t*t*q.xM,yM:u*u*p.yM+2*u*t*b.yM+t*t*q.yM});}}
 append(receiver);let lengthM=0;const points=[{...dense[0],distanceM:0}];for(let i=1;i<dense.length;i++){const a=dense[i-1],b=dense[i],len=distance(a,b),steps=Math.max(1,Math.ceil(len/250));for(let j=1;j<=steps;j++){const t=j/steps;points.push({xM:mix(a.xM,b.xM,t),yM:mix(a.yM,b.yM,t),distanceM:lengthM+len*t});}lengthM+=len;}
 if(points.length>512||lengthM>100000)throw new RangeError('Exterior connector exceeds geometry budget');
 if(points.slice(1).some(p=>p.xM>1e-5&&p.xM<W-1e-5&&p.yM>1e-5&&p.yM<H-1e-5))throw new Error('Exterior connector reentered native shape');
 return{points,lengthM,method:'rounded-exterior-perimeter',marginM:margin};
}
export function createShapeFirstOutletConnector(spec){
 if(spec?.schema!=='shape-first-outlet-connection@1'||spec.receiver?.verifiedWet!==true)throw new TypeError('Connector requires a verified existing wet receiver');
 const {outlet,receiver}=spec,route=designShapeFirstOutletRoute(outlet,receiver,spec.routeOptions);
 for(const p of[outlet,receiver])if(![p.xM,p.yM,p.waterLevelM,p.depthM,p.widthM].every(Number.isFinite)||p.depthM<=0||p.widthM<=0||p.widthM>4000)throw new TypeError('Invalid connector cross-section');
 if(outlet.waterLevelM<receiver.waterLevelM)throw new RangeError('Outlet is below receiver: revise draft placement or choose another receiver');
 const terminalOverlapM=Math.min(20,receiver.widthM/8),segments=route.points.slice(1).map((b,i)=>({a:route.points[i],b}));
 const id='shape-first-outlet:'+createHash('sha256').update(JSON.stringify(spec)).digest('hex'),maxWidth=Math.max(outlet.widthM,receiver.widthM),radius=maxWidth;
 const cellSize=512,index=new Map();for(const s of segments)for(let y=Math.floor((Math.min(s.a.yM,s.b.yM)-radius)/cellSize);y<=Math.floor((Math.max(s.a.yM,s.b.yM)+radius)/cellSize);y++)for(let x=Math.floor((Math.min(s.a.xM,s.b.xM)-radius)/cellSize);x<=Math.floor((Math.max(s.a.xM,s.b.xM)+radius)/cellSize);x++){const key=`${x},${y}`;if(!index.has(key))index.set(key,[]);index.get(key).push(s);}
 const localSegments=b=>{const x0=Math.floor(b.minXM/cellSize),x1=Math.floor(b.maxXM/cellSize),y0=Math.floor(b.minYM/cellSize),y1=Math.floor(b.maxYM/cellSize);if((x1-x0+1)*(y1-y0+1)>4096)return segments;const found=new Set();for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++)for(const s of index.get(`${x},${y}`)??[])found.add(s);return [...found];};
 const box={minXM:Math.min(...route.points.map(p=>p.xM))-radius,minYM:Math.min(...route.points.map(p=>p.yM))-radius,maxXM:Math.max(...route.points.map(p=>p.xM))+radius,maxYM:Math.max(...route.points.map(p=>p.yM))+radius};
 function sample(xM,yM,baseGroundM,baseWaterLevelM=null){
  if(![xM,yM,baseGroundM].every(Number.isFinite)||(baseWaterLevelM!=null&&!Number.isFinite(baseWaterLevelM)))throw new TypeError('Nonfinite connector sample');
  const unchanged={groundElevationM:baseGroundM,waterLevelM:baseWaterLevelM,wet:baseWaterLevelM!=null&&baseWaterLevelM>baseGroundM,riverId:null,waterDepthM:baseWaterLevelM==null?0:Math.max(0,baseWaterLevelM-baseGroundM),channelWidthM:0,influence:0};
  if(xM<box.minXM||xM>box.maxXM||yM<box.minYM||yM>box.maxYM)return unchanged;
  let hit=null;for(const s of index.get(`${Math.floor(xM/cellSize)},${Math.floor(yM/cellSize)}`)??[]){const p=project(xM,yM,s.a,s.b);if(!hit||p.d<hit.d)hit={...p,...s};}
  if(!hit)return unchanged;
  const along=mix(hit.a.distanceM,hit.b.distanceM,hit.t),t=along/route.lengthM,width=mix(outlet.widthM,receiver.widthM,smooth(t)),depth=mix(outlet.depthM,receiver.depthM,smooth(t)),level=mix(outlet.waterLevelM,receiver.waterLevelM,smooth(t)),u=hit.d/(width/2);
  if(u>=2)return unchanged;
  // At the receiving centerline the modification reaches zero inside its
  // verified wet section. Beyond it the existing river remains authoritative.
  const remaining=route.lengthM-along,terminal=smooth(remaining/terminalOverlapM),bank=u<=1?1:1-smooth(u-1),influence=terminal*bank;
  if(influence===0)return unchanged;
  const target=level+depth*(u*u-1),ground=mix(baseGroundM,target,influence),water=baseWaterLevelM!=null?mix(baseWaterLevelM,level,terminal):level,wet=u<1&&water>ground+1e-8;
  return{groundElevationM:ground,waterLevelM:wet?water:null,waterDepthM:wet?water-ground:0,wet,riverId:wet?id:null,receiverId:receiver.id,channelWidthM:width,influence};
 }
 function intersectsBounds(b,{waterOnly=false}={}){const x=(b.minXM+b.maxXM)/2,y=(b.minYM+b.maxYM)/2,r=Math.hypot(b.maxXM-b.minXM,b.maxYM-b.minYM)/2;return localSegments(b).some(s=>project(x,y,s.a,s.b).d<=r+maxWidth*(waterOnly?.5:1));}
 function bounds(b,range){
  const x=(b.minXM+b.maxXM)/2,y=(b.minYM+b.maxYM)/2,r=Math.hypot(b.maxXM-b.minXM,b.maxYM-b.minYM)/2;let lo=Infinity,hi=-Infinity,covered=false;
  for(const s of localSegments(b)){const p=project(x,y,s.a,s.b),len=s.b.distanceM-s.a.distanceM,dt=r/len,t0=clamp(p.t-dt),t1=clamp(p.t+dt),d0=mix(s.a.distanceM,s.b.distanceM,t0),d1=mix(s.a.distanceM,s.b.distanceM,t1),ts=[smooth(d0/route.lengthM),smooth(d1/route.lengthM)],ws=ts.map(t=>mix(outlet.widthM,receiver.widthM,t)),levels=ts.map(t=>mix(outlet.waterLevelM,receiver.waterLevelM,t)),depths=ts.map(t=>mix(outlet.depthM,receiver.depthM,t)),u0=Math.max(0,p.d-r)/(Math.max(...ws)/2),u1=Math.min(2,(p.d+r)/(Math.min(...ws)/2));if(u0>=2)continue;if(u1<2)covered=true;
   const banks=[u0<=1?1:1-smooth(u0-1),u1<=1?1:1-smooth(u1-1)],ends=[smooth((route.lengthM-d0)/terminalOverlapM),smooth((route.lengthM-d1)/terminalOverlapM)];
   for(const z of range)for(const level of levels)for(const depth of depths)for(const u of[u0,u1])for(const bank of banks)for(const end of ends){const v=mix(z,level+depth*(u*u-1),bank*end);lo=Math.min(lo,v);hi=Math.max(hi,v);}
  }return covered?[lo,hi]:[Math.min(range[0],lo),Math.max(range[1],hi)];
 }
 const elevationRangeM=[Math.min(outlet.waterLevelM-outlet.depthM,receiver.waterLevelM-receiver.depthM),Math.max(outlet.waterLevelM+3*outlet.depthM,receiver.waterLevelM+3*receiver.depthM)];
 const rivers=[{id,parent:receiver.id,points:route.points.toReversed().map(p=>({xM:p.xM,yM:p.yM})),waterLevelM:route.points.toReversed().map(p=>mix(outlet.waterLevelM,receiver.waterLevelM,smooth(p.distanceM/route.lengthM))),widthM:route.points.toReversed().map(p=>mix(outlet.widthM,receiver.widthM,smooth(p.distanceM/route.lengthM))),depthM:route.points.toReversed().map(p=>mix(outlet.depthM,receiver.depthM,smooth(p.distanceM/route.lengthM)))}];rivers[0].bedElevationM=rivers[0].waterLevelM.map((z,i)=>z-rivers[0].depthM[i]);
 return{schema:spec.schema,id,spec,route,rivers,box,sample,intersectsBounds,minimumHalfWidthM:Math.min(outlet.widthM,receiver.widthM)/2,elevationRangeM,bounds,status:'Connected to verified existing river; supply and receiving-flow response remain provisional'};
}
