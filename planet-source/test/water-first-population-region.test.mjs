import test from 'node:test';import assert from 'node:assert/strict';
import {containsWaterDisc,materializeWaterFirstPopulationRegion} from '../src/core/water-first-population-region.mjs';
import {CommittedMaterializer} from '../src/core/committed-materialization.mjs';
import {populationRootZone,splitPopulationZone} from '../src/core/population-zones.mjs';
const radiusM=6371000;
test('water ownership disks respect latitude, wrapped longitude and exact leaf boundaries',()=>{
 const z={bounds:{south:-1,north:1,west:359,east:360}};
 assert.equal(containsWaterDisc(z,{latDeg:0,lonDeg:-.5},5000,radiusM),true);
 assert.equal(containsWaterDisc(z,{latDeg:0,lonDeg:-.001},5000,radiusM),false);
 assert.equal(containsWaterDisc(z,{latDeg:1,lonDeg:-.5},5000,radiusM),false);
 assert.equal(containsWaterDisc({bounds:{south:89,north:90,west:0,east:20}},{latDeg:89.99,lonDeg:10},5000,radiusM),false);
});
test('a saved water-and-sites bundle is reused without replanning and does not allocate houses',async()=>{
 const terrain={grid:{columns:16,rows:8},fields:{landMask:Array(128).fill(1)},references:{lakes:[]}},base={worldId:'base',frame:{radiusM},toSnapshot:()=>terrain,sampleSurfaceAt:()=>({groundElevationM:100,waterDepthM:0}),groundElevationAt:()=>100};
 const population={sourceWorldId:'base',id:'people',grid:terrain.grid,settings:{grainKgPerHa:1000,retainedHarvestFraction:.5,foodKgPerPersonYear:200},cells:Array.from({length:128},(_,cellIndex)=>({cellIndex,population:0,villages:0,towns:0,cities:0}))};population.cells[64]={cellIndex:64,population:300,ruralPopulation:300,townPopulation:0,cityPopulation:0,villages:1,towns:0,cities:0,suitability:1,netFoodKg:60000};
 const world={worldId:'world',base,population,settlements:[]},zone=Array.from({length:7}).reduce(z=>splitPopulationZone(z,[1,0,0,0]).children[0],populationRootZone(population,64)),rows=new Map(),storage={get:async k=>rows.get(k)??null,putIfAbsent:async(k,v)=>{if(!rows.has(k))rows.set(k,v);return rows.get(k);}};
 const first=await materializeWaterFirstPopulationRegion(world,zone,new CommittedMaterializer(storage));assert.equal(first.sites.length,1);assert.equal(first.localWater.status,'no-owned-reference');assert.equal(first.localWater.plan,null);assert.ok(first.sites.every(s=>!s.buildings));base.sampleSurfaceAt=()=>{throw Error('Regenerated');};assert.deepEqual(await materializeWaterFirstPopulationRegion(world,zone,new CommittedMaterializer(storage)),first);assert.equal(rows.size,1);
});
test('shared water leaves reuse one unchanged base planner instead of copying the world per leaf',async()=>{
 const {SHARED_WATER_REGIONS}=await import('../src/core/water-first-population-region.mjs');let snapshots=0;
 const terrain={grid:{columns:16,rows:8},fields:{landMask:Array(128).fill(1)},references:{lakes:[]}},base={worldId:'base',frame:{radiusM},toSnapshot:()=>{snapshots++;return structuredClone(terrain);},sampleSurfaceAt:()=>({groundElevationM:100,waterDepthM:0}),groundElevationAt:()=>100};
 const population={sourceWorldId:'base',id:'people',grid:terrain.grid,settings:{grainKgPerHa:1000,retainedHarvestFraction:.5,foodKgPerPersonYear:200},cells:Array.from({length:128},(_,cellIndex)=>({cellIndex,population:0,ruralPopulation:0,townPopulation:0,cityPopulation:0,villages:0,towns:0,cities:0,suitability:1,netFoodKg:0}))};population.cells[64]={...population.cells[64],population:300,ruralPopulation:300,villages:1,netFoodKg:60000};
 const world={worldId:'world',base,population,settlements:[]},parent=Array.from({length:7}).reduce(z=>splitPopulationZone(z,[1,0,0,0]).children[0],populationRootZone(population,64)),zones=splitPopulationZone(parent,[1,0,0,0]).children.slice(0,2),rows=new Map(),materializer=new CommittedMaterializer({get:async k=>rows.get(k),putIfAbsent:async(k,v)=>{if(!rows.has(k))rows.set(k,v);return rows.get(k);}});
 const results=[];for(const zone of zones)results.push(await materializeWaterFirstPopulationRegion(world,zone,materializer,{policy:SHARED_WATER_REGIONS}));
 assert.equal(snapshots,2);assert.deepEqual(results.map(r=>r.sites.length),[1,0]);assert.equal(results[0].localWater.ownerId,results[1].localWater.ownerId);
 for(let i=0;i<zones.length;i++)assert.deepEqual(await materializeWaterFirstPopulationRegion(world,zones[i],materializer,{policy:SHARED_WATER_REGIONS}),results[i]);assert.equal(snapshots,2);
});
