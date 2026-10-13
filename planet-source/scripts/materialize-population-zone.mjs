import fs from'node:fs';import path from'node:path';import {fileURLToPath}from'node:url';
import {restorePlanetWorld}from'../src/core/planet-world.mjs';
import {CommittedMaterializer}from'../src/core/committed-materialization.mjs';
import {PopulationZoneHierarchy,surveyPopulationZoneWeights,populationZoneAreaM2,isLocalPopulationZone,containsPopulationZone}from'../src/core/population-zones.mjs';
import {createSettlementRegionPlanner}from'../src/core/settlement-region-planner.mjs';
import {createFileMaterializationStorage}from'./materialization-file-store.mjs';
/** Real census -> bounded saved subdivisions -> actual existing settlement
 * planner. This entry point does not enumerate the rest of the planet. */
export async function materializePopulationZone(world,saveDirectory,{latDeg=world.focus.latDeg,lonDeg=world.focus.lonDeg,depth=12,storage=null}={}){
 if(!world.population)throw new Error('A saved population scenario is required');
 if(world.settlementCatalogue?.regions?.length)throw new Error('This world already has committed settlement positions; migrating them requires an explicit import, not a second census.');
 const pop=world.population,{columns:w,rows:h}=pop.grid;
 if(!Number.isFinite(latDeg)||latDeg< -90||latDeg>90||!Number.isFinite(lonDeg))throw new RangeError('Invalid reference coordinates');
 const cell=Math.min(h-1,Math.floor((90-latDeg)/180*h))*w+Math.floor(((lonDeg%360+360)%360)/360*w),
 materializer=new CommittedMaterializer(storage??createFileMaterializationStorage(saveDirectory)),hierarchy=new PopulationZoneHierarchy(pop,materializer,{survey:bounds=>surveyPopulationZoneWeights(world.base,pop,bounds),conditions:{landscapeId:world.landscape?.profile??null}});
 if(!Number.isInteger(depth)||depth<0||depth>12)throw new RangeError('Invalid maximum subdivision depth');
 let zone=hierarchy.root(cell),status='distribution-only';const ancestry=[];
 while(!isLocalPopulationZone(zone,world.base.frame.radiusM)&&zone.depth<depth){const split=await hierarchy.split(zone);ancestry.push({parentId:zone.id,unallocatedPopulation:split.unallocatedPopulation});if(split.unallocatedPopulation){status='unallocated';break;}zone=split.children.find(c=>containsPopulationZone(c,latDeg,lonDeg));}
 const selection={zone,status,ancestry};
 if(selection.status==='unallocated')return{selection,region:null,reason:'No sampled suitable child land; population remains explicitly unallocated.'};
 if(!isLocalPopulationZone(zone,world.base.frame.radiusM))return{selection,region:null,reason:'More detailed reference required; do not create overlapping parent/child village plans.'};
 const planner=createSettlementRegionPlanner(world),region=await materializer.resolve({worldId:world.worldId??world.base.worldId,entityId:`sites:${zone.id}`,conditions:{populationId:pop.id,zone,landscape:world.landscape??null,anchors:world.settlements},generator:'population-zone-sites@1',generate:()=>planner.plan(cell,{zone})});
 return{selection,areaKm2:populationZoneAreaM2(zone,world.base.frame.radiusM)/1e6,region,scope:'Only this referenced population zone is sited. Local housing and worldwide water refinement are separate stages.'};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{const [snapshot,directory,lat,lon,depth]=process.argv.slice(2);if(!snapshot||!directory)throw new Error('Usage: materialize-population-zone.mjs world.snapshot.json save-directory [lat lon depth]');
  const world=restorePlanetWorld(fs.readFileSync(snapshot,'utf8')),result=await materializePopulationZone(world,directory,{...(lat!=null?{latDeg:Number(lat)}:{}),...(lon!=null?{lonDeg:Number(lon)}:{}),...(depth!=null?{depth:Number(depth)}:{})});process.stdout.write(JSON.stringify(result,null,2)+'\n');
 }catch(e){console.error(e.stack??e.message);process.exitCode=1;}
}
