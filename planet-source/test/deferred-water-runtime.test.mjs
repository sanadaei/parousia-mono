import test from 'node:test';import assert from 'node:assert/strict';
import {PagedSource} from '../src/globe/paged-source.mjs';
import {createSphericalProjection} from '../src/core/spherical.mjs';
import {PLANET_RIVERS_SCHEMA,SMOOTH_RIVER_BED} from '../src/core/planet-rivers.mjs';
import {WATER_FIRST_POPULATION,WATER_FIRST_ALL_ZONES,SHARED_WATER_REGIONS} from '../src/core/water-first-population-region.mjs';
import {parsePlanetArguments} from '../scripts/generate-planet.mjs';
import {packageDeferredPopulation} from '../scripts/package-settlements.mjs';
import {waterVisibilityUpperBound,uniformReservoir} from '../src/globe/water-visibility.mjs';
function fixture(){const radiusM=6371000,p=createSphericalProjection({centerLatDeg:0,centerLonDeg:0,radiusM,maxRadiusM:10000}),a=p.toGeographic(0,-100),b=p.toGeographic(0,100),base={worldId:'base',frame:{radiusM},grid:{columns:16,rows:8},sampleSurfaceAt:()=>({groundElevationM:100,waterDepthM:0,waterLevelElevationM:null,waterSourceIds:[],surfaceKind:'land'}),groundElevationAt:()=>100};
 const plan={schema:'referenced-local-water-plan@1',sourceWorldId:'world',id:'plan',region:{center:{latDeg:0,lonDeg:0},supportRadiusM:200},settings:{maxIncisionM:2},nodes:[{id:'a',...a,waterLevelElevationM:100},{id:'b',...b,waterLevelElevationM:100}],profiles:[{id:'stream',from:'a',to:'b',points:[a,b].map(g=>({...g,waterLevelElevationM:100,halfWidthM:2,depthM:1,bankWidthM:3}))}]};
 const manifest={base:{worldId:'base',frame:{radiusM},grid:base.grid},elevationRangeM:[0,500],settlementCatalogue:{waterMaterializationPolicy:WATER_FIRST_POPULATION},rivers:{schema:PLANET_RIVERS_SCHEMA,bedMethod:SMOOTH_RIVER_BED,radiusM,grid:base.grid,nodes:[],profiles:[],diagnostics:{maxIncisionM:2}}};return{base,plan,manifest};}
test('water-first publication is explicit and has a different saved identity',()=>{assert.equal(parsePlanetArguments(['--deferred-population','--deferred-water']).deferredWater,true);assert.throws(()=>parsePlanetArguments(['--deferred-water']),/requires/);assert.throws(()=>parsePlanetArguments(['--deferred-population','--deferred-water','--deferred-water']),/Duplicate/);const{base}=fixture(),world={base,population:{id:'pop',grid:base.grid,totals:{villages:1,towns:0,cities:0,supportedPopulation:300}}};const old=packageDeferredPopulation(world),fresh=packageDeferredPopulation(world,{waterFirst:true});assert.equal(old.waterMaterializationPolicy,undefined);assert.equal(fresh.waterMaterializationPolicy,WATER_FIRST_POPULATION);assert.notEqual(old.id,fresh.id);});
test('actual paged source installs saved water in its shared river sampler without replacing prior records',async()=>{const{base,plan,manifest}=fixture(),pages={world:{worldId:'world',base},waterPlansNear:async()=>[structuredClone(plan)]},source=Object.assign(Object.create(PagedSource.prototype),{manifest,base,settlementPages:{deferred:pages}}),bound={center:[1,0,0],angular:.001};await source.prepareWater(bound);const first=source.riverAt(0,0,100);assert.ok(first.waterDepthM>.99);assert.equal(source.materializedWaterPlans.size,1);await source.prepareWater(bound);assert.deepEqual(source.riverAt(0,0,100),first);pages.waterPlansNear=async()=>[];await source.prepareWater(bound);assert.deepEqual(source.riverAt(0,0,100),first);pages.waterPlansNear=async()=>[{...plan,settings:{maxIncisionM:3}}];await assert.rejects(source.prepareWater(bound),/Conflicting/);assert.deepEqual(source.riverAt(0,0,100),first);});
test('unmaterialized water cannot be culled using only the old river list',()=>{const{manifest}=fixture(),bound={center:[1,0,0],angular:.001};assert.ok(waterVisibilityUpperBound(manifest,bound)>=500);assert.equal(uniformReservoir(manifest,bound,-10),null);});

test('water residency pages between completed jobs and restores the exact saved stream',async()=>{
 const {base,plan,manifest}=fixture(),saved=new Map();
 for(let n=0;n<80;n++){
  const p=structuredClone(plan);p.id=`plan-${n}`;p.region.center.lonDeg=n;p.nodes.forEach(v=>{v.id+=n;v.lonDeg+=n;});p.profiles.forEach(v=>{v.id+=n;v.from+=n;v.to+=n;v.points.forEach(q=>q.lonDeg+=n);});saved.set(n,p);
 }
 let choice=0,reads=0;const pages={world:{worldId:'world',base},waterPlansNear:async()=>{reads++;return[structuredClone(saved.get(choice))];}},source=Object.assign(Object.create(PagedSource.prototype),{manifest,base,settlementPages:{deferred:pages}}),bound={center:[1,0,0],angular:.001};
 let first;
 for(choice=0;choice<80;choice++)await source.withWaterWork(async()=>{await source.prepareWater(bound);assert.equal(source.materializedWaterPlans.size,1);const sample=source.riverAt(0,choice,100);assert.ok(sample.waterDepthM>.99);if(choice===0)first=sample;});
 choice=0;await source.withWaterWork(()=>source.prepareWater(bound));assert.deepEqual(source.riverAt(0,0,100),first);assert.equal(source.waterWorkCount,0);assert.equal(reads,81);assert.equal(saved.size,80);
});

test('overlapping work scopes pin their water until all consumers finish',async()=>{
 const {base,plan,manifest}=fixture(),other=structuredClone(plan);other.id='other';other.region.center.lonDeg=1;other.nodes.forEach(v=>{v.id+='2';v.lonDeg+=1;});other.profiles.forEach(v=>{v.id+='2';v.from+='2';v.to+='2';v.points.forEach(q=>q.lonDeg+=1);});
 let choice=plan;const pages={world:{worldId:'world',base},waterPlansNear:async()=>[structuredClone(choice)]},source=Object.assign(Object.create(PagedSource.prototype),{manifest,base,settlementPages:{deferred:pages}}),bound={center:[1,0,0],angular:.001};
 const releaseA=source.beginWaterWork();await source.prepareWater(bound);const a=source.riverAt(0,0,100);
 const releaseB=source.beginWaterWork();choice=other;await source.prepareWater(bound);assert.equal(source.materializedWaterPlans.size,2);assert.deepEqual(source.riverAt(0,0,100),a);releaseB();releaseB();assert.equal(source.waterWorkCount,1);releaseA();
 await source.withWaterWork(()=>source.prepareWater(bound));assert.equal(source.materializedWaterPlans.size,1);assert.equal(source.materializedWaterPlans.has('other'),true);
});

test('failed or cancelled water preparation preserves residency and releases the scope',async()=>{
 const {base,plan,manifest}=fixture(),pages={world:{worldId:'world',base},waterPlansNear:async()=>[structuredClone(plan)]},source=Object.assign(Object.create(PagedSource.prototype),{manifest,base,settlementPages:{deferred:pages}}),bound={center:[1,0,0],angular:.001};
 await source.withWaterWork(()=>source.prepareWater(bound));const first=source.riverAt;
 const controller=new AbortController();pages.waterPlansNear=async()=>{controller.abort();return[];};await assert.rejects(source.withWaterWork(()=>source.prepareWater(bound,controller.signal)),{name:'AbortError'});assert.equal(source.riverAt,first);assert.equal(source.waterWorkCount,0);
 pages.waterPlansNear=async()=>[{...plan,sourceWorldId:'wrong'}];await assert.rejects(source.withWaterWork(()=>source.prepareWater(bound)));assert.equal(source.riverAt,first);assert.equal(source.waterWorkCount,0);
 pages.waterPlansNear=async()=>[];await source.withWaterWork(()=>source.prepareWater(bound));assert.equal(source.materializedWaterPlans.size,0);assert.equal(source.waterWorkCount,0);
});

test('a short visible road segment prepares water for its full route and detour margin',async()=>{
 const {base,manifest}=fixture();let query;
 const source=Object.assign(Object.create(PagedSource.prototype),{manifest,base,materializer:null,prepareWater:async b=>{query=b;},generateFeatureRecipe:async()=>({ok:true})});
 const roadLink={fromPoint:{latDeg:0,lonDeg:0},toPoint:{latDeg:0,lonDeg:.5},distanceM:60000};
 assert.deepEqual(await source.featureRecipe({procedural:true,roadLink,center:[0,1,0],angularRadius:10/base.frame.radiusM}),{ok:true});
 assert.deepEqual(query.center,[1,0,0]);assert.equal(query.angular,76000/base.frame.radiusM);assert.equal(source.waterWorkCount,0);
});

test('all-zone policy installs the same canonical water surface and conservative visibility',async()=>{const{base,plan,manifest}=fixture();manifest.settlementCatalogue.waterMaterializationPolicy=WATER_FIRST_ALL_ZONES;const pages={world:{worldId:'world',base},waterPlansNear:async()=>[structuredClone(plan)]},source=Object.assign(Object.create(PagedSource.prototype),{manifest,base,settlementPages:{deferred:pages}}),bound={center:[1,0,0],angular:.001};await source.prepareWater(bound);assert.ok(source.riverAt(0,0,100).waterDepthM>.99);assert.ok(waterVisibilityUpperBound(manifest,bound)>=500);assert.equal(uniformReservoir(manifest,bound,-10),null);});

test('shared water owners use the same physical sampler and visibility bounds',async()=>{const{base,plan,manifest}=fixture();manifest.settlementCatalogue.waterMaterializationPolicy=SHARED_WATER_REGIONS;const pages={world:{worldId:'world',base},waterPlansNear:async()=>[structuredClone(plan)]},source=Object.assign(Object.create(PagedSource.prototype),{manifest,base,settlementPages:{deferred:pages}}),bound={center:[1,0,0],angular:.001};await source.prepareWater(bound);assert.ok(source.riverAt(0,0,100).waterDepthM>.99);assert.ok(waterVisibilityUpperBound(manifest,bound)>=500);assert.equal(uniformReservoir(manifest,bound,-10),null);});

test('regional first-reference water uses the physical sampler and conservative visibility',async()=>{const {SHARED_REGIONAL_WATER}=await import('../src/core/water-first-population-region.mjs');const{base,plan,manifest}=fixture();manifest.settlementCatalogue.waterMaterializationPolicy=SHARED_REGIONAL_WATER;const pages={world:{worldId:'world',base},waterPlansNear:async()=>[structuredClone(plan)]},source=Object.assign(Object.create(PagedSource.prototype),{manifest,base,settlementPages:{deferred:pages}}),bound={center:[1,0,0],angular:.001};await source.prepareWater(bound);assert.ok(source.riverAt(0,0,100).waterDepthM>.99);assert.ok(waterVisibilityUpperBound(manifest,bound)>=500);assert.equal(uniformReservoir(manifest,bound,-10),null);});
