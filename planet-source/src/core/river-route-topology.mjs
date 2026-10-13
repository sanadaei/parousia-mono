/** Exact minor-great-circle centerline checks. This does not certify bank-width
 * overlap, hydraulic capacity, or continuous terrain between sampled points. */
import {sphereBasis,geographicPoint} from './spherical.mjs';
import {createRiverSpatialIndex} from './river-spatial-index.mjs';
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],norm=v=>Math.hypot(...v),unit=v=>{const n=norm(v);return v.map(x=>x/n);},angle=(a,b)=>Math.atan2(norm(cross(a,b)),dot(a,b));
const point=v=>geographicPoint(Math.atan2(v[2],Math.hypot(v[0],v[1]))*180/Math.PI,Math.atan2(v[1],v[0])*180/Math.PI);
function arc(a,b){const av=sphereBasis(a).up,bv=sphereBasis(b).up,length=angle(av,bv);if(length<1e-13||length>=Math.PI/2)throw new RangeError('Nondegenerate short arcs required');return {a:{...a,halfWidthM:0,bankWidthM:0},b:{...b,halfWidthM:0,bankWidthM:0},av,bv,angle:length};}
function on(s,q,epsilon){return Math.abs(angle(s.av,q)+angle(q,s.bv)-s.angle)<=epsilon;}
function intersections(a,b,epsilon){const n=cross(unit(cross(a.av,a.bv)),unit(cross(b.av,b.bv)));if(norm(n)<1e-12){const common=[a.av,a.bv,b.av,b.bv].filter(q=>on(a,q,epsilon)&&on(b,q,epsilon));return {points:common,overlap:common.some((q,i)=>common.some((r,j)=>i!==j&&angle(q,r)>epsilon))};}const p=unit(n);return {points:[p,p.map(v=>-v)].filter(q=>on(a,q,epsilon)&&on(b,q,epsilon)),overlap:false};}
export function auditRiverRouteTopology(network,profile,path,{toleranceM=.1,maxPairs=1000000}={}){
 const radius=network.radiusM;if(!Number.isFinite(radius)||radius<=0||!Number.isFinite(toleranceM)||toleranceM<=0||toleranceM>1||!Array.isArray(path)||path.length<2||path.length>8192||!Number.isInteger(maxPairs)||maxPairs<1||maxPairs>1000000)throw new RangeError('Bounded topology audit required');
 if(![profile.id,profile.from,profile.to].every(x=>typeof x==='string'&&x.length))throw new Error('Profile and node IDs required');
 if(angle(sphereBasis(path[0]).up,sphereBasis(profile.points[0]).up)*radius>toleranceM||angle(sphereBasis(path.at(-1)).up,sphereBasis(profile.points.at(-1)).up)*radius>toleranceM)throw new Error('Shared route endpoints moved');
 const segments=[];for(const p of network.profiles){if(![p.id,p.from,p.to].every(x=>typeof x==='string'&&x.length))throw new Error('Network node IDs required');if(p.id===profile.id)continue;for(let k=1;k<p.points.length;k++){if(segments.length>=131072)throw new RangeError('Network audit segment budget');segments.push({...arc(p.points[k-1],p.points[k]),profile:p,k});}}
 const index=createRiverSpatialIndex(segments,radius),epsilon=toleranceM/radius,violations=[],seen=new Set();let pairs=0;
 for(let k=1;k<path.length;k++){const a=arc(path[k-1],path[k]),center=unit(a.av.map((v,i)=>v+a.bv[i]));for(const j of index.query(center,a.angle*radius/2+toleranceM)){
  if(++pairs>maxPairs)return {complete:false,reason:'pair-budget',pairs,violations};const b=segments[j],hit=intersections(a,b,epsilon);
  for(const q of hit.points){
   let allowed=false;
   for(const [key,p] of [['from',path[0]],['to',path.at(-1)]])for(const [other,r] of [['from',b.profile.points[0]],['to',b.profile.points.at(-1)]])if(profile[key]===b.profile[other]&&angle(sphereBasis(p).up,q)<=epsilon&&angle(sphereBasis(r).up,q)<=epsilon)allowed=true;
   if(hit.overlap||!allowed){const key=`${b.profile.id}:${Math.round(q[0]/epsilon)}:${Math.round(q[1]/epsilon)}:${Math.round(q[2]/epsilon)}`;if(!seen.has(key)){seen.add(key);violations.push({otherProfileId:b.profile.id,kind:hit.overlap?'collinear-overlap':'unregistered-centerline-crossing',...point(q)});}}
  }
 }}
 return {complete:true,pairs,violations,valid:violations.length===0,scope:'Centerline crossings only; bank overlap and hydraulics not certified'};
}
