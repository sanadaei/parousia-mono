import test from 'node:test';import assert from 'node:assert/strict';
import {classifyEnvironment,COVER_TYPES} from '../src/core/environment-cover.mjs';
const c={biome:'temperate_forest',temperatureC:15,annualRainMm:1000,soilMoisture:.6,slopeMPerM:.1};
test('climate, local water and slope produce distinct environments on identical height input',()=>{
 assert.equal(classifyEnvironment(c).kind,'forest');
 assert.equal(classifyEnvironment({...c,biome:'desert',soilMoisture:0}).kind,'desert');
 assert.equal(classifyEnvironment({...c,biome:'tundra'}).kind,'tundra');
 assert.equal(classifyEnvironment({...c,biome:'ice'}).kind,'snow');
 assert.equal(classifyEnvironment({...c,slopeMPerM:1}).kind,'rock');
 assert.equal(classifyEnvironment({...c,waterDepthM:2}).kind,'water');
});
test('riparian corridor depends on both distance and relative height, not a green stripe over cliffs',()=>{
 const desert={...c,biome:'desert',soilMoisture:0,riverDistanceM:10,heightAboveRiverM:1};
 assert.equal(classifyEnvironment(desert).kind,'riparian_woodland');
 assert.equal(classifyEnvironment({...desert,heightAboveRiverM:50}).kind,'desert');
 assert.equal(classifyEnvironment({...desert,riverDistanceM:1000}).kind,'desert');
 assert.equal(classifyEnvironment({...desert,slopeMPerM:.01}).kind,'wetland');
});
test('wetland traversal differs from pasture and water is not walkable',()=>{
 assert.ok(COVER_TYPES.wetland.travelCost>COVER_TYPES.grassland.travelCost);
 assert.equal(COVER_TYPES.water.travelCost,null);
 assert.throws(()=>classifyEnvironment({...c,soilMoisture:2}));
 assert.deepEqual(classifyEnvironment(c),classifyEnvironment(c));
});

import {VALLEY_ENVIRONMENT_POLICY} from '../src/core/environment-cover.mjs';
test('new environment follows saved valley width but old policy and high ground remain unchanged',()=>{
 const valley={...c,riverDistanceM:300,heightAboveRiverM:1,slopeMPerM:.01,valleyFloorWidthM:400};
 assert.equal(classifyEnvironment(valley).kind,'forest');
 const v=classifyEnvironment({...valley,policy:VALLEY_ENVIRONMENT_POLICY});assert.equal(v.kind,'wetland');assert.ok(v.reasons.includes('saved-valley-floor-context'));assert.equal(v.waterDepthM,undefined);
 assert.equal(classifyEnvironment({...valley,policy:VALLEY_ENVIRONMENT_POLICY,heightAboveRiverM:30}).kind,'forest');
 assert.equal(classifyEnvironment({...valley,policy:VALLEY_ENVIRONMENT_POLICY,valleyFloorWidthM:0}).kind,'forest');
 assert.equal(classifyEnvironment({...valley,policy:VALLEY_ENVIRONMENT_POLICY,riverDistanceM:1100,valleyFloorWidthM:5000}).kind,'forest');
 assert.throws(()=>classifyEnvironment({...valley,policy:'bad'}),/policy/);
 assert.throws(()=>classifyEnvironment({...valley,valleyFloorWidthM:-1}),/width/);
});
