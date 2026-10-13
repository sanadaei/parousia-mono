import {copyJson,hashJson} from './json-contract.mjs';
import {createSphericalRiverSampler,PLANET_RIVERS_SCHEMA,SMOOTH_RIVER_BED} from './planet-rivers.mjs';
import {selectBasePlanetWater} from './sea-level.mjs';
import {offsetGeographic,greatCircle} from './spherical.mjs';
/** Read-only physical view of committed local plans over the immutable base.
 * This view is not a new serializable base snapshot. Its additional records
 * must be retained with the world save; it must precede land-use planning. */
export function compileMaterializedWaterNetwork(base,plans,{sourceWorldId}={}){
 if(typeof sourceWorldId!=='string'||!sourceWorldId||!base?.frame||!Array.isArray(plans))throw new TypeError('Bounded saved water plans and their source world are required');
 if(plans.length>64)throw new RangeError('Loaded local water exceeds 64 plans; saved records remain intact');
 let rawPoints=0,rawNodes=0;
 for(const input of plans){
  if(!Array.isArray(input?.profiles)||!Array.isArray(input?.nodes))throw new TypeError('Invalid saved water arrays');
  rawNodes+=input.nodes.length;
  for(const profile of input.profiles){if(!Array.isArray(profile?.points))throw new TypeError('Invalid saved river points');rawPoints+=profile.points.length;}
  if(rawPoints>32768||rawNodes>65536)throw new RangeError('Loaded local water point budget exceeded');
 }
 const unique=new Map();
 for(const input of plans){
  const p=copyJson(input);
  if(p.schema!=='referenced-local-water-plan@1'||p.sourceWorldId!==sourceWorldId||typeof p.id!=='string'||!Array.isArray(p.nodes)||!Array.isArray(p.profiles)||![p.region?.center?.latDeg,p.region?.center?.lonDeg].every(Number.isFinite)||Math.abs(p.region.center.latDeg)>90||!Number.isFinite(p.region.supportRadiusM)||p.region.supportRadiusM<=0||p.region.supportRadiusM>base.frame.radiusM*.02||!Number.isFinite(p.settings?.maxIncisionM)||p.settings.maxIncisionM<=0)throw new TypeError('Invalid saved water plan or source world');
  for(const profile of p.profiles)for(const point of profile.points??[])if(greatCircle(p.region.center,point,base.frame.radiusM).distanceM+point.halfWidthM+point.bankWidthM>p.region.supportRadiusM)throw new RangeError('Local river escapes its reserved water footprint');
  const previous=unique.get(p.id);if(previous&&hashJson(previous)!==hashJson(p))throw new Error('Conflicting saved water plans');unique.set(p.id,p);
 }
 const owned=[...unique.values()],active=owned.filter(p=>p.profiles.length);
 for(let i=0;i<active.length;i++)for(let j=i+1;j<active.length;j++)if(greatCircle(active[i].region.center,active[j].region.center,base.frame.radiusM).distanceM<active[i].region.supportRadiusM+active[j].region.supportRadiusM)throw new Error('Overlapping water ownership requires a shared committed plan');
 const count=active.reduce((n,p)=>n+p.profiles.reduce((m,r)=>m+r.points.length,0),0);if(count>32768)throw new RangeError('Loaded local water point budget exceeded');
 const network={schema:PLANET_RIVERS_SCHEMA,bedMethod:SMOOTH_RIVER_BED,radiusM:base.frame.radiusM,grid:base.grid??{columns:128,rows:64},nodes:active.flatMap(p=>p.nodes),profiles:active.flatMap(p=>p.profiles),diagnostics:{maxIncisionM:Math.max(1,...active.map(p=>p.settings.maxIncisionM))}};
 return{network,ids:owned.map(p=>p.id)};
}
export function createMaterializedWaterSurface(base,plans,{sourceWorldId}={}){
 if(!base?.sampleSurfaceAt)throw new TypeError('Physical base sampler required');
 const {network,ids}=compileMaterializedWaterNetwork(base,plans,{sourceWorldId}),active=network.profiles;
 const originalNetwork=base.rawGroundElevationAt?base.toSnapshot().references.rivers:null,combined=originalNetwork?{...originalNetwork,nodes:[...originalNetwork.nodes,...network.nodes],profiles:[...originalNetwork.profiles,...network.profiles],diagnostics:{...originalNetwork.diagnostics,maxIncisionM:Math.max(originalNetwork.diagnostics.maxIncisionM,network.diagnostics.maxIncisionM)}}:network,riverAt=active.length?createSphericalRiverSampler(combined):null;
 const sampleSurfaceAt=(lat,lon)=>{
  const original=base.sampleSurfaceAt(lat,lon);if(!riverAt)return original;
  const river=riverAt(lat,lon,originalNetwork?base.rawGroundElevationAt(lat,lon):original.groundElevationM);
  if(river.groundElevationM===original.groundElevationM&&!river.waterSourceIds.length)return original;
  const ground=river.groundElevationM,reservoir={...original,waterDepthM:original.waterLevelElevationM==null?original.waterDepthM:Math.max(0,original.waterLevelElevationM-ground)},chosen=selectBasePlanetWater(reservoir,river);
  return{...original,...chosen,groundElevationM:ground,waterDepthM:chosen.waterLevelElevationM==null?chosen.waterDepthM:Math.max(0,chosen.waterLevelElevationM-ground),waterSurfaceElevationM:chosen.waterLevelElevationM>ground?chosen.waterLevelElevationM:null};
 };
 const groundElevationAt=(lat,lon)=>sampleSurfaceAt(lat,lon).groundElevationM;
 const sampleAt=(lat,lon)=>{const s=sampleSurfaceAt(lat,lon),step=base.derivativeStepM??1,at=(e,n)=>{const p=offsetGeographic({latDeg:lat,lonDeg:lon},e,n,base.frame.radiusM);return groundElevationAt(p.latDeg,p.lonDeg);},east=(at(step,0)-at(-step,0))/(2*step),north=(at(0,step)-at(0,-step))/(2*step);return{...s,gradientEastNorth:{east,north},slopeMPerM:Math.hypot(east,north)};};
 return Object.freeze({...base,materializedWaterIds:Object.freeze(ids),sampleSurfaceAt,sampleAt,groundElevationAt,localWaterNetwork:()=>copyJson(network),toSnapshot(){throw new Error('Save the immutable base and committed water records together; a materialized view is not a base snapshot');}});
}
