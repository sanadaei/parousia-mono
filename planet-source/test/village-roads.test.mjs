import test from'node:test';import assert from'node:assert/strict';
import{extendVillageRoads}from'../src/core/village-roads.mjs';import{inspectRoadGradeSeparations}from'../src/core/road-junctions.mjs';
const roads=[{roadId:'v/main',halfWidthM:3,samples:Array.from({length:25},(_,i)=>({xM:-240+i*20,yM:0,distanceM:i*20,roadElevationM:10.12,structureKind:'fill',segmentKind:'fill'}))}];
const options={roads,groundAt:()=>10,waterAt:()=>({waterDepthM:0})};
test('generated side streets reuse exact common-height junction design deterministically',()=>{const a=extendVillageRoads(options);assert.deepEqual(a,extendVillageRoads(options));assert.equal(a.branches.length,2);assert.equal(a.roads.length,3);assert.ok(a.junctions.length>0);for(const j of inspectRoadGradeSeparations(a.roads).crossings)assert.equal(j.status,'at-grade-matched');});
test('wet and steep branch routes are rejected rather than silently becoming bridges',()=>{for(const input of[{...options,waterAt:()=>({waterDepthM:1})},{...options,groundAt:(x,y)=>10+Math.abs(y)}]){const a=extendVillageRoads(input);assert.equal(a.branches.length,0);assert.equal(a.roads,roads);assert.equal(a.diagnostics.rejected.length,6);}});
test('side street budget can retain a single-street world and rejects invalid budgets',()=>{assert.equal(extendVillageRoads({...options,maxBranches:0}).branches.length,0);assert.throws(()=>extendVillageRoads({...options,maxBranches:3}),/budget/);});

import{metricRoads}from'../src/core/road-geometry.mjs';
import{generatePlanet}from'../src/core/planet-generation.mjs';
import{snapshotPlanetWorld,restorePlanetWorld}from'../src/core/planet-world.mjs';
test('rotated T junctions remain connected after repeatedly designing another street',()=>{
 for(const angle of[.1,.59,1.17,2.4]){const c=Math.cos(angle),s=Math.sin(angle),rotated=roads.map(r=>({...r,samples:r.samples.map(p=>({...p,xM:p.xM*c,yM:p.xM*s}))})),a=extendVillageRoads({...options,roads:rotated});assert.equal(a.branches.length,2);for(const b of a.branches)assert.ok(a.junctions.some(j=>j.roadIds.includes(b.roadId)),b.roadId);assert.doesNotThrow(()=>metricRoads(a.roads));}
});
test('real generated villages preserve saved bridge decks and connect branches through restore',()=>{
 for(const seed of['planet-1','planet-a','planet-b']){const w=generatePlanet({seed,settlementCount:2}),saved=snapshotPlanetWorld(w),restored=restorePlanetWorld(saved);assert.deepEqual(restored.toSnapshot(),saved);
 for(const r of w.recipes){assert.ok(r.streetGeneration.accepted>0);assert.equal(r.roadCenterlineProfiles.length,1+r.streetGeneration.accepted);for(const road of r.roadCenterlineProfiles.slice(1))assert.ok(r.roadJunctions.some(j=>j.roadIds.includes(road.roadId)));}}
});
test('explicit single-street option preserves the simpler bounded generation mode',()=>{const w=generatePlanet({settlementCount:1,villageRoads:false});assert.equal(w.recipes[0].roadCenterlineProfiles.length,1);assert.equal(w.recipes[0].roadJunctions.length,0);assert.throws(()=>generatePlanet({villageRoads:'yes'}),/boolean/);});

test('unknown water cannot be treated as a dry side street',()=>{const a=extendVillageRoads({...options,waterAt:()=>({waterDepthM:null})});assert.equal(a.branches.length,0);assert.ok(a.diagnostics.rejected.every(r=>r.reason==='unknown-water'));});
