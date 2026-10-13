import test from 'node:test';import assert from 'node:assert/strict';
import {waterRegionForPopulationZone,waterRegionsNear,materializeWaterReferenceRegion,SHARED_WATER_REGIONS} from '../src/core/water-reference-regions.mjs';
import {populationRootZone,splitPopulationZone} from '../src/core/population-zones.mjs';
import {CommittedMaterializer} from '../src/core/committed-materialization.mjs';
import {DeferredPopulationPages} from '../src/globe/deferred-population-pages.mjs';
import {sphereBasis} from '../src/core/spherical.mjs';
function fixture(){const population={grid:{columns:128,rows:64},cells:Array.from({length:8192},(_,cellIndex)=>({cellIndex,population:0,ruralPopulation:0,townPopulation:0,cityPopulation:0,villages:0,towns:0,cities:0}))},base={worldId:'base',frame:{radiusM:6371000},toSnapshot:()=>({references:{}})},world={worldId:'world',base,population,settlements:[]},rows=new Map(),materializer=new CommittedMaterializer({get:async k=>rows.get(k),putIfAbsent:async(k,v)=>{if(!rows.has(k))rows.set(k,v);return rows.get(k);}});return{world,rows,materializer};}
const descendants=(z,n)=>Array.from({length:n}).reduce(z=>splitPopulationZone(z,[0,0,0,0]).children[0],z);
test('dense and empty population leaves share water ownership independent of counts',()=>{
 const{world}=fixture(),z=descendants(populationRootZone(world.population,4096),4),fine=descendants(z,4),a=waterRegionForPopulationZone(world,z),b=waterRegionForPopulationZone(world,fine);
 assert.deepEqual(a,b);assert.equal(a.depth,4);assert.equal('population' in a,false);
 const dense={...fine,population:3000000000,ruralPopulation:3000000000,villages:10000000};assert.deepEqual(waterRegionForPopulationZone(world,dense),a);
 const center={latDeg:(fine.bounds.north+fine.bounds.south)/2,lonDeg:(fine.bounds.west+fine.bounds.east)/2};assert.ok(waterRegionsNear(world,{center:sphereBasis(center).up,angular:.00001}).some(o=>o.id===a.id));
 a.bounds.west=-999;assert.notEqual(waterRegionForPopulationZone(world,z).bounds.west,-999);
});
test('a shared owner saves empty outcomes once and reloads without terrain inspection',async()=>{
 const{world,rows,materializer}=fixture(),z=descendants(populationRootZone(world.population,4096),5),owner=waterRegionForPopulationZone(world,z),first=await materializeWaterReferenceRegion(world,owner,materializer);
 assert.equal(first.plan,null);assert.equal(rows.size,1);world.base.toSnapshot=()=>{throw Error('must not regenerate');};assert.deepEqual(await materializeWaterReferenceRegion(world,owner,materializer),first);
});
test('shared water runtime does not split census or instantiate settlement regions',async()=>{
 const{world,materializer}=fixture(),pages=Object.assign(Object.create(DeferredPopulationPages.prototype),{world,materializer,init:async()=>{},manifest:{settlementCatalogue:{waterMaterializationPolicy:SHARED_WATER_REGIONS}},descriptors(){throw Error('census traversal');},region(){throw Error('settlement generated');}});
 assert.deepEqual(await pages.waterPlansNear({center:sphereBasis({latDeg:-.1,lonDeg:.1}).up,angular:.00001}),[]);
});
test('water reference traversal rejects invalid directions and oversized work',()=>{
 const{world}=fixture();assert.throws(()=>waterRegionsNear(world,{center:[0,0,0],angular:0}),/budget/);assert.throws(()=>waterRegionsNear(world,{center:[1,0,0],angular:1},{maxNodes:1}),/budget/);
 assert.throws(()=>waterRegionForPopulationZone(world,populationRootZone(world.population,4096)),/fit one/);
});
test('regional water owners span finer census and legacy water regions without changing their keys',async()=>{
 const {SHARED_REGIONAL_WATER}=await import('../src/core/water-reference-regions.mjs'),{world,materializer}=fixture(),zone=descendants(populationRootZone(world.population,4096),5),legacy=waterRegionForPopulationZone(world,zone),owner=waterRegionForPopulationZone(world,zone,{policy:SHARED_REGIONAL_WATER});
 assert.ok(owner.depth<legacy.depth);assert.ok(owner.id.startsWith('regional-water-region:'));assert.ok(legacy.id.startsWith('water-region:'));
 const first=await materializeWaterReferenceRegion(world,owner,materializer,{policy:SHARED_REGIONAL_WATER});assert.equal(first.schema,SHARED_REGIONAL_WATER);world.base.toSnapshot=()=>{throw Error('unexpected regeneration');};assert.deepEqual(await materializeWaterReferenceRegion(world,owner,materializer,{policy:SHARED_REGIONAL_WATER}),first);
 const center={latDeg:(zone.bounds.north+zone.bounds.south)/2,lonDeg:(zone.bounds.west+zone.bounds.east)/2};assert.ok(waterRegionsNear(world,{center:sphereBasis(center).up,angular:.00001},{policy:SHARED_REGIONAL_WATER}).some(o=>o.id===owner.id));
});
