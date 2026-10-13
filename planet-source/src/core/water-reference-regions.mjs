import {sphereBasis,greatCircle} from './spherical.mjs';
import {materializeRegionalWaterPlan} from './regional-water-materialization.mjs';
import {materializeLocalWaterPlan} from './local-water-materialization.mjs';
const rootsByWorld=new WeakMap(),RADIANS=Math.PI/180;
export const SHARED_WATER_REGIONS='shared-water-reference-regions@1';
export const SHARED_REGIONAL_WATER='shared-regional-water-regions@1';
export const usesSharedWater=policy=>[SHARED_WATER_REGIONS,SHARED_REGIONAL_WATER].includes(policy);
function policySpan(policy){if(!usesSharedWater(policy))throw new TypeError('Unknown shared water policy');return policy===SHARED_REGIONAL_WATER?256000:32000;}
function policyRoot(owner,policy){return policy===SHARED_REGIONAL_WATER?{...owner,id:owner.id.replace('water-region:','regional-water-region:')}:owner;}
export function containsWaterDisc(zone,center,supportRadiusM,radiusM){
 const b=zone.bounds,angle=supportRadiusM/radiusM,phi=center.latDeg*RADIANS;
 if(!b||![angle,phi,center.lonDeg,b.north,b.south,b.west,b.east].every(Number.isFinite)||angle<0||angle>=Math.PI/2||Math.abs(phi)+angle>=Math.PI/2)return false;
 const lat=angle/RADIANS,lon=Math.asin(Math.min(1,Math.sin(angle)/Math.cos(phi)))/RADIANS,u=((center.lonDeg-b.west)%360+360)%360,span=b.east-b.west;
 return center.latDeg-lat>=b.south&&center.latDeg+lat<=b.north&&u-lon>=0&&u+lon<=span;
}
function roots(world){
 let out=rootsByWorld.get(world);if(out)return out;
 const{columns:w,rows:h}=world.population.grid,r=world.base.frame.radiusM;
 if(!Number.isSafeInteger(w)||!Number.isSafeInteger(h)||w<1||h<1||w*h>131072||!Number.isFinite(r)||r<=0)throw new RangeError('Invalid water reference grid');
 out=Array.from({length:w*h},(_,i)=>({id:`water-region:${i}`,rootCell:i,depth:0,bounds:{west:i%w*360/w,east:(i%w+1)*360/w,north:90-Math.floor(i/w)*180/h,south:90-(Math.floor(i/w)+1)*180/h}}));rootsByWorld.set(world,out);return out;
}
const span=(owner,r)=>{const b=owner.bounds;return Math.max(b.north-b.south,(b.east-b.west)*Math.cos((b.north+b.south)*RADIANS/2))*RADIANS*r;};
function children(owner){
 const{west,east,south,north}=owner.bounds,x=(west+east)/2,y=Math.asin((Math.sin(south*RADIANS)+Math.sin(north*RADIANS))/2)/RADIANS;
 return[{west,east:x,south:y,north},{west:x,east,south:y,north},{west,east:x,south,north:y},{west:x,east,south,north:y}].map((bounds,i)=>({id:`${owner.id}/${i}`,rootCell:owner.rootCell,depth:owner.depth+1,bounds}));
}
const contains=(b,p)=>p.lonDeg>=b.west&&p.lonDeg<b.east&&p.latDeg<=b.north&&(p.latDeg>b.south||b.south===-90&&p.latDeg===-90);
/** Census counts never determine this spatial ownership. These are bounded
 * survey regions, NOT complete watersheds or proof of cross-boundary drainage. */
export function waterRegionForPopulationZone(world,zone,{policy=SHARED_WATER_REGIONS}={}){
 const maximumSpan=policySpan(policy);
 let owner=roots(world)[zone.rootCell];if(!owner)throw new RangeError('Unknown water root');owner=policyRoot(owner,policy);
 const b=zone.bounds,p={lonDeg:(b.west+b.east)/2,latDeg:(b.south+b.north)/2};
 while(span(owner,world.base.frame.radiusM)>maximumSpan&&owner.depth<12){owner=children(owner).find(c=>contains(c.bounds,p));if(!owner)throw new Error('Water reference partition has a gap');}
 const q=owner.bounds,e=1e-9;if(b.west<q.west-e||b.east>q.east+e||b.south<q.south-e||b.north>q.north+e)throw new RangeError('Population region must fit one shared water owner');
 return {...owner,bounds:{...owner.bounds}};
}
export function waterRegionsNear(world,bound,{maxNodes=2048,maxRegions=128,policy=SHARED_WATER_REGIONS}={}){
 const maximumSpan=policySpan(policy);
 if(!Array.isArray(bound?.center)||bound.center.length!==3||!bound.center.every(Number.isFinite)||Math.abs(Math.hypot(...bound.center)-1)>1e-6||!Number.isFinite(bound.angular)||bound.angular<0||bound.angular>Math.PI||!Number.isSafeInteger(maxNodes)||maxNodes<1||maxNodes>8192||!Number.isSafeInteger(maxRegions)||maxRegions<1||maxRegions>128)throw new RangeError('Invalid water reference budget');
 const intersects=owner=>{const b=owner.bounds,u=sphereBasis({latDeg:(b.north+b.south)/2,lonDeg:(b.east+b.west)/2}).up,angular=((b.north-b.south)+(b.east-b.west))*RADIANS/2;return Math.acos(Math.max(-1,Math.min(1,u.reduce((s,v,i)=>s+v*bound.center[i],0))))<=angular+bound.angular;};
 const queue=roots(world).filter(intersects).map(o=>policyRoot(o,policy)),out=[];let visited=0;
 while(queue.length){if(++visited>maxNodes)throw new RangeError('Water reference traversal exceeds budget');const owner=queue.shift();if(span(owner,world.base.frame.radiusM)<=maximumSpan||owner.depth>=12){out.push(owner);if(out.length>maxRegions)throw new RangeError('Too many water reference regions');}else for(const child of children(owner))if(intersects(child))queue.push(child);}
 return out.map(o=>({...o,bounds:{...o.bounds}}));
}
export async function selectOwnedWaterPlan(world,owner,materializer,{signal,regional=false}={}){
 const radius=world.base.frame.radiusM,network=world.base.toSnapshot().references.rivers,supportRadiusM=Math.SQRT2*(regional?32768:4096)+32,b=owner.bounds,center={latDeg:(b.north+b.south)/2,lonDeg:(b.east+b.west)/2};let selected=null;
 if(network&&world.climate?.catchmentWater)for(const parent of network.profiles){if(parent.id.includes('tributary-region'))continue;for(let pointIndex=0;pointIndex<parent.points.length;pointIndex++){
  const point=parent.points[pointIndex];if(!containsWaterDisc(owner,point,supportRadiusM,radius))continue;
  if(world.settlements.some(a=>greatCircle(a,point,radius).distanceM<46000+supportRadiusM))continue;
  const distance=greatCircle(center,point,radius).distanceM;
  if(!selected||distance<selected.distance||distance===selected.distance&&`${parent.id}/${pointIndex}`<`${selected.parentId}/${selected.pointIndex}`)selected={parentId:parent.id,pointIndex,distance};
 }}
 return selected?(regional?materializeRegionalWaterPlan:materializeLocalWaterPlan)(world,materializer,{parentId:selected.parentId,pointIndex:selected.pointIndex,signal}):null;
}
/** One persistent water record is shared by all finer population leaves. */
export function materializeWaterReferenceRegion(world,owner,materializer,{signal,policy=SHARED_WATER_REGIONS}={}){
 policySpan(policy);
 return materializer.resolve({worldId:world.worldId,entityId:owner.id,conditions:{baseWorldId:world.base.worldId,climateId:world.climate?.catchmentWater?.id??null,owner,anchors:world.settlements},generator:policy,signal,generate:async()=>({schema:policy,owner,plan:await selectOwnedWaterPlan(world,owner,materializer,{signal,regional:policy===SHARED_REGIONAL_WATER})})});
}
