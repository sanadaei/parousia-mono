import {createShapeFirstPlanetRegion} from './shape-first-planet.mjs';
import {usesEnvironmentPolicy,environmentRiverReach,VALLEY_ENVIRONMENT_POLICY} from '../core/environment-cover.mjs';
import {commitRiverCrossingSites} from '../core/river-crossing-sites.mjs';
import {ResumableRoadSurvey,RoadSurveyPending} from './resumable-road-survey.mjs';
import {localRoadSurveyIntersects} from '../core/regional-road-network.mjs';
import {usesWaterFirst} from '../core/water-first-population-region.mjs';
import {compileMaterializedWaterNetwork} from '../core/materialized-water-surface.mjs';
import {hashJson} from '../core/json-contract.mjs';
import {CommittedMaterializer} from '../core/committed-materialization.mjs';
import {createBrowserMaterializationStorage} from './materialization-storage.mjs';
import {createUrbanLandClearance,URBAN_LAND_TRANSITION} from '../core/urban-land-clearance.mjs';
import {cutParcelRoads} from '../core/parcel-road-cutouts.mjs';
import {cooperativeYield} from './cooperative-yield.mjs';
import {compactSettlementLand,createSettlementLandClearance} from '../core/settlement-land-clearance.mjs';
import {planSettlementDistricts} from '../core/settlement-districts.mjs';
import {compactRoadClearance,createLandscapeRoadClearance} from '../core/landscape-road-clearance.mjs';
import {createRegionalLandscape,createWoodlandRecipe} from '../core/regional-landscape.mjs';
import {indexedSettlementRoadObstacles} from '../core/settlement-land-reservations.mjs';
import {createAgricultureRecipe} from '../core/settlement-agriculture.mjs';
import {iterateLocalRoadRoute,createLocalRoadRecipe} from '../core/local-road-route.mjs';
import {SettlementPages} from './settlement-pages.mjs';
import {createSettlementLayout} from '../core/settlement-layout.mjs';
import { isAnchoredDetailMethod } from '../core/shore-detail.mjs';
import { createSphericalRiverSampler } from '../core/planet-rivers.mjs';
import { readPage } from './page-request.mjs';
import { validateSeaLevel, sampleSeaLevel, mergeSeaLevel, createPlanetWaterSampler, selectBasePlanetWater } from '../core/sea-level.mjs';
import { ByteLRU } from './lru.mjs';
import { createPeriodicHermiteAccessor } from '../core/hermite-kernel.mjs';
import { createGlobalFieldEvaluator } from '../core/global-field-evaluator.mjs';
import { createAnchoredSphericalDetail, ANCHORED_DETAIL_METHOD } from '../core/spherical-detail.mjs';
import { createSphericalProjection, geographicPoint, sphereBasis, greatCircle } from '../core/spherical.mjs';
import { createHash } from '../core/sha256.mjs';
import { createGlobeFeatureChart } from '../core/globe-features.mjs';
import { terrainSlopeBound } from './lod.mjs';

// Stable function identity lets same-context sources share one decoded snapshot.
const defaultPageFetcher=(...args)=>fetch(...args);
class MissingPage extends Error { constructor(key) { super(key); this.key = key; } }
export class PagedSource {
  constructor(manifest, url, fetcher = defaultPageFetcher, {materializationStorage=createBrowserMaterializationStorage()}={}) {
    this.roadSurveys=new ResumableRoadSurvey();
    this.materializer=materializationStorage?new CommittedMaterializer(materializationStorage):null;
    this.materializationMode=this.materializer?'first-reference-saved':'regenerated-no-durable-store';
    if (manifest.schema !== 'minimal-world-globe-pages@1') throw new TypeError('Unsupported page manifest');
    if(manifest.baseWaterPolicy!=null&&!['explicit-charts-only@1','base-water-outside-charts@1'].includes(manifest.baseWaterPolicy))throw new TypeError('Unsupported page base water policy');
    validateSeaLevel(manifest.sea, manifest.base.frame.verticalDatum);
    if(manifest.localPonds&&manifest.localPonds.radiusM!==manifest.base.frame.radiusM)throw new RangeError('Local pond frame differs from paged terrain');
    this.planetWater = createPlanetWaterSampler(manifest.sea, manifest.lakes ?? [], manifest.base.grid, manifest.localPonds);
    if(manifest.rivers&&(manifest.rivers.radiusM!==manifest.base.frame.radiusM||manifest.rivers.grid?.columns!==manifest.base.grid.columns||manifest.rivers.grid?.rows!==manifest.base.grid.rows))throw new RangeError('River frame differs from paged terrain');
    this.riverAt=createSphericalRiverSampler(manifest.rivers);this.legacyRiverAt=this.riverAt;
    this.landscape=manifest.landscape?createRegionalLandscape(manifest.landscape,manifest.base.frame.radiusM):null;
    this.shapeFirstRegion=createShapeFirstPlanetRegion(manifest.shapeFirstRegion);
    if(this.shapeFirstRegion){const legacy=this.riverAt,region=this.shapeFirstRegion;
      const intersects=(directions,options={})=>{const local=directions.map(d=>region.local(Math.atan2(d[2],Math.hypot(d[0],d[1]))*180/Math.PI,Math.atan2(d[1],d[0])*180/Math.PI));
        if(local.some(p=>!p)){const center=directions.reduce((s,d)=>s.map((v,i)=>v+d[i]),[0,0,0]),length=Math.hypot(...center),unit=center.map(v=>v/length),angular=Math.max(...directions.map(d=>Math.acos(Math.max(-1,Math.min(1,d.reduce((s,v,i)=>s+v*unit[i],0))))));return region.intersects({center:unit,angular});}
        const box={minXM:Math.min(...local.map(p=>p.xM)),minYM:Math.min(...local.map(p=>p.yM)),maxXM:Math.max(...local.map(p=>p.xM)),maxYM:Math.max(...local.map(p=>p.yM))};const nativeOverlap=box.maxXM>=-100&&box.maxYM>=-100&&box.minXM<=region.extent.widthM+100&&box.minYM<=region.extent.heightM+100;return nativeOverlap&&region.channels.intersectsBounds(box,options)||Boolean(region.connector?.intersectsBounds(box,options));};
      const combined=(...args)=>legacy?.(...args);Object.assign(combined,legacy);combined.intersects=(directions,options)=>intersects(directions,options)||Boolean(legacy?.intersects(directions,options));
      combined.minimumIntersectingHalfWidth=directions=>Math.min(intersects(directions,{waterOnly:true})?Math.min(region.channels.minimumHalfWidthM,region.connector?.minimumHalfWidthM??Infinity):Infinity,legacy?.minimumIntersectingHalfWidth?.(directions)??Infinity);
      combined.groundHeightBounds=(bound,range)=>legacy?.groundHeightBounds(bound,range)??range;this.riverAt=combined;
    }
    this.manifest = manifest; this.url = url; this.fetcher = fetcher; this.settlementPages=new SettlementPages(manifest,url,fetcher,{storage:materializationStorage}); this.proceduralDescriptors=[];
    this.cache = new ByteLRU(256 * 1024); this.anchors = new ByteLRU(128 * 1024);
    this.featureCache = new ByteLRU(8 * 1024 * 1024);
    this.featureFootprints = new ByteLRU(128 * 1024);
    this.roadClearances = new ByteLRU(8 * 1024 * 1024);
    // Share the previous8MiB settlement budget: compact clearances6MiB,
    // serialized deterministic recipes2MiB. Return copies, never mutable cache values.
    this.settlementLand = new ByteLRU(6 * 1024 * 1024);
    this.settlementRecipes = new ByteLRU(2 * 1024 * 1024);
    // Rendering normals only: exact coordinate keys, one immutable world,
    // bounded entries, invalidated whenever the active feature set changes.
    this.meshNormals={entries:new Map(),limit:4096,revision:-1,step:null,hits:0,misses:0,evictions:0,newest:null};
    this.requests = 0; this.downloadBytes = 0; this.peakCacheBytes = 0; this.features = null; this.featureBytes = 0;
    const s = manifest.base, { columns: w, rows: h } = s.grid;
    this.width = w; this.height = h;
    this.patchBytesEstimated=512*(1+(isAnchoredDetailMethod(s.detail.method)?s.detail.bands.length:0));
    const get = (x, y) => this.readCell(x, y);
    const source = new Proxy({}, { get: (_, i) => { const index = Number(i); return get(index % w, Math.floor(index / w)); } });
    const anchored = !isAnchoredDetailMethod(s.detail.method) ? null : createAnchoredSphericalDetail(s, {
      poleMeans: manifest.detailPoleMeans,
      fieldForBand: (band, noise) => createPeriodicHermiteAccessor((x, y) => {
        const key = `${band.id}:${x}:${y}`; let value = this.anchors.get(key);
        if (value === null) { value = noise(sphereBasis(geographicPoint(90 - (y + .5) * 180 / h, (x + .5) * 360 / w)).up); this.anchors.put(key, value, 48); }
        return value;
      }, w, h, {cacheLastPatch:true}),
    });
    this.evaluate = createGlobalFieldEvaluator(s, source, createPeriodicHermiteAccessor(get, w, h, {cacheLastPatch:true}), manifest.poles.north, manifest.poles.south, anchored);
    if(this.shapeFirstRegion){const original=this.evaluate;this.legacyEvaluate=original;this.evaluate=point=>{const shaped=this.shapeSurfaceAt(point.latDeg,point.lonDeg);return shaped?{ground:shaped.groundElevationM}:original(point);};}
    this.base = {worldId:s.worldId,frame:s.frame,groundElevationAt:(lat,lon)=>{const shaped=this.shapeSurfaceAt(lat,lon);if(shaped)return shaped.groundElevationM;const z=this.evaluate(geographicPoint(lat,lon)).ground;return this.riverAt?.(lat,lon,z)?.groundElevationM??z;}};
  }
  shapeSurfaceAt(lat,lon){
    const region=this.shapeFirstRegion,p=region?.local(lat,lon);if(!p)return null;
    const weight=region.weight(p),box={minXM:p.xM,maxXM:p.xM,minYM:p.yM,maxYM:p.yM};
    if(!weight&&!region.connector?.intersectsBounds(box))return null;
    let groundElevationM,channel=null;
    if(weight===1){channel=region.surface(p);groundElevationM=channel.groundElevationM;}
    else{const raw=this.legacyEvaluate(geographicPoint(lat,lon)).ground,river=this.legacyRiverAt?.(lat,lon,raw),oldGround=river?.groundElevationM??raw;groundElevationM=weight?region.height(p)*weight+oldGround*(1-weight):oldGround;
      if(!weight){const water=selectBasePlanetWater(this.planetWater(lat,lon,oldGround),river);channel={wet:water.waterDepthM>0,waterLevelM:water.waterDepthM>0?water.waterLevelElevationM:null,channelWidthM:null,riverId:water.waterSourceIds?.[0]};}}
    if(region.connector){const joined=region.connector.sample(p.xM,p.yM,groundElevationM,channel?.wet?channel.waterLevelM:null);if(joined.influence>0){groundElevationM=joined.groundElevationM;channel=joined;}}
    const sea=sampleSeaLevel(this.manifest.sea,groundElevationM),channelWet=channel?.wet&&(!(sea.waterDepthM>0)||channel.waterLevelM>=sea.waterLevelElevationM),waterLevelElevationM=channelWet?channel.waterLevelM:sea.waterDepthM>0?sea.waterLevelElevationM:null;
    return{groundElevationM,waterLevelElevationM,waterDepthM:waterLevelElevationM==null?0:Math.max(0,waterLevelElevationM-groundElevationM),waterSurfaceElevationM:waterLevelElevationM,surfaceKind:channelWet?'designed-river':sea.waterDepthM>0?'sea-level-water':'land',waterSourceIds:channelWet?[channel.riverId]:sea.waterSourceIds,roadSurface:null,buildingId:null,hydrologyStatus:'shape-first-designed-provisional',channelWidthM:channelWet?channel.channelWidthM:null,shapeFirst:{id:region.id,xM:p.xM,yM:p.yM,weight,nativeCellSizeM:region.candidate.grid.cellSizeM}};
  }

  meshNormalState(){
    const memo=this.meshNormals;if(!memo)return null;
    const revision=this.featureCache.revision,step=this.manifest.base.derivativeStepM;
    if(memo.revision!==revision||memo.step!==step){memo.entries.clear();memo.newest=null;memo.revision=revision;memo.step=step;}
    return memo;
  }
  getMeshNormal(key){
    const memo=this.meshNormalState();if(!memo)return null;
    const value=memo.entries.get(key);if(!value){memo.misses++;return null;}
    memo.hits++;if(memo.newest!==key){memo.entries.delete(key);memo.entries.set(key,value);memo.newest=key;}
    return value;
  }
  putMeshNormal(key,value){
    const memo=this.meshNormalState();if(!memo)return;
    if(memo.entries.has(key))memo.entries.delete(key);
    if(memo.entries.size>=memo.limit){memo.entries.delete(memo.entries.keys().next().value);memo.evictions++;}
    memo.entries.set(key,value);memo.newest=key;
  }
  rawGroundElevationAt(lat,lon){return this.evaluate(geographicPoint(lat,lon)).ground;}
  readCell(x, y) {
    const size = this.manifest.pageSize, px = Math.floor(x / size), py = Math.floor(y / size), key = `${px}/${py}`;
    const view = this.cache.get(key); if (!view) throw new MissingPage(key);
    const columns = Math.min(size, this.width - px * size);
    return view.getFloat64(((y - py * size) * columns + x - px * size) * 8, true);
  }
  async load(key, signal) {
    if (this.cache.get(key)) return;
    const descriptor = this.manifest.pages[key]; if (!descriptor) throw new Error(`Unknown field page ${key}`);
    const bytes = await readPage(this.fetcher,new URL(descriptor.path,this.url),{signal});
    if (bytes.byteLength !== descriptor.bytes || createHash('sha256').update(new Uint8Array(bytes)).digest('hex') !== descriptor.sha256) throw new Error(`Corrupt field page ${key}`);
    this.requests++; this.downloadBytes += bytes.byteLength;
    this.cache.put(key, new DataView(bytes), bytes.byteLength); this.peakCacheBytes = Math.max(this.peakCacheBytes, this.cache.bytes);
  }
  async ready(fn, signal) {
    for (let tries = 0; tries < 32; tries++) {
      if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
      try { return fn(); } catch (e) { if (!(e instanceof MissingPage)) throw e; await this.load(e.key, signal); }
    }
    throw new Error('Sample neighborhood exceeds cache/retry budget');
  }
  // A work scope pins its complete physical water set through nested and
  // concurrent consumers. Only the first successful preparation of the next
  // idle-to-active scope can replace residency. Durable records are untouched.
  beginWaterWork(){
    if(!(this.waterWorkCount>0))this.waterReplaceOnPrepare=true;
    this.waterWorkCount=(this.waterWorkCount??0)+1;let released=false;
    return()=>{if(!released){released=true;this.waterWorkCount--;}};
  }
  async withWaterWork(work){const release=this.beginWaterWork();try{return await work();}finally{release();}}
  async prepareWater(bound,signal){
    const pages=this.settlementPages.deferred;
    if(!pages||!usesWaterFirst(this.manifest.settlementCatalogue?.waterMaterializationPolicy))return;
    const plans=await pages.waterPlansNear(bound,signal);
    if(signal?.aborted)throw new DOMException('Cancelled','AbortError');
    const replace=this.waterWorkCount>0&&this.waterReplaceOnPrepare,previous=this.materializedWaterPlans??new Map(),next=new Map(replace?[]:previous);let changed=replace&&previous.size>0;
    for(const plan of plans){const old=previous.get(plan.id);if(old&&hashJson(old)!==hashJson(plan))throw new Error('Conflicting committed water in one world');if(!next.has(plan.id)){next.set(plan.id,plan);changed=true;}}
    if(!changed){if(replace)this.waterReplaceOnPrepare=false;return;}
    // Build and validate before publishing. Failed preparation keeps the prior
    // sampler; a completed work scope can page out old regions on its next job.
    const {network:extra}=compileMaterializedWaterNetwork({...this.base,grid:this.manifest.base.grid},[...next.values()],{sourceWorldId:pages.world.worldId}),original=this.manifest.rivers;
    const combined={...original,nodes:[...original.nodes,...extra.nodes],profiles:[...original.profiles,...extra.profiles],diagnostics:{...original.diagnostics,maxIncisionM:Math.max(original.diagnostics.maxIncisionM,extra.diagnostics.maxIncisionM)}};
    const sampler=createSphericalRiverSampler(combined);this.materializedWaterPlans=next;this.riverAt=sampler;if(replace){this.waterReplaceOnPrepare=false;this.preparedSettlementBound=null;this.landCoverContext=null;}
    if(this.meshNormals){this.meshNormals.entries.clear();this.meshNormals.newest=null;}
  }
  async prepareSettlements(bound,signal){return this.withWaterWork(()=>this.prepareSettlementWork(bound,signal));}
  async prepareSettlementWork(bound,signal){
    await this.prepareWater(bound,signal);
    this.proceduralDescriptors=await this.settlementPages.descriptors(bound,signal);this.preparedSettlementBound=bound;
    if(this.landscape){
      const context={...await this.settlementPages.landCoverNeighbors(bound,signal),bound};
      // Only local tiles resolve actual village footprints. Coarse tiles keep
      // an explicit envelope approximation, without surveying whole cities.
      if(context.complete&&bound.angular*this.base.frame.radiusM<=300&&this.manifest.landscape?.parcelTransition==='village-footprints@1'){
        const tile={latDeg:Math.asin(Math.max(-1,Math.min(1,bound.center[2])))*180/Math.PI,lonDeg:Math.atan2(bound.center[1],bound.center[0])*180/Math.PI};
        context.settlementClearance=await this.landscapeSettlementClearance(tile,context.sites,signal);
      }
      this.landCoverContext=context;
    }
  }
  async landscapeSettlementClearance(tile,neighbors,signal){
    if(this.manifest.landscape?.parcelTransition!=='village-footprints@1')return null;
    const radius=this.base.frame.radiusM,sites=neighbors.filter(s=>s.kind==='village'&&s.economicContext?.facilityPolicy==='frontage-service-parcels@2').map(site=>({site,plan:planSettlementDistricts(site,radius),distance:greatCircle(site,tile,radius).distanceM})).filter(c=>c.plan.count<=4&&c.distance<c.plan.extentM+600).sort((a,b)=>a.distance-b.distance||a.site.id.localeCompare(b.site.id)),compacts=[];let count=0;
    for(const {site,plan} of sites){if(count+plan.count>16)continue;count+=plan.count;const owned=[];for(let i=0;i<plan.count;i++){const key=site.id+'/'+i;let compact=this.settlementLand.get(key);if(!compact){const recipe=await this.featureRecipe({procedural:true,site,districtIndex:i},signal);compact=compactSettlementLand(recipe,site.id);this.settlementLand.put(key,compact,JSON.stringify(compact).length*2);}owned.push(compact);}compacts.push(...owned);}
    if(usesEnvironmentPolicy(this.manifest?.landscape?.environmentPolicy)){
      const up=sphereBasis(tile).up;
      for(const descriptor of this.manifest.featureCharts??(this.manifest.features?[this.manifest.features]:[])){
        const angle=Math.acos(Math.max(-1,Math.min(1,up.reduce((v,x,i)=>v+x*descriptor.center[i],0))));
        if(angle>descriptor.angularRadius+600/radius)continue;
        const key='static/'+descriptor.path;let compact=this.settlementLand.get(key);
        if(!compact){const recipe=await this.featureRecipe(descriptor,signal);compact=compactSettlementLand(recipe,recipe.id);this.settlementLand.put(key,compact,Math.max(64,JSON.stringify(compact).length*2));}
        compacts.push(compact);
      }
    }
    const village=createSettlementLandClearance(compacts);
    if(this.manifest.landscape?.urbanParcelTransition!==URBAN_LAND_TRANSITION)return village;
    const towns=neighbors.filter(s=>['town','city'].includes(s.kind)&&s.economicContext?.layoutPolicy==='terrain-led-neighborhood@2').map(site=>({site,distance:greatCircle(site,tile,radius).distanceM,extent:planSettlementDistricts(site,radius).extentM})).filter(c=>c.distance<c.extent+600).sort((a,b)=>a.distance-b.distance||a.site.id.localeCompare(b.site.id)).slice(0,8).map(c=>c.site);
    const urban=createUrbanLandClearance(this.settlementBase(),towns);
    return{occupied:(p,buffer)=>village.occupied(p,buffer),reserved:(id,p)=>urban.reserved(id,p)??village.reserved(id,p),intersectsGeographicTriangle:t=>urban.intersectsGeographicTriangle(t)||village.intersectsGeographicTriangle(t)};
  }
  async crossingSites(descriptor,signal){
    if(!descriptor.roadLink||!this.materializer)throw new TypeError('Saved road descriptor required');
    return this.withWaterWork(async()=>{
      const recipe=await this.featureRecipe(descriptor,signal),route=recipe.routeStatus;
      if(route?.status!=='requires-regional-crossing-plan')return null;
      const base=this.settlementBase(),sampler={...base,sampleSurfaceAt:(lat,lon)=>this.ready(()=>base.sampleSurfaceAt(lat,lon),signal)};
      return commitRiverCrossingSites(this.materializer,{worldId:this.manifest.canonicalWorldId??this.manifest.worldId??this.manifest.base.worldId,baseWorldId:this.manifest.base.worldId,base:sampler,route,signal,yieldWork:cooperativeYield});
    });
  }
  retainRoadWork(keys){this.roadSurveys.retain(keys);}
  settlementBase(){const riverAt=this.riverAt;return {...this.base,sampleSurfaceAt:(lat,lon)=>{const raw=this.evaluate(geographicPoint(lat,lon)).ground,r=riverAt?.(lat,lon,raw),z=r?.groundElevationM??raw,w=this.planetWater(lat,lon,z),water=selectBasePlanetWater(w,r);return{...water,...(usesEnvironmentPolicy(this.manifest.landscape?.environmentPolicy)?{riverEnvironment:riverAt?.nearby(lat,lon,environmentRiverReach(this.manifest.landscape?.environmentPolicy,this.riverAt),{includeValley:this.manifest.landscape?.environmentPolicy===VALLEY_ENVIRONMENT_POLICY})??null}:{}),groundElevationM:z,waterDepthM:water.waterLevelElevationM==null?0:Math.max(0,water.waterLevelElevationM-z)};}};}
  async featureRecipe(descriptor,signal,options={}){return this.withWaterWork(()=>this.resolveFeatureRecipe(descriptor,signal,options));}
  async resolveFeatureRecipe(descriptor,signal,options={}){
    if(descriptor.procedural&&usesWaterFirst(this.manifest.settlementCatalogue?.waterMaterializationPolicy)){
      const road=descriptor.roadLink,p=road?.fromPoint??descriptor.site??descriptor.landscapeTile;
      // A display segment can be much smaller than the complete road recipe.
      // Include the widest 10 km routing margin (plus grid rounding allowance).
      const center=road?sphereBasis(p).up:descriptor.center??(p?sphereBasis(p).up:null);
      const angular=road?(road.distanceM+16000)/this.base.frame.radiusM:descriptor.angularRadius??46000/this.base.frame.radiusM;
      if(center)await this.prepareWater({center,angular},signal);
    }
    if(!descriptor.procedural||!this.materializer)return this.generateFeatureRecipe(descriptor,signal,options);
    const kind=descriptor.roadLink?'road':descriptor.landscapeTile?'landscape':descriptor.agriculturePlot!=null?'agriculture':'settlement';
    const content=descriptor.roadLink??descriptor.landscapeTile??descriptor.site;
    if(!content?.id)throw new Error('Materialized feature needs a stable identity');
    const part=descriptor.agriculturePlot??descriptor.districtIndex??0;
    const recipe=await this.materializer.resolve({
      worldId:this.manifest.canonicalWorldId??this.manifest.worldId??this.manifest.base.worldId,
      entityId:JSON.stringify([kind,content.id,part]),
      conditions:{baseWorldId:this.manifest.base.worldId,catalogueId:this.manifest.settlementCatalogue?.id??null,landscape:this.manifest.landscape??null,content,part},
      generator:'paged-feature@1',signal,generate:()=>this.generateFeatureRecipe(descriptor,signal,options),
    });
    if(descriptor.roadLink)this.roadSurveys?.forget(descriptor.roadLink.id);
    if(descriptor.roadLink&&this.roadClearances){const compact=compactRoadClearance(recipe);this.roadClearances.put(descriptor.roadLink.id,compact,Math.max(64,JSON.stringify(compact).length*2));}
    return recipe;
  }
  async generateFeatureRecipe(descriptor,signal,options={}){
    if(descriptor.roadLink&&options.roadWorkSteps&&this.roadSurveys.job&&this.roadSurveys.job.key!==descriptor.roadLink.id)throw new RoadSurveyPending();
    if(signal?.aborted)throw new DOMException('Cancelled','AbortError');
    if(descriptor.procedural){
      const recipeKey=descriptor.site&&descriptor.agriculturePlot==null&&!descriptor.roadLink&&!descriptor.landscapeTile?JSON.stringify([descriptor.site,descriptor.districtIndex??0]):null;
      if(recipeKey){const saved=this.settlementRecipes?.get(recipeKey);if(saved)return JSON.parse(saved);}
      const base=this.settlementBase();
      const nearbySettlements=descriptor.site?await this.settlementPages.settlementNeighbors(descriptor.site,signal):[];
      if(descriptor.landscapeTile){const tile=descriptor.landscapeTile,neighbors=await this.settlementPages.roadNeighbors({fromPoint:tile,toPoint:tile,distanceM:0},signal),settlementClearance=await this.landscapeSettlementClearance(tile,neighbors,signal),landscape=await this.ready(()=>createWoodlandRecipe(base,this.manifest.landscape,tile,{nearbySettlements:neighbors,settlementClearance}),signal);if(!landscape.vegetation.length&&!landscape.landParcels.length)return landscape;const links=await this.settlementPages.landscapeRoadLinks(tile,signal),lines=[];for(const link of links){let compact=this.roadClearances.get(link.id);if(!compact){const recipe=await this.featureRecipe({procedural:true,roadLink:link},signal,options);compact=compactRoadClearance(recipe);this.roadClearances.put(link.id,compact,Math.max(64,JSON.stringify(compact).length*2));}lines.push(...compact);}const clearance=createLandscapeRoadClearance(tile,base.frame.radiusM,lines);landscape.vegetation=landscape.vegetation.filter(t=>!clearance.occupied({xM:(t.bounds.minXM+t.bounds.maxXM)/2,yM:(t.bounds.minYM+t.bounds.maxYM)/2},t.canopyRadiusM+1));if(this.manifest.landscape?.roadParcelClipping==='surveyed-corridors@1'){const report={};landscape.landParcels=cutParcelRoads(landscape.landParcels,clearance.segments,{report});landscape.landscapeStatus.deferredFieldParcels=report.deferredParcels;}else landscape.landParcels=landscape.landParcels.filter(p=>!p.triangles.some(t=>clearance.intersectsTriangle(t)));landscape.landscapeStatus.trees=landscape.vegetation.length;landscape.landscapeStatus.roadClearanceLinks=links.length;return landscape;}
      if(descriptor.agriculturePlot!=null)return this.ready(()=>createAgricultureRecipe(base,descriptor.site,descriptor.agriculturePlot,{nearbySettlements:nearbySettlements}),signal);
      if(descriptor.roadLink){const neighbors=await this.settlementPages.roadNeighbors(descriptor.roadLink,signal),routeLink={...descriptor.roadLink},obstacles=indexedSettlementRoadObstacles(neighbors,this.base.frame.radiusM),routeBase={...base,sampleSurfaceAt:(lat,lon)=>({...base.sampleSurfaceAt(lat,lon),landReserved:obstacles({latDeg:lat,lonDeg:lon})})};for(const end of ['from','to']){const site=neighbors.find(s=>s.id===routeLink[end]);if(site&&greatCircle(site,routeLink[end+'Point'],this.base.frame.radiusM).distanceM<1)routeLink[end+'Point']={...routeLink[end+'Point'],id:site.id,population:site.population,kind:site.kind,economicContext:site.economicContext};}const makeRun=()=>iterateLocalRoadRoute(routeBase,routeLink,{wideWaterReferral:true,...(usesEnvironmentPolicy(this.manifest.landscape?.environmentPolicy)?{environmentCostAt:(point,surface)=>this.landscape.sample(point,surface).environment?.travelCost??1}:{}),allowRiverBridges:['bounded-game-timber-crossings@1','bounded-game-timber-crossings@2'].includes(this.manifest.settlementCatalogue?.riverCrossingPolicy)});const finish=route=>{const recipe=createLocalRoadRecipe(base,routeLink,{route}),compact=compactRoadClearance(recipe);this.roadClearances?.put(routeLink.id,compact,Math.max(64,JSON.stringify(compact).length*2));return recipe;};if(options.roadWorkSteps&&this.materializer){const route=await this.roadSurveys.advance(routeLink.id,makeRun,{steps:options.roadWorkSteps,owner:options.owner,signal,recover:async e=>{if(!(e instanceof MissingPage))return false;await this.load(e.key,signal);return true;}});return this.ready(()=>finish(route),signal);}for(let tries=0;tries<32;tries++){try{const run=makeRun();let step;do{if(signal?.aborted)throw new DOMException('Cancelled','AbortError');step=run.next();if(!step.done)await cooperativeYield();}while(!step.done);return finish(step.value);}catch(e){if(!(e instanceof MissingPage))throw e;await this.load(e.key,signal);}}throw new Error('Road survey exceeds page budget');}
      const recipe=await this.ready(()=>createSettlementLayout(base,descriptor.site,{districtIndex:descriptor.districtIndex??0,nearbySettlements:nearbySettlements}),signal);
      if(recipeKey&&this.settlementRecipes){const text=JSON.stringify(recipe),bytes=(text.length+recipeKey.length)*2+128;if(bytes<=this.settlementRecipes.maxBytes)this.settlementRecipes.put(recipeKey,text,bytes);}
      return recipe;
    }
    const text=await readPage(this.fetcher,new URL(descriptor.path,this.url),{signal,kind:'text'});
    if(new TextEncoder().encode(text).length!==descriptor.bytes||createHash('sha256').update(text).digest('hex')!==descriptor.sha256)throw new Error('Corrupt feature page');
    return JSON.parse(text);
  }
  descriptors() { return [...(this.manifest.featureCharts ?? (this.manifest.features ? [this.manifest.features] : [])),...this.proceduralDescriptors].map(d=>{const footprint=this.featureFootprints?.get(d.path);return footprint?{...d,...footprint}:d;}); }
  featuresReadyAt(point){const up=sphereBasis(geographicPoint(point.latDeg,point.lonDeg)).up;
    if(this.manifest.settlementCatalogue&&(!this.preparedSettlementBound||Math.acos(Math.max(-1,Math.min(1,up.reduce((s,v,i)=>s+v*this.preparedSettlementBound.center[i],0))))>this.preparedSettlementBound.angular))return false;
    return this.descriptors().filter(d=>!d.visualOnly&&Math.acos(Math.max(-1,Math.min(1,up.reduce((sum,v,i)=>sum+v*d.center[i],0))))<=d.angularRadius+1e-8).every(d=>this.featureCache.entries.has(d.path));
  }
  async enableFeaturesAt(point, signal) {
    const up=sphereBasis(geographicPoint(point.latDeg,point.lonDeg)).up;
    const result=await this.prepareMeshFeatures({center:up,angular:0},signal);
    if(result.deferred)throw new RangeError('Physical point features exceed the cache budget; sample unavailable');
  }
  async prepareMeshFeatures(bound,signal,{maxSurveyRadiusM=Infinity,roadWorkSteps=0,owner=null}={}){
    const pinned=new Set();let deferred=0,pending=0;
    const descriptors=this.descriptors().filter(d=>!d.visualOnly&&featureIntersects(d,bound));
    // Wide terrain tiles are transitional views, not physical point queries.
    // Retain their descriptor uncertainty but let refinement reach a local
    // tile before surveying every house and access road across kilometres.
    if(bound.angular*this.base.frame.radiusM>maxSurveyRadiusM){
      const loaded=descriptors.filter(d=>this.featureCache.entries.has(d.path)).length;
      return{loaded,deferred:descriptors.length-loaded};
    }
    // Admit in canonical descriptor order, independent of cache history.
    // Later roads cannot evict required ponds or house foundations.
    for(const d of descriptors){const result=await this.enableFeatures(signal,d,{bound,pinned,roadWorkSteps,owner});if(result==='pending'){pending++;deferred++;}else if(result==='deferred')deferred++;else if(result==='loaded')pinned.add(d.path);}
    return{loaded:pinned.size,deferred,...(pending?{pending}:{} )};
  }
  async enableFeatures(signal, descriptor = this.descriptors()[0], {bound=null,pinned=new Set(),roadWorkSteps=0,owner=null}={}) {
    if (!descriptor || descriptor.visualOnly) return 'ignored';
    if(bound&&descriptor.roadLink&&!localRoadSurveyIntersects(descriptor.roadLink,bound,this.base.frame.radiusM))return 'outside';
    const footprint=this.featureFootprints?.get(descriptor.path);
    if(bound&&!featureIntersects(footprint??descriptor,bound))return 'outside';
    if(this.featureCache.get(descriptor.path))return 'loaded';
    const bytes=descriptor.bytes*16;
    // Do not survey a whole district or regional road that cannot be retained
    // by this tile. Its unknown footprint stays conservatively deferred and
    // forces refinement; a finer tile can subsequently admit the same recipe.
    if(bound){const retained=[...pinned].reduce((n,k)=>n+(this.featureCache.entries.get(k)?.bytes??0),0);if(retained+bytes>this.featureCache.maxBytes)return 'deferred';}
    let recipe;try{recipe=await this.featureRecipe(descriptor,signal,{roadWorkSteps,owner});}catch(e){if(e instanceof RoadSurveyPending)return 'pending';throw e;}
    // The search corridor is deliberately broad. Once surveyed, the actual
    // chart rectangle is a tighter enclosure, without changing its geometry.
    if(recipe.projection&&recipe.bounds){
      const p=createSphericalProjection(recipe.projection),b=recipe.bounds,
        center=p.toGeographic((b.minXM+b.maxXM)/2,(b.minYM+b.maxYM)/2),
        exact={center:sphereBasis(center).up,angularRadius:Math.hypot(b.maxXM-b.minXM,b.maxYM-b.minYM)/2/recipe.projection.radiusM+1e-10};
      this.featureFootprints?.put(descriptor.path,exact,256);
      if(bound&&!featureIntersects(exact,bound))return 'outside';
    }
    // An over-budget coarse tile remains an explicitly approximate mesh.
    // Its uncertainty forces refinement; never silently discard earlier data.
    if(bound){const retained=[...pinned].reduce((n,k)=>n+(this.featureCache.entries.get(k)?.bytes??0),0);if(retained+bytes>this.featureCache.maxBytes)return 'deferred';}
    const chart = await this.ready(() => createGlobeFeatureChart(this.base, recipe), signal);
    this.featureCache.put(descriptor.path, chart, bytes,pinned);
    this.features = this.featureCache.entries; this.featureBytes = this.featureCache.bytes; this.downloadBytes += descriptor.bytes;
    return 'loaded';
  }
  sample(lat,lon){return this.withGroundCover(lat,lon,this.sampleWithoutCover(lat,lon));}
  applySurfaceSlope(lat,lon,surface,slopeMPerM){
    if(!Number.isFinite(slopeMPerM)||slopeMPerM<0)throw new RangeError('Invalid surface slope');
    return this.withGroundCover(lat,lon,{...surface,slopeMPerM});
  }
  withGroundCover(lat,lon,result){
    if(usesEnvironmentPolicy(this.manifest?.landscape?.environmentPolicy))result.riverEnvironment=this.riverAt?.nearby(lat,lon,environmentRiverReach(this.manifest.landscape?.environmentPolicy,this.riverAt),{includeValley:this.manifest.landscape?.environmentPolicy===VALLEY_ENVIRONMENT_POLICY})??null;
    if(this.landscape){const point=geographicPoint(lat,lon),context=this.landCoverContext,up=sphereBasis(point).up,
      complete=context?.complete&&Math.acos(Math.max(-1,Math.min(1,up.reduce((n,v,i)=>n+v*context.bound.center[i],0))))<=context.bound.angular+1e-8;
      result.groundCover={...this.landscape.sample(point,result,{settlements:complete?context.sites:[],settlementClearance:complete?context.settlementClearance:null}),footprintStatus:complete&&context.settlementClearance?'bounded-village-footprints':'settlement-envelope-approximation',contextStatus:complete?'regional-settlement-influences':'potential-vegetation-only'};
    }
    return result;
  }
  sampleWithoutCover(lat,lon){
    const shaped=this.shapeSurfaceAt(lat,lon);if(shaped)return shaped;
    if(!this.manifest.sea||this.manifest.baseWaterPolicy==='explicit-charts-only@1'||(this.manifest.baseWaterPolicy==='base-water-outside-charts@1'&&[...(this.features?.values()??[])].some(e=>e.value.local(lat,lon))))return this.sampleLocal(lat,lon);
    // The river-cut base is needed for water provenance anyway. Reuse this
    // exact query value outside local charts instead of evaluating it twice.
    const rawGround=this.evaluate(geographicPoint(lat,lon)).ground,river=this.riverAt?.(lat,lon,rawGround),baseGround=river?.groundElevationM??rawGround,
      local=this.sampleLocal(lat,lon,baseGround),water=this.planetWater(lat,lon,local.groundElevationM),
      baseReservoir=baseGround===local.groundElevationM?water:this.planetWater(lat,lon,baseGround),original=selectBasePlanetWater(baseReservoir,river);
    const candidates=[original,local,water].filter(s=>s.waterLevelElevationM!=null&&s.waterLevelElevationM>local.groundElevationM);
    candidates.sort((a,b)=>b.waterLevelElevationM-a.waterLevelElevationM);const selected=candidates[0]??water;
    return {...local,...selected,surfaceKind:selected.surfaceKind??(selected.waterLevelElevationM>local.groundElevationM?'local-water':'land'),groundElevationM:local.groundElevationM,waterDepthM:selected.waterLevelElevationM==null?null:Math.max(0,selected.waterLevelElevationM-local.groundElevationM),waterSurfaceElevationM:selected.waterLevelElevationM>local.groundElevationM?selected.waterLevelElevationM:null,hydrologyStatus:'modeled',roadSurface:local.roadSurface,buildingId:local.buildingId};
  }
  sampleLocal(lat, lon, knownBaseGround) {
    const covered = [...(this.features?.values() ?? [])].map(e => ({ chart: e.value, sample: e.value.sampleAt(lat, lon) })).filter(e => e.sample);
    if (!covered.length) return { groundElevationM: knownBaseGround??this.base.groundElevationAt(lat, lon), waterLevelElevationM: null, waterDepthM: null, roadSurface: null, buildingId: null };
    if (covered.length === 1) { const { chart, sample } = covered[0]; return this.manifest.featureNamespace ? { ...sample, waterSourceIds: (sample.waterSourceIds ?? []).map(id => `${encodeURIComponent(chart.recipe.id)}/${encodeURIComponent(id)}`) } : sample; }
    const sparseRoad=covered.some(e=>e.chart.recipe.sparseRoadOverlay),building=sparseRoad?covered.find(e=>e.sample.buildingId):null,roadSamples=sparseRoad?covered.filter(e=>e.sample.roadSurface):[];
    const ground = building?.sample.groundElevationM??(roadSamples.length?Math.max(...roadSamples.map(e=>e.sample.groundElevationM)):Math.min(knownBaseGround??this.base.groundElevationAt(lat, lon), ...covered.map(e => e.sample.groundElevationM)));
    const wet = covered.filter(e => e.sample.waterLevelElevationM != null), level = wet[0]?.sample.waterLevelElevationM ?? null;
    if (wet.some(e => Math.abs(e.sample.waterLevelElevationM - level) > 1e-6)) throw new Error('Chart water levels disagree');
    return { groundElevationM: covered.length ? ground : this.base.groundElevationAt(lat, lon), waterLevelElevationM: level,
      waterDepthM: level == null ? (covered.length ? 0 : null) : Math.max(0, level - ground), roadSurface: covered.map(e => e.sample.roadSurface).find(Boolean) ?? null,
      buildingId: covered.map(e => e.sample.buildingId).find(Boolean) ?? null,
      waterSourceIds: wet.flatMap(e => e.sample.waterSourceIds.map(id => this.manifest.featureNamespace ? `${encodeURIComponent(e.chart.recipe.id)}/${encodeURIComponent(id)}` : id)).sort() };
  }
  groundElevationAt(lat, lon) {
    const covered = [...(this.features?.values() ?? [])].map(e => e.value).filter(chart => chart.local(lat, lon));
    if (!covered.length) return this.base.groundElevationAt(lat, lon);
    if (covered.length === 1) return covered[0].groundElevationAt(lat, lon);
    if(covered.some(chart=>chart.recipe.sparseRoadOverlay))return this.sampleLocal(lat,lon).groundElevationM;
    return Math.min(this.base.groundElevationAt(lat, lon), ...covered.map(chart => chart.groundElevationAt(lat, lon)));
  }
  /** Conservative height hull, using the same four-corner envelope as Core
   * Hermite patches. This is calculated in the Worker from demanded pages. */
  tileHeightBounds(bound, { includeFeatures = true } = {}) {
    const s = this.manifest.base, lat = Math.asin(bound.center[2]), angle = bound.angular, low = lat - angle, high = lat + angle;
    const global = this.manifest.elevationRangeM;
    const features = this.descriptors().filter(f => !f.visualOnly && Math.acos(Math.max(-1, Math.min(1, bound.center.reduce((sum, v, i) => sum + v * f.center[i], 0)))) <= angle + f.angularRadius);
    const adjusted=range=>{
      if(this.shapeFirstRegion?.intersects(bound)){
        const slope=terrainSlopeBound({...this.manifest,shapeFirstRegion:null},bound),point={latDeg:lat*180/Math.PI,lonDeg:Math.atan2(bound.center[1],bound.center[0])*180/Math.PI};
        if(Number.isFinite(slope)){const z=this.legacyEvaluate(point).ground,delta=slope*s.frame.radiusM*angle+1e-6;range=[Math.max(range[0],z-delta),Math.min(range[1],z+delta)];}
        return this.shapeFirstRegion.bounds(bound,this.riverAt?this.riverAt.groundHeightBounds(bound,range):range);
      }
      // The four coarse corners do not converge when a tile shrinks inside
      // their cell. Intersect that hull with a canonical centre value and the
      // already certified derivative bound over the whole spherical disk.
      const slope=terrainSlopeBound(this.manifest,bound);
      if(Number.isFinite(slope)&&angle<Math.PI/2){
        const lon=Math.atan2(bound.center[1],bound.center[0])*180/Math.PI,z=this.rawGroundElevationAt(lat*180/Math.PI,lon),
          uncertainty=slope*s.frame.radiusM*angle+128*Number.EPSILON*(s.frame.radiusM+Math.abs(z));
        range=[Math.max(range[0],z-uncertainty),Math.min(range[1],z+uncertainty)];
      }
      const bed=includeFeatures&&this.riverAt?this.riverAt.groundHeightBounds(bound,range):range;
      if(!includeFeatures)return bed;
      let low=bed[0],high=bed[1];
      for(const descriptor of features){
        const chart=this.featureCache.entries.get(descriptor.path)?.value;
        const adjusted=chart?.boundGroundElevation?chart.boundGroundElevation(bed,bound):[bed[0]-descriptor.verticalAllowanceM,bed[1]+descriptor.verticalAllowanceM];
        if(features.length===1&&chart?.containsBound?.(bound)){low=adjusted[0];high=adjusted[1];}
        else{low=Math.min(low,adjusted[0]);high=Math.max(high,adjusted[1]);}
      }
      return[low,high];
    };
    const fallback = () => adjusted(global);
    const alpha = Math.PI / (2 * this.height), detail = s.detail.bands.reduce((sum, b) => sum + b.amplitudeM, 0);
    for (const [side, entered, t] of [['north', low > Math.PI / 2 - alpha, (Math.PI / 2 - low) / alpha], ['south', high < -Math.PI / 2 + alpha, (high + Math.PI / 2) / alpha]]) {
      if (entered && this.manifest.poleRingRange) {
        const mean = this.manifest.poles[side], ring = this.manifest.poleRingRange[side], clamped = Math.max(0, Math.min(1, t)), weight = clamped * clamped * (3 - 2 * clamped);
        return adjusted([mean + (ring[0] - mean) * weight + s.frame.elevationOffsetM - detail, mean + (ring[1] - mean) * weight + s.frame.elevationOffsetM + detail]);
      }
    }
    if (low <= -Math.PI / 2 + Math.PI / (2 * this.height) || high >= Math.PI / 2 - Math.PI / (2 * this.height)) return fallback();
    const deltaX = angle / Math.cos(Math.max(Math.abs(low), Math.abs(high))) * this.width / (2 * Math.PI);
    const centerX = ((Math.atan2(bound.center[1], bound.center[0]) / (2 * Math.PI) * this.width) % this.width + this.width) % this.width;
    const xa = Math.floor(centerX - deltaX - .5), xb = Math.ceil(centerX + deltaX - .5);
    const ya = Math.max(0, Math.floor((Math.PI / 2 - high) / Math.PI * this.height - .5)), yb = Math.min(this.height - 2, Math.ceil((Math.PI / 2 - low) / Math.PI * this.height - .5));
    if ((xb - xa + 2) * (yb - ya + 2) > 1024 || (Math.ceil((xb - xa + 2) / this.manifest.pageSize) + 2) * (Math.ceil((yb - ya + 2) / this.manifest.pageSize) + 1) > 20) return fallback();
    let min = Infinity, max = -Infinity;
    for (let y = ya; y <= yb + 1; y++) for (let x = xa; x <= xb + 1; x++) {
      const z = this.readCell((x % this.width + this.width) % this.width, y); min = Math.min(min, z); max = Math.max(max, z);
    }
    return adjusted([min + s.frame.elevationOffsetM - detail, max + s.frame.elevationOffsetM + detail]);
  }
  groundBoundsCertified(bound){
    return this.descriptors().filter(f=>!f.visualOnly&&Math.acos(Math.max(-1,Math.min(1,bound.center.reduce((sum,v,i)=>sum+v*f.center[i],0))))<=bound.angular+f.angularRadius+1e-8)
      .every(f=>typeof this.featureCache.entries.get(f.path)?.value.boundGroundElevation==='function');
  }
  stats() { return {pendingRoadSurveys:this.roadSurveys?.job?1:0,residentWaterPlans:this.materializedWaterPlans?.size??0,activeWaterJobs:this.waterWorkCount??0, landCoverContextStatus:this.landCoverContext?.complete?'complete':this.landCoverContext?.reason??'not-prepared',landCoverSiteCount:this.landCoverContext?.sites.length??0,featureFootprintBytes:this.featureFootprints.bytes,featureFootprintLimitBytes:this.featureFootprints.maxBytes,settlementRecipeBytes:this.settlementRecipes?.bytes??0,settlementRecipeLimitBytes:this.settlementRecipes?.maxBytes??0,settlementLandBytes:this.settlementLand.bytes,settlementLandLimitBytes:this.settlementLand.maxBytes,roadClearanceBytes:this.roadClearances.bytes,roadClearanceLimitBytes:this.roadClearances.maxBytes,settlementPageBytesEstimated:this.settlementPages.cache.bytes,settlementPageLimitBytes:this.settlementPages.cache.maxBytes, requests: this.requests, downloadBytes: this.downloadBytes, fieldBytes: this.cache.bytes, anchorBytes: this.anchors.bytes,
    meshNormalBytesEstimated:(this.meshNormals?.entries.size??0)*320,meshNormalEntries:this.meshNormals?.entries.size??0,
    meshNormalHits:this.meshNormals?.hits??0,meshNormalMisses:this.meshNormals?.misses??0,meshNormalEvictions:this.meshNormals?.evictions??0,
    patchBytesEstimated:this.patchBytesEstimated, featureBytesEstimated: this.featureBytes, fieldEvictions: this.cache.evictions, peakCacheBytes: this.peakCacheBytes }; }
}

function featureIntersects(a,b){return Math.acos(Math.max(-1,Math.min(1,a.center.reduce((s,v,i)=>s+v*b.center[i],0))))<=a.angularRadius+b.angular+1e-8;}
