import test from 'node:test';
import assert from 'node:assert/strict';
import {materializeLocalWaterPlan} from '../src/core/local-water-materialization.mjs';
import {CommittedMaterializer} from '../src/core/committed-materialization.mjs';
import {createSphericalProjection} from '../src/core/spherical.mjs';
import {PLANET_RIVERS_SCHEMA,SMOOTH_RIVER_BED} from '../src/core/planet-rivers.mjs';
function storage(){const rows=new Map();return{rows,async get(k){return rows.has(k)?structuredClone(rows.get(k)):null;},async putIfAbsent(k,v){if(!rows.has(k))rows.set(k,structuredClone(v));return structuredClone(rows.get(k));}};}
function world(maxRadiusM=10000){
 const radiusM=6371000,p=createSphericalProjection({centerLatDeg:20,centerLonDeg:30,radiusM,maxRadiusM}),a=p.toGeographic(0,-100),b=p.toGeographic(0,100);
 const network={schema:PLANET_RIVERS_SCHEMA,bedMethod:SMOOTH_RIVER_BED,radiusM,grid:{columns:8,rows:4},nodes:[{id:'a',...a,waterLevelElevationM:0},{id:'b',...b,waterLevelElevationM:0}],profiles:[{id:'river',from:'a',to:'b',points:[a,b].map(g=>({...g,waterLevelElevationM:0,halfWidthM:20,depthM:1,bankWidthM:2}))}],diagnostics:{maxIncisionM:2}};
 let samples=0;const base={worldId:'base',frame:{radiusM},toSnapshot:()=>({references:{rivers:network}}),sampleSurfaceAt:(lat,lon)=>{samples++;const q=p.toLocal(lat,lon),d=Math.hypot(q.xM,q.yM-100),wet=d<40;return{groundElevationM:wet?-1:Math.max(Math.abs(q.xM),Math.abs(q.yM-100))>900?0:d/200,waterDepthM:wet?1:0,waterLevelElevationM:wet?0:null,waterSourceIds:wet?['river']:[],surfaceKind:wet?'river':'land'};}};
 return{worldId:'world',base,climate:{catchmentWater:{id:'climate',annualLocalYieldMm:Array(32).fill(1200)}},samples:()=>samples,network};
}
test('first referenced water plan is saved, reload does not resurvey, existing terrain is unchanged',async()=>{
 const w=world(),s=storage(),before=JSON.stringify(w.network),o={parentId:'river',pointIndex:1};
 const first=await materializeLocalWaterPlan(w,new CommittedMaterializer(s),o),count=w.samples();
 assert.ok(count>0);assert.equal(first.installed,false);assert.ok(first.region);assert.ok(first.profiles.length>0);
 assert.deepEqual(await materializeLocalWaterPlan(w,new CommittedMaterializer(s),o),first);assert.equal(w.samples(),count);assert.equal(JSON.stringify(w.network),before);assert.equal(s.rows.size,1);
});
test('dry climate saves a no-channel result without repeated attempts',async()=>{
 const w=world(),s=storage();w.climate.catchmentWater.annualLocalYieldMm.fill(0);const o={parentId:'river',pointIndex:1};
 const first=await materializeLocalWaterPlan(w,new CommittedMaterializer(s),o),count=w.samples();assert.equal(first.status,'no-channel-accepted');assert.equal(first.profiles.length,0);
 assert.deepEqual(await materializeLocalWaterPlan(w,new CommittedMaterializer(s),o),first);assert.equal(w.samples(),count);
});
test('invalid references and changed supply do not silently replace saved water',async()=>{
 const w=world(),s=storage(),m=new CommittedMaterializer(s),o={parentId:'river',pointIndex:1};
 await assert.rejects(materializeLocalWaterPlan(w,m,{parentId:'missing',pointIndex:0}),/receiving river/);
 await materializeLocalWaterPlan(w,m,o);w.climate.catchmentWater.id='changed';await assert.rejects(materializeLocalWaterPlan(w,m,o),/migration/);
});
test('regional and fine water are one saved record and do not rerun on reference',async()=>{
 const {materializeRegionalWaterPlan}=await import('../src/core/regional-water-materialization.mjs'),w=world(100000),s=storage(),o={parentId:'river',pointIndex:1},before=JSON.stringify(w.network);
 const first=await materializeRegionalWaterPlan(w,new CommittedMaterializer(s),o),count=w.samples();assert.equal(first.region.cellSizeM,512);assert.equal(first.fineRegion.cellSizeM,64);assert.equal(first.region.center.latDeg,first.fineRegion.center.latDeg);assert.ok(first.profiles.length>0);assert.equal(s.rows.size,1);
 assert.deepEqual(await materializeRegionalWaterPlan(w,new CommittedMaterializer(s),o),first);assert.equal(w.samples(),count);assert.equal(JSON.stringify(w.network),before);
});
