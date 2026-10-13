import test from'node:test';import assert from'node:assert/strict';import{PagedSource}from'../src/globe/paged-source.mjs';
test('sea and river queries reuse one exact base evaluation outside feature charts',()=>{
 let calls=0;const source=Object.assign(Object.create(PagedSource.prototype),{manifest:{sea:{}},evaluate:()=>{calls++;return{ground:-5};},riverAt:()=>({groundElevationM:-6,waterLevelElevationM:0,waterDepthM:6,waterSourceIds:['river']}),planetWater:(_lat,_lon,z)=>({surfaceKind:'sea-level-water',waterLevelElevationM:0,waterDepthM:-z,waterSourceIds:['sea']}),base:{groundElevationAt(){throw new Error('Repeated base query');}}});const s=source.sample(0,0);assert.equal(calls,1);assert.equal(s.groundElevationM,-6);assert.equal(s.waterDepthM,6);assert.deepEqual(s.waterSourceIds,['river']);
});
test('old no-sea sources retain their original local sampling route',()=>{let calls=0;const source=Object.assign(Object.create(PagedSource.prototype),{manifest:{},base:{groundElevationAt(){calls++;return 12;}},evaluate(){throw new Error('New sea route reached');}});const s=source.sample(0,0);assert.equal(calls,1);assert.equal(s.groundElevationM,12);assert.equal(s.waterDepthM,null);});
test('published crossing policy v2 reaches the actual paged road and bridge builder',async()=>{
 const wet=lon=>lon>.0044&&lon<.0048,R=6371000,source=Object.assign(Object.create(PagedSource.prototype),{
 manifest:{settlementCatalogue:{riverCrossingPolicy:'bounded-game-timber-crossings@2'}},settlementPages:{roadNeighbors:async()=>[]},
 base:{frame:{radiusM:R},groundElevationAt:(lat,lon)=>wet(lon)?15:20},evaluate:p=>({ground:wet(p.lonDeg)?15:20}),riverAt:()=>null,
 planetWater:(lat,lon)=>({waterDepthM:wet(lon)?4:0,waterLevelElevationM:19,waterSourceIds:wet(lon)?['river:test']:[]})});
 const recipe=await source.featureRecipe({procedural:true,roadLink:{id:'published-v2',fromPoint:{latDeg:0,lonDeg:0},toPoint:{latDeg:0,lonDeg:.01},distanceM:1112}});
 assert.equal(recipe.routeStatus.status,'surveyed-local-route');assert.equal(recipe.bridgeStructures.length,1);assert.equal(recipe.bridgeStructures[0].assessment.status,'within-input-model');
});
