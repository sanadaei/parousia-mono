import {usesSharedWater,waterRegionsNear,materializeWaterReferenceRegion} from '../core/water-reference-regions.mjs';
import {WATER_FIRST_ALL_ZONES,usesWaterFirst,materializeWaterFirstPopulationRegion} from '../core/water-first-population-region.mjs';
import {readPage} from './page-request.mjs';
import {restorePlanetWorld} from '../core/planet-world.mjs';
import {CommittedMaterializer} from '../core/committed-materialization.mjs';
import {PopulationZoneHierarchy,populationRootZone,surveyPopulationZoneWeights,isLocalPopulationZone} from '../core/population-zones.mjs';
import {createSettlementRegionPlanner} from '../core/settlement-region-planner.mjs';
import {sphereBasis} from '../core/spherical.mjs';
import {createBrowserMaterializationStorage} from './materialization-storage.mjs';
import {cooperativeYield} from './cooperative-yield.mjs';
import {ByteLRU} from './lru.mjs';
import {sharedPopulationEdge,commitPopulationZoneRoad} from '../core/population-zone-roads.mjs';
import {regionalRoadSegments} from '../core/regional-road-network.mjs';
export {DEFERRED_POPULATION} from '../core/population-zones.mjs';
// One decoded snapshot per manifest/fetcher/URL in this JS context. Labels,
// camera tracking and feature preparation must not each retain another world.
// Weak ownership releases the snapshot when the old manifest is discarded.
const sharedWorlds=new WeakMap();
async function sharedWorld(manifest,url,fetcher){
 let byFetcher=sharedWorlds.get(manifest);if(!byFetcher){byFetcher=new WeakMap();sharedWorlds.set(manifest,byFetcher);}
 let byURL=byFetcher.get(fetcher);if(!byURL){byURL=new Map();byFetcher.set(fetcher,byURL);}
 const key=new URL(manifest.planetSnapshot,url).href;let pending=byURL.get(key);
 if(!pending){pending=(async()=>{const text=await readPage(fetcher,key,{kind:'text',maxBytes:32*1024*1024});const world=restorePlanetWorld(text);if(world.worldId!==manifest.canonicalWorldId||world.population?.id!==manifest.population?.id)throw new Error('Deferred population snapshot does not match this world');return world;})();byURL.set(key,pending);pending.catch(()=>{if(byURL.get(key)===pending)byURL.delete(key);});}
 return pending;
}

export function zoneDescriptor(zone){const b=zone.bounds,latDeg=(b.north+b.south)/2,lonDeg=(b.east+b.west)/2;return{cellIndex:zone.rootCell,zone,path:`materialized:${zone.id}`,count:zone.villages+zone.towns+zone.cities,bytes:32768,center:sphereBasis({latDeg,lonDeg}).up,angularRadius:((b.north-b.south)/2+(b.east-b.west)/2)*Math.PI/180};}
function intersects(r,bound,padding){return Math.acos(Math.max(-1,Math.min(1,r.center.reduce((s,v,i)=>s+v*bound.center[i],0))))<=r.angularRadius+bound.angular+padding;}
/** Runtime distribution -> saved leaf plan. Only coarse world fields are loaded
 * up front; no list of worldwide settlement positions is constructed. */
export class DeferredPopulationPages{
 constructor(manifest,url,fetcher,{storage=createBrowserMaterializationStorage()}={}){this.manifest=manifest;this.url=url;this.fetcher=fetcher;this.storage=storage;this.cache=new ByteLRU(8*1024*1024);this.pending=null;this.lastZones=[];}
 async init(signal){
  if(this.world)return;if(!this.storage)throw new Error('必要時に集落を確定する世界には保存領域が必要です');
  this.pending??=(async()=>{const world=await sharedWorld(this.manifest,this.url,this.fetcher);if(signal?.aborted)throw new DOMException('Cancelled','AbortError');
   this.materializer=new CommittedMaterializer(this.storage);this.hierarchy=new PopulationZoneHierarchy(world.population,this.materializer,{survey:async bounds=>{await cooperativeYield();return surveyPopulationZoneWeights(world.base,world.population,bounds);},conditions:{landscapeId:world.landscape?.profile??null}});this.planner=usesWaterFirst(this.manifest.settlementCatalogue?.waterMaterializationPolicy)?null:createSettlementRegionPlanner(world);this.allRoots=world.population.cells.map(c=>zoneDescriptor(populationRootZone(world.population,c.cellIndex)));this.roots=this.allRoots.filter(r=>r.zone.population>0);this.world=world;
  })();try{await this.pending;}catch(e){this.pending=null;throw e;}
 }
 async descriptors(bound,signal,paddingM=0,{maxNodes=512,maxLeaves=64,observe=true,includeEmpty=false}={}){
  await this.init(signal);const radius=this.world.base.frame.radiusM,padding=paddingM/radius,queue=(includeEmpty?this.allRoots:this.roots).filter(r=>intersects(r,bound,padding)),result=[],observed=[];let visited=0;
  while(queue.length){if(signal?.aborted)throw new DOMException('Cancelled','AbortError');if(++visited>maxNodes)throw new RangeError('人口ゾーンの調査範囲が広すぎます。さらに近づいてください');
   const r=queue.shift(),z=r.zone;if(!intersects(r,bound,padding))continue;if(!z.population&&!includeEmpty){observed.push(z);continue;}const b=z.bounds,spanM=Math.max(b.north-b.south,(b.east-b.west)*Math.cos((b.north+b.south)*Math.PI/360))*Math.PI/180*radius;
   if(isLocalPopulationZone(z,radius)){result.push(r);observed.push(z);if(result.length>maxLeaves)throw new RangeError('人口ゾーンの表示予算を超えました。さらに近づいてください');continue;}
   const split=await this.hierarchy.split(z,signal);if(split.unallocatedPopulation){observed.push({...z,status:'unallocated'});continue;}for(const child of split.children)queue.push(zoneDescriptor(child));
  }
  if(observe)this.lastZones=observed.slice(0,128);return result;
 }
 /** View-scale census summaries only. Never requests positions, roads, water
  * plans, buildings or vegetation. Budget exhaustion retains coarse parents. */
 async summaries(bound,signal,{targetSpanM=50000,maxNodes=256,maxZones=128}={}){
  if(!Number.isFinite(targetSpanM)||targetSpanM<=0||!Number.isSafeInteger(maxNodes)||maxNodes<1||maxNodes>2048||!Number.isSafeInteger(maxZones)||maxZones<1||maxZones>128||!Array.isArray(bound?.center)||bound.center.length!==3||!bound.center.every(Number.isFinite)||!Number.isFinite(bound.angular)||bound.angular<0||bound.angular>Math.PI)throw new RangeError('Invalid population summary budget');
  if(signal?.aborted)throw new DOMException('Cancelled','AbortError');
  if(Math.abs(Math.hypot(...bound.center)-1)>1e-6)throw new RangeError('Population summary center must be a unit vector');
  await this.init(signal);const radius=this.world.base.frame.radiusM,roots=this.roots.filter(r=>intersects(r,bound,0));
  if(roots.length>maxZones)return{zones:[],status:'global-census',splitCount:0,limited:true};
  const shown=new Map(roots.map(r=>[r.zone.id,r.zone])),queue=[...roots];let splitCount=0,limited=false;
  while(queue.length){if(signal?.aborted)throw new DOMException('Cancelled','AbortError');const r=queue.shift(),z=r.zone,b=z.bounds,spanM=Math.max(b.north-b.south,(b.east-b.west)*Math.cos((b.north+b.south)*Math.PI/360))*Math.PI/180*radius;
   if(spanM<=targetSpanM||isLocalPopulationZone(z,radius)||!z.population)continue;
   if(splitCount>=maxNodes){limited=true;break;}
   // Four children is an upper bound. Do not subdivide merely to discover that
   // the display has no room for them; leave the authoritative parent visible.
   if(shown.size+3>maxZones){limited=true;continue;}
   const split=await this.hierarchy.split(z,signal);splitCount++;
   if(split.unallocatedPopulation){shown.set(z.id,{...z,status:'unallocated'});continue;}
   const children=split.children.map(zoneDescriptor).filter(c=>intersects(c,bound,0));if(!children.length)continue;
   shown.delete(z.id);for(const child of children){shown.set(child.zone.id,child.zone);queue.push(child);}
  }
  return{zones:[...shown.values()].sort((a,b)=>a.id.localeCompare(b.id)),status:limited?'bounded-summary':'view-summary',splitCount,limited};
 }
 async region(zone,signal){await this.init(signal);if(!isLocalPopulationZone(zone,this.world.base.frame.radiusM))throw new Error('Only local leaf zones can commit settlement positions');const cached=this.cache.get(zone.id);if(cached)return JSON.parse(cached);await cooperativeYield();const region=usesWaterFirst(this.manifest.settlementCatalogue?.waterMaterializationPolicy)?await materializeWaterFirstPopulationRegion(this.world,zone,this.materializer,{signal,policy:this.manifest.settlementCatalogue.waterMaterializationPolicy}):await this.materializer.resolve({worldId:this.world.worldId,entityId:`sites:${zone.id}`,conditions:{populationId:this.world.population.id,zone,landscape:this.world.landscape??null,anchors:this.world.settlements},generator:'population-zone-sites@1',signal,generate:()=>this.planner.plan(zone.rootCell,{zone})});const text=JSON.stringify(region);this.cache.put(zone.id,text,text.length*2);return region;}
 /** Every eligible endpoint of a <=60 km link influencing this view lies
  * within 60 km + 16 km local search allowance. Query that full neighbourhood,
  * not whichever leaves happen to be loaded by the camera. */
 async roadLinks(bound,signal){
  if(this.manifest.settlementCatalogue?.interZoneRoadPolicy!=='adjacent-committed-sites@1')return[];
  const regions=await this.descriptors(bound,signal,76000,{maxNodes:2048,maxLeaves:128,observe:false}),pages=[];let sites=0;
  for(const r of regions){const page=await this.region(r.zone,signal);sites+=page.sites.length;if(sites>8192)throw new RangeError('Inter-zone road neighbourhood exceeds site budget');pages.push({zone:r.zone,region:page});}
  const links=[];
  for(let i=0;i<pages.length;i++)for(let j=i+1;j<pages.length;j++){
   const a=pages[i],b=pages[j];if(!sharedPopulationEdge(a.zone,b.zone))continue;
   await cooperativeYield();const result=await commitPopulationZoneRoad(this.materializer,{worldId:this.world.worldId,zoneA:a.zone,regionA:a.region,zoneB:b.zone,regionB:b.region,radiusM:this.world.base.frame.radiusM,signal});
   if(result.link&&regionalRoadSegments(result.link,this.world.base.frame.radiusM,20000,bound).length)links.push(result.link);
  }
  return links;
 }
 async waterPlansNear(bound,signal){
  if(!usesWaterFirst(this.manifest.settlementCatalogue?.waterMaterializationPolicy)||bound.angular>.012)return[];
  if(usesSharedWater(this.manifest.settlementCatalogue.waterMaterializationPolicy)){const policy=this.manifest.settlementCatalogue.waterMaterializationPolicy;await this.init(signal);const plans=[];for(const owner of waterRegionsNear(this.world,bound,{policy})){await cooperativeYield();const r=await materializeWaterReferenceRegion(this.world,owner,this.materializer,{signal,policy});if(r.plan?.profiles.length)plans.push(r.plan);}return plans;}
  const descriptors=await this.descriptors(bound,signal,0,{maxNodes:2048,maxLeaves:128,observe:false,includeEmpty:this.manifest.settlementCatalogue.waterMaterializationPolicy===WATER_FIRST_ALL_ZONES}),plans=[];
  for(const descriptor of descriptors){const region=await this.region(descriptor.zone,signal);if(region.localWater?.plan?.profiles.length)plans.push(region.localWater.plan);}
  return plans;
 }
 async getSite(id,signal){const match=/^(population-zone:(\d+)((?:\/[0-3]){0,12}))\/site:(\d+)$/.exec(id??'');if(!match)return null;await this.init(signal);let zone=this.hierarchy.root(Number(match[2]));for(const part of match[3].split('/').filter(Boolean)){if(isLocalPopulationZone(zone,this.world.base.frame.radiusM))return null;zone=(await this.hierarchy.split(zone,signal)).children[Number(part)];}if(!isLocalPopulationZone(zone,this.world.base.frame.radiusM))return null;return(await this.region(zone,signal)).sites.find(s=>s.id===id)??null;}
}
