import test from 'node:test';import assert from 'node:assert/strict';
import {PagedSource} from '../src/globe/paged-source.mjs';import {ByteLRU} from '../src/globe/lru.mjs';import {WATER_SCHEMA} from '../src/core/water-model.mjs';
const bound={center:[1,0,0],angular:1e-5};
function fixture(){const descriptors=Array.from({length:3},(_,i)=>({path:'feature:'+i,bytes:32,center:[1,0,0],angularRadius:.01,verticalAllowanceM:100}));const source=Object.assign(Object.create(PagedSource.prototype),{featureCache:new ByteLRU(1024),featureFootprints:new ByteLRU(128*1024),base:{worldId:'flat',frame:{radiusM:6371000},groundElevationAt:()=>100},manifest:{},downloadBytes:0,ready:async fn=>fn(),descriptors:()=>descriptors});source.featureRecipe=async d=>({id:d.path,projection:{centerLatDeg:0,centerLonDeg:0,radiusM:6371000,maxRadiusM:20000},bounds:{minXM:-100,maxXM:100,minYM:-100,maxYM:100},model:{schema:WATER_SCHEMA,construction:'strip-with-smooth-banks@4',nodes:[],edges:[],bodies:[],topologyOrder:[],basins:null},buildings:[],buildingPads:[],roadCenterlineProfiles:[]});return{source,descriptors};}
test('over-budget mesh retains earlier required physical charts instead of silently evicting them',async()=>{const {source}=fixture(),result=await source.prepareMeshFeatures(bound);assert.deepEqual(result,{loaded:2,deferred:1});assert.ok(source.featureCache.entries.has('feature:0'));assert.ok(source.featureCache.entries.has('feature:1'));assert.equal(source.featureCache.entries.has('feature:2'),false);assert.equal(source.featureCache.evictions,0);assert.equal(source.groundBoundsCertified(bound),false);assert.equal(source.featureCache.bytes,1024);});
test('surveyed road chart bounds exclude a remote search corridor from repeated compilation',async()=>{const {source,descriptors}=fixture();descriptors.splice(1);let calls=0;const original=source.featureRecipe;source.featureRecipe=async d=>{calls++;const r=await original(d);r.projection.centerLonDeg=.2;return r;};assert.deepEqual(await source.prepareMeshFeatures(bound),{loaded:0,deferred:0});assert.equal(source.featureCache.bytes,0);await source.prepareMeshFeatures(bound);assert.equal(calls,1);});
test('a finer tile admits the remaining chart without changing canonical recipes or expanding the budget',async()=>{const {source,descriptors}=fixture();await source.prepareMeshFeatures(bound);const last=descriptors[2];source.descriptors=()=>[last];assert.deepEqual(await source.prepareMeshFeatures(bound),{loaded:1,deferred:0});assert.ok(source.featureCache.entries.has(last.path));assert.equal(source.groundBoundsCertified(bound),true);assert.ok(source.featureCache.bytes<=1024);});

test('cache history does not choose which over-budget physical charts a tile retains',async()=>{const {source,descriptors}=fixture();await source.enableFeatures(undefined,descriptors[2]);const result=await source.prepareMeshFeatures(bound);assert.deepEqual(result,{loaded:2,deferred:1});assert.deepEqual([...source.featureCache.entries.keys()],['feature:0','feature:1']);});

test('point queries report an exhausted physical budget instead of returning incomplete ground',async()=>{const {source}=fixture();await assert.rejects(source.enableFeaturesAt({latDeg:0,lonDeg:0}),/sample unavailable/);assert.equal(source.featureCache.bytes,1024);});

test('coarse budget deferral happens before expensive unsavable recipe generation',async()=>{
 const {source,descriptors}=fixture(),calls=[],generate=source.featureRecipe;
 source.featureRecipe=async d=>{calls.push(d.path);return generate(d);};
 assert.deepEqual(await source.prepareMeshFeatures(bound),{loaded:2,deferred:1});
 assert.deepEqual(calls,['feature:0','feature:1']);
 await source.prepareMeshFeatures(bound);assert.equal(calls.length,2);
 source.descriptors=()=>[descriptors[2]];
 assert.deepEqual(await source.prepareMeshFeatures(bound),{loaded:1,deferred:0});
 assert.equal(calls.at(-1),'feature:2');assert.ok(source.featureCache.bytes<=1024);
});

test('wide display tiles defer physical surveys without claiming empty or certified ground',async()=>{
 const {source}=fixture();let calls=0;const generate=source.featureRecipe;
 source.featureRecipe=async d=>{calls++;return generate(d);};
 assert.deepEqual(await source.prepareMeshFeatures(bound,undefined,{maxSurveyRadiusM:10}),{loaded:0,deferred:3});
 assert.equal(calls,0);assert.equal(source.groundBoundsCertified(bound),false);
 assert.deepEqual(await source.prepareMeshFeatures(bound,undefined,{maxSurveyRadiusM:100}),{loaded:2,deferred:1});assert.equal(calls,2);
 // Physical point queries do not inherit the display-only shortcut.
 await assert.rejects(source.enableFeaturesAt({latDeg:0,lonDeg:0}),/sample unavailable/);
});
