import {WATER_FIRST_POPULATION,SHARED_REGIONAL_WATER} from '../src/core/water-first-population-region.mjs';
import {DEFERRED_POPULATION} from '../src/core/population-zones.mjs';
import {climateTravelResistance} from '../src/core/environment-cover.mjs';
import {planSettlementDistricts} from '../src/core/settlement-districts.mjs';
import {createSettlementWaterIndex,isWaterLedSiting} from '../src/core/settlement-water-access.mjs';
import {villageStreetContexts} from '../src/core/village-street-context.mjs';
import {planLandRoadCorridor} from '../src/core/lake-road-corridor.mjs';
import {planRegionalRoadNetwork} from '../src/core/regional-road-network.mjs';
import {planSettlementRoadTree} from '../src/core/settlement-road-tree.mjs';
import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';
import {sitePopulationRegion,catalogueRegionBound,SETTLEMENT_CATALOGUE_METHOD,SETTLEMENT_RUNTIME_VERSION} from '../src/core/settlement-catalogue.mjs';
import {hashJson} from '../src/core/json-contract.mjs';
export {createSettlementRegionPlanner} from '../src/core/settlement-region-planner.mjs';
import {createSettlementRegionPlanner} from '../src/core/settlement-region-planner.mjs';
export function packageSettlements(world,directory,{deferred=false,waterFirst=false,unpopulatedWater=false}={}){
 if(!world.population)return null;
 if(unpopulatedWater&&!waterFirst)throw new Error('Unpopulated water requires deferred water');
 if(waterFirst&&!deferred)throw new Error('Deferred water requires deferred population ownership');
 if(deferred)return packageDeferredPopulation(world,{waterFirst,unpopulatedWater});
 const dir=path.join(directory,'settlements');fs.mkdirSync(dir,{recursive:true});
 const planner=createSettlementRegionPlanner(world),{terrain,waterIndex}=planner;
 const waterExamples=[],waterTotals={accepted:0,proposed:0,rejected:0,approachSamples:0};
 let maximumSettlementExtentM=0;
 const regions=[],landmarks=[],roadRoots=[],totals={requested:0,placed:0,unplaced:0,placedPopulation:0,unplacedPopulation:0,bytes:0};
 for(const c of world.population.cells){if(!c.population)continue;
  const region=planner.plan(c.cellIndex);
  for(const site of region.sites)maximumSettlementExtentM=Math.max(maximumSettlementExtentM,planSettlementDistricts(site,world.base.frame.radiusM).extentM+100);
  if(waterIndex){for(const k of Object.keys(waterTotals))waterTotals[k]+=region.survey.water[k];for(const site of region.sites)if(site.siting.waterAccess.status==='sampled-river-approach'&&waterExamples.length<128){const {id,name,kind,population,latDeg,lonDeg}=site,access=site.siting.waterAccess;waterExamples.push({id,name,kind,population,latDeg,lonDeg,sourceId:access.sourceId,approachDistanceM:access.distanceM});}}
  if(region.roadNetwork.rootId)roadRoots.push(region.sites.find(s=>s.id===region.roadNetwork.rootId));
  const text=JSON.stringify(region),bytes=Buffer.byteLength(text),file=`settlements/${c.cellIndex}.json`;
  fs.writeFileSync(path.join(directory,file),text);regions.push({cellIndex:c.cellIndex,path:file,bytes,sha256:createHash('sha256').update(text).digest('hex'),count:region.sites.length,...catalogueRegionBound(world.population.grid,c.cellIndex)});
  totals.requested+=region.requested;totals.placed+=region.sites.length;totals.unplaced+=region.requested-region.sites.length;totals.placedPopulation+=region.populations.placed;totals.unplacedPopulation+=region.populations.unplaced;totals.bytes+=bytes;
  // A bounded global overview, not all village DOM elements.
  landmarks.push(...region.sites.filter(s=>s.kind==='city'));if(!region.sites.some(s=>s.kind==='city')){const representative=region.sites.find(s=>s.kind==='town')??region.sites[0];if(representative)landmarks.push(representative);}
 }
 const content={schema:'settlement-catalogue@1',maximumSettlementExtentM,runtimeVersion:SETTLEMENT_RUNTIME_VERSION,method:waterIndex?waterIndex.method:SETTLEMENT_CATALOGUE_METHOD,...(waterIndex?{waterSitingIndex:waterIndex.diagnostics,waterAccess:{...waterTotals,examples:waterExamples,scope:'Bounded sampled river approaches only; unlisted settlements have no established water-access claim. Wells, springs and lake access not surveyed.'}}:{}),riverCrossingPolicy:'bounded-game-timber-crossings@2',baseWorldId:world.base.worldId,populationId:world.population.id,grid:world.population.grid,regions,landmarks,roadNetwork:planRegionalRoadNetwork(terrain,[...roadRoots,...world.settlements],world.climate?.catchmentWater?{travelResistance:climateTravelResistance(world.climate)}:{}),totals,limitations:['Local water/grade screening, not complete municipal planning','Rejected population remains unplaced','Existing detailed settlements are anchors, not added census population']};
 return{...content,id:hashJson(content)};
}

/** Pick a real population-catalogue village as the initial view. The old small
 * construction fixtures remain inspectable, but are not the default example of
 * the complete settlement system. This never relocates or creates a site. */
export function selectPopulationStart(world,{maxRegions=8,planner=null}={}){
 if(!Number.isInteger(maxRegions)||maxRegions<1||maxRegions>16)throw new RangeError('Invalid initial-view search budget');
 if(!world.population)return null;planner??=createSettlementRegionPlanner(world);
 const cells=world.population.cells,indices=[...new Set([...(world.settlements??[]).map(s=>s.cellIndex),...cells.filter(c=>c.villages>0).sort((a,b)=>b.suitability-a.suitability||a.cellIndex-b.cellIndex).map(c=>c.cellIndex)])].filter(i=>Number.isInteger(i)&&cells[i]?.villages>0).slice(0,maxRegions);
 const candidates=[];for(const index of indices){const region=planner.plan(index);for(const s of region.sites)if(s.kind==='village'&&s.population>0)candidates.push(s);}
 candidates.sort((a,b)=>Number(b.siting?.waterAccess?.status==='sampled-river-approach')-Number(a.siting?.waterAccess?.status==='sampled-river-approach')||(a.siting?.gradeMPerM??1)-(b.siting?.gradeMPerM??1)||a.id.localeCompare(b.id));
 const site=candidates[0];return site?{id:site.id,name:site.name,latDeg:site.latDeg,lonDeg:site.lonDeg,cellIndex:site.cellIndex,population:site.population,source:'saved-population-catalogue',surveyedRegions:indices.length,waterAccess:site.siting?.waterAccess?.status??'not-established'}:null;
}

/** Global census overview only: zero local settlement surveys at publication. */
export function packageDeferredPopulation(world,{waterFirst=false,unpopulatedWater=false}={}){
 if(unpopulatedWater&&!waterFirst)throw new Error('Unpopulated water requires deferred water');
 const population=world.population;if(!population)return null;
 const requested=population.totals.villages+population.totals.towns+population.totals.cities;
 const content={schema:'settlement-catalogue@1',method:DEFERRED_POPULATION,...(waterFirst?{waterMaterializationPolicy:unpopulatedWater?SHARED_REGIONAL_WATER:WATER_FIRST_POPULATION}:{}),interZoneRoadPolicy:'adjacent-committed-sites@1',runtimeVersion:SETTLEMENT_RUNTIME_VERSION,baseWorldId:world.base.worldId,populationId:population.id,grid:population.grid,maximumSettlementExtentM:46000,regions:[],landmarks:[],roadNetwork:{links:[]},riverCrossingPolicy:'bounded-game-timber-crossings@2',totals:{requested,placed:0,unplaced:0,deferred:requested,placedPopulation:0,unplacedPopulation:0,deferredPopulation:population.totals.supportedPopulation,bytes:0},limitations:['Positions are saved on first reference, not globally surveyed','Adjacent populated zones propose saved links; local terrain surveys may leave them blocked; no guarantee of a globally connected road graph','Water refinement remains the separately saved bounded network']};
 return{...content,id:hashJson(content)};
}
