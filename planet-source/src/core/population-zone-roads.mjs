import {greatCircle} from './spherical.mjs';

/** Shared edge, not a corner; unequal-depth leaves and longitude wrap are valid. */
export function sharedPopulationEdge(a,b){
 const A=a.bounds,B=b.bounds,e=1e-9,overlap=(a,b,c,d)=>Math.min(b,d)-Math.max(a,c)>e;
 for(const shift of [-360,0,360]){
  const west=B.west+shift,east=B.east+shift;
  if((Math.abs(A.east-west)<e||Math.abs(A.west-east)<e)&&overlap(A.south,A.north,B.south,B.north))return true;
  if((Math.abs(A.north-B.south)<e||Math.abs(A.south-B.north)<e)&&overlap(A.west,A.east,west,east))return true;
 }
 return false;
}

/** One compact proposal per pair of committed neighbouring regions. Never run
 * a spanning tree on the current camera's subset: that would change endpoints
 * whenever another village becomes visible. This proposal still needs a local
 * terrain / water / reservation survey before it becomes a built road. */
export function proposePopulationZoneRoad(zoneA,regionA,zoneB,regionB,radiusM,{maxDistanceM=60000}={}){
 if(!Number.isFinite(radiusM)||radiusM<=0||!Number.isFinite(maxDistanceM)||maxDistanceM<=0||maxDistanceM>100000)throw new RangeError('Invalid inter-zone road budget');
 if(zoneA.id===zoneB.id||!sharedPopulationEdge(zoneA,zoneB))throw new Error('Distinct edge-adjacent population zones required');
 const pairs=[{zone:zoneA,region:regionA},{zone:zoneB,region:regionB}].sort((a,b)=>a.zone.id.localeCompare(b.zone.id));
 for(const {zone,region}of pairs)if(!Array.isArray(region.sites)||region.sites.length>512||region.sites.some(s=>!s.id?.startsWith(`${zone.id}/site:`)||![s.latDeg,s.lonDeg].every(Number.isFinite)))throw new Error('Committed region does not match zone');
 const id=`zone-road:${pairs.map(p=>p.zone.id).join('|')}`,base={id,zoneIds:pairs.map(p=>p.zone.id),method:'adjacent-committed-sites@1'};
 if(pairs.some(p=>!p.region.sites.length))return{...base,status:'no-settlements',link:null};
 let best=null;
 for(const a of pairs[0].region.sites)for(const b of pairs[1].region.sites){
  const distanceM=greatCircle(a,b,radiusM).distanceM,key=`${a.id}|${b.id}`;
  if(!best||distanceM<best.distanceM||(distanceM===best.distanceM&&key<best.key))best={a,b,distanceM,key};
 }
 if(best.distanceM>maxDistanceM)return{...base,status:'requires-long-distance-route',minimumDistanceM:best.distanceM,link:null};
 const point=s=>({latDeg:s.latDeg,lonDeg:s.lonDeg,id:s.id,population:s.population});
 return{...base,status:'awaiting-local-route',link:{id,from:best.a.id,to:best.b.id,fromPoint:point(best.a),toPoint:point(best.b),distanceM:best.distanceM,status:'awaiting-local-route'}};
}

/** Persist the pair, including explicit unconnected outcomes. A newer planner
 * cannot silently choose different endpoints for an established connection. */
export async function commitPopulationZoneRoad(materializer,{worldId,zoneA,regionA,zoneB,regionB,radiusM,signal,generate=proposePopulationZoneRoad}){
 const pairs=[{zone:zoneA,region:regionA},{zone:zoneB,region:regionB}].sort((a,b)=>a.zone.id.localeCompare(b.zone.id));
 if(pairs[0].zone.id===pairs[1].zone.id||!sharedPopulationEdge(pairs[0].zone,pairs[1].zone))throw new Error('Distinct edge-adjacent population zones required');
 return materializer.resolve({worldId,entityId:`zone-road:${pairs.map(p=>p.zone.id).join('|')}`,conditions:{radiusM,regions:pairs.map(({zone,region})=>({zone,sites:region.sites}))},generator:'adjacent-committed-sites@1',signal,generate:()=>generate(pairs[0].zone,pairs[0].region,pairs[1].zone,pairs[1].region,radiusM)});
}
