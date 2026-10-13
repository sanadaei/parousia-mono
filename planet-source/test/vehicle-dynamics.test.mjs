import test from'node:test';import assert from'node:assert/strict';
import{simulateVehicleDynamics,timeVehicleMotion}from'../src/core/vehicle-dynamics.mjs';import{traceVehicleTurn}from'../src/core/vehicle-sweep.mjs';
const poses=[{xM:0,yM:0,headingRad:0,timeSeconds:0},{xM:0,yM:0,headingRad:0,timeSeconds:3}],flat=()=>({supportElevationM:0}),input={poses,sampleSurface:flat,wheelbaseM:2.4,trackWidthM:1.6,lengthM:4,widthM:1.8,centerOfMassHeightM:.9,groundClearanceM:.2,massKg:1200,pitchInertiaKgM2:2000,rollInertiaKgM2:600,springNPerM:30000,damperNsPerM:2500,settleSeconds:0};
test('four springs sustain exact stationary gravitational equilibrium',()=>{
 const r=simulateVehicleDynamics(input);assert.equal(r.status,'within-sampled-dynamic-conditions');assert.equal(r.completedDurationSeconds,3);
 for(const s of r.samples){assert.ok(Math.abs(s.bodyElevationM-.9)<1e-12);assert.ok(Math.abs(s.appliedWheelForcesN.reduce((a,b)=>a+b,0)-1200*9.80665)<1e-8);assert.ok(Math.abs(s.pitchRad)<1e-12);assert.ok(Math.abs(s.rollRad)<1e-12);}
 assert.ok(Math.abs(r.minimumClearanceM-.2)<1e-12);assert.equal(r.eventListTruncated,false);
});
test('damping settles an explicit displacement and time refinement converges',()=>{
 const a=simulateVehicleDynamics({...input,initialVerticalOffsetM:.02}),b=simulateVehicleDynamics({...input,initialVerticalOffsetM:.02,timeStepSeconds:.0025});
 assert.ok(Math.abs(a.samples.at(-1).bodyElevationM-.9)<1e-5);assert.ok(Math.abs(a.samples.at(-1).bodyElevationM-b.samples.at(-1).bodyElevationM)<1e-5);
 assert.ok(Math.abs(a.samples[0].bodyElevationM-.92)<1e-12);
});
test('timed bicycle arcs use rear axle travel and include body-centre inertial forcing',()=>{
 const motion=traceVehicleTurn({start:{xM:0,yM:0,headingRad:0,bottomElevationM:0},wheelbaseM:2.4,commands:[{distanceM:8,steeringRad:.3},{distanceM:5,steeringRad:0}]}),timed=timeVehicleMotion(motion,{speedMPerSecond:2,wheelbaseM:2.4});
 assert.ok(Math.abs(timed.at(-1).timeSeconds-6.5)<1e-10);assert.ok(timed[0].lateralAccelerationMPerSecond2>0);assert.ok(timed[0].longitudinalAccelerationMPerSecond2<0);assert.equal(timed.at(-2).lateralAccelerationMPerSecond2,0);
 const stationary=timeVehicleMotion(motion,{speedMPerSecond:0,wheelbaseM:2.4});assert.equal(stationary.length,2);assert.equal(stationary[0].xM,stationary[1].xM);
});
test('prescribed cornering causes transient roll and excessive motion stops outside the model',()=>{
 const corner=poses.map(p=>({...p,lateralAccelerationMPerSecond2:3})),r=simulateVehicleDynamics({...input,poses:corner});assert.ok(r.maximumRollRad>.02);assert.ok(r.samples.find(s=>s.timeSeconds>.5).rollRad>0);
 const extreme=simulateVehicleDynamics({...input,poses:poses.map(p=>({...p,lateralAccelerationMPerSecond2:100}))});assert.equal(extreme.status,'small-angle-domain-exceeded');assert.ok(extreme.completedDurationSeconds<3);
});
test('actual terrain samples between initial poses drive heave and clearance diagnostics',()=>{
 const path=[poses[0],{...poses[1],xM:8}],sampleSurface=(x,y)=>({supportElevationM:.06*Math.sin(x*2)+.01*y}),r=simulateVehicleDynamics({...input,poses:path,sampleSurface});
 assert.ok(r.samples.some(s=>Math.abs(s.bodyElevationM-.9)>.01));assert.ok(r.probes>1000);assert.ok(r.maximumCompressionM>0);assert.ok(Number.isFinite(r.minimumClearanceM));
});
test('invalid or unbounded dynamic work is refused without allocating an enormous trace',()=>{
 for(const patch of[{massKg:0},{damperNsPerM:-1},{timeStepSeconds:1e-10},{poses:[poses[0],poses[0]]},{maxAngleRad:1},{poses:[poses[0],{...poses[1],timeSeconds:121}]}])assert.throws(()=>simulateVehicleDynamics({...input,...patch}));
 assert.throws(()=>timeVehicleMotion({poses,segmentCurvaturePerM:[0]},{speedMPerSecond:-1,wheelbaseM:2.4}));
});
import fs from 'node:fs';import {restorePlanetWorld} from '../src/core/planet-world.mjs';import {metricRoads} from '../src/core/road-geometry.mjs';import {runVehicleJob} from '../src/globe/vehicle-job.mjs';
test('vehicle Worker uses actual saved road and ground and rejects a mismatched world',()=>{
 const snapshot=fs.readFileSync(new URL('../examples/planet/generated/world.snapshot.json',import.meta.url),'utf8'),world=restorePlanetWorld(snapshot),r=world.recipes[0],road=metricRoads(r.roadCenterlineProfiles)[0],a=road.at(80),b=road.at(80.1),motion=traceVehicleTurn({start:{xM:a.xM,yM:a.yM,headingRad:Math.atan2(b.yM-a.yM,b.xM-a.xM),bottomElevationM:a.roadElevationM},wheelbaseM:2.4,commands:[{distanceM:2,steeringRad:0}]}),{sampleSurface,poses,...parameters}=input,
 job={type:'dynamics',snapshot,expectedWorldId:world.worldId,settlementId:r.id,motion,speedMPerSecond:2,parameters};
 const out=runVehicleJob(job);assert.equal(out.worldId,world.worldId);assert.ok(Math.abs(out.result.completedDurationSeconds-1)<1e-12);assert.ok(out.result.probes>1000);assert.ok(out.result.samples[0].bodyElevationM>a.roadElevationM);
 assert.throws(()=>runVehicleJob({...job,expectedWorldId:'wrong'}),/一致/);assert.throws(()=>runVehicleJob({...job,settlementId:'missing'}),/Unknown/);
});
