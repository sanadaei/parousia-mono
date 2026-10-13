import test from 'node:test';import assert from 'node:assert/strict';
import {inspectVehicleSupport,planetVehicleSurface} from '../src/core/vehicle-support.mjs';
import {generatePlanet} from '../src/core/planet-generation.mjs';import {snapshotPlanetWorld,restorePlanetWorld} from '../src/core/planet-world.mjs';
const car={wheelbaseM:2.4,trackWidthM:1.6,lengthM:4,widthM:1.8,heightM:2.2};
const poses=[{xM:0,yM:0,headingRad:0},{xM:1,yM:0,headingRad:0}];
const plane=(a=0,b=0)=>((x,y)=>({supportElevationM:10+a*x+b*y,waterDepthM:0}));
test('four-wheel support reproduces an analytical sloping plane and follows its elevation',()=>{
 const r=inspectVehicleSupport({...car,poses,sampleSurface:plane(.1,.05)});
 assert.equal(r.status,'within-sampled-support-limits');
 for(const q of r.samples){assert.ok(Math.abs(q.pitchSlope-.1)<1e-12);assert.ok(Math.abs(q.rollSlope-.05)<1e-12);assert.ok(q.wheelResidualM<1e-12);assert.ok(Math.abs(q.minimumClearanceM-.2)<1e-12);}
 assert.ok(Math.abs(r.supportedPoses[1].bottomElevationM-r.supportedPoses[0].bottomElevationM-.1)<1e-12);
});
test('vehicle headings rotate world slope into longitudinal and cross slopes',()=>{
 const r=inspectVehicleSupport({...car,poses:poses.map(p=>({...p,headingRad:Math.PI/2})),sampleSurface:plane(.4,0)});
 assert.ok(Math.abs(r.samples[0].pitchSlope)<1e-12);assert.ok(Math.abs(r.samples[0].rollSlope+.4)<1e-12);assert.ok(r.violations[0].reasons.includes('roll-too-steep'));
});
test('support detects belly strike between wheels, four-wheel twist, flooding and unknown water',()=>{
 const bump=inspectVehicleSupport({...car,poses,sampleSurface:(x,y)=>({supportElevationM:Math.abs(x)<.1?1:0,waterDepthM:0})});
 assert.ok(bump.violations[0].reasons.includes('underbody-ground-contact'));
 const twist=inspectVehicleSupport({...car,poses,sampleSurface:(x,y)=>({supportElevationM:x*y,waterDepthM:0})});assert.ok(twist.violations[0].reasons.includes('wheel-plane-twist'));
 for(const [water,reason]of[[.5,'wheels-flooded'],[null,'wheel-water-unknown']]){const r=inspectVehicleSupport({...car,poses,sampleSurface:()=>({supportElevationM:0,waterDepthM:water})});assert.ok(r.violations[0].reasons.includes(reason));}
});
test('support rejects invalid dimensions and bounds work before calling terrain',()=>{
 assert.throws(()=>inspectVehicleSupport({...car,poses,trackWidthM:10,sampleSurface:plane()}));
 let calls=0;assert.throws(()=>inspectVehicleSupport({...car,poses,underbodySpacingM:1e-9,sampleSurface:()=>{calls++;return{};}}),/budget/);assert.equal(calls,0);
});
test('actual bridge deck supports wheels above the same global river',()=>{
 const w=restorePlanetWorld(snapshotPlanetWorld(generatePlanet())),r=w.recipes.find(r=>r.bridgeStructures.length),bridge=r.bridgeStructures[0],sample=planetVehicleSurface(w,r),
 x=(bridge.start.xM+bridge.end.xM)/2,y=(bridge.start.yM+bridge.end.yM)/2,q=sample(x,y);
 assert.equal(q.structureKind,'bridge-deck');assert.equal(q.waterDepthM,0);assert.ok(Math.abs(q.supportElevationM-bridge.deckElevationM)<1e-6);
 assert.throws(()=>sample(1000,1000),/chart/);
});
