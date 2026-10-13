import {SHARED_WATER_REGIONS,SHARED_REGIONAL_WATER,usesSharedWater,containsWaterDisc,selectOwnedWaterPlan,waterRegionForPopulationZone,materializeWaterReferenceRegion} from './water-reference-regions.mjs';
export {SHARED_WATER_REGIONS,SHARED_REGIONAL_WATER,usesSharedWater,containsWaterDisc} from './water-reference-regions.mjs';
import {createMaterializedWaterSurface} from './materialized-water-surface.mjs';
import {createSettlementRegionPlanner} from './settlement-region-planner.mjs';
import {validatePopulationZone,isLocalPopulationZone} from './population-zones.mjs';
export const WATER_FIRST_POPULATION='settlement-zone-interior-water@1';
export const WATER_FIRST_ALL_ZONES='all-zone-interior-water@1';
export const usesWaterFirst=policy=>[WATER_FIRST_POPULATION,WATER_FIRST_ALL_ZONES,SHARED_WATER_REGIONS,SHARED_REGIONAL_WATER].includes(policy);
// Canonical restored worlds are immutable. Reuse their unchanged no-local-water
// planner instead of cloning the entire base and indexing all rivers per leaf.
const basePlanners=new WeakMap();
function basePlanner(world){let planner=basePlanners.get(world);if(!planner){planner=createSettlementRegionPlanner(world);basePlanners.set(world,planner);}return planner;}
/** Legacy worlds embed the physical water plan with sites. Shared-region worlds
 * first commit one water owner, then retain its identity with each site region.
 * No houses are generated here; an existing sites record is never rewritten. */
export async function materializeWaterFirstPopulationRegion(world,zone,materializer,{signal,policy=WATER_FIRST_POPULATION}={}){
 if(!usesWaterFirst(policy))throw new TypeError('Unknown water materialization policy');
 validatePopulationZone(zone);if(!isLocalPopulationZone(zone,world.base.frame.radiusM))throw new Error('Water-first ownership requires a local leaf zone');
 const conditions={populationId:world.population.id,zone,landscape:world.landscape??null,anchors:world.settlements,waterPolicy:policy};
 return materializer.resolve({worldId:world.worldId,entityId:`water-first-sites:${zone.id}`,conditions,generator:policy,signal,generate:async()=>{
  const radius=world.base.frame.radiusM,owner=usesSharedWater(policy)?waterRegionForPopulationZone(world,zone,{policy}):zone;
  const waterPlan=usesSharedWater(policy)?(await materializeWaterReferenceRegion(world,owner,materializer,{signal,policy})).plan:await selectOwnedWaterPlan(world,zone,materializer,{signal});
  let planner;
  if(waterPlan?.profiles.length){
   if(!containsWaterDisc(owner,waterPlan.region.center,waterPlan.region.supportRadiusM,radius))throw new Error('Saved water escapes its reserved ownership');
   const network=world.base.toSnapshot().references.rivers;
   const surface=createMaterializedWaterSurface(world.base,[waterPlan],{sourceWorldId:world.worldId}),extra=surface.localWaterNetwork(),waterNetwork={...network,nodes:[...network.nodes,...extra.nodes],profiles:[...network.profiles,...extra.profiles]};planner=createSettlementRegionPlanner(world,{surface,waterNetwork});
  }else planner=basePlanner(world);
  const region=planner.plan(zone.rootCell,{zone});
  return{...region,localWater:{policy,status:waterPlan?.profiles.length?'physical-plan-before-sites':waterPlan?'no-channel-accepted':'no-owned-reference',...(usesSharedWater(policy)?{ownerId:owner.id,planId:waterPlan?.id??null}:{plan:waterPlan}),scope:'Bounded interior tributaries only; empty-zone coverage depends on publication policy; cross-boundary hydrology remains incomplete'}};
 }});
}
