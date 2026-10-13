import test from'node:test';import assert from'node:assert/strict';import{inspectVehicleStability}from'../src/core/vehicle-stability.mjs';
const support=(pitch=0,roll=0)=>({status:'within-sampled-support-limits',samples:[{index:0,pitchSlope:pitch,rollSlope:roll}]});
const input={wheelbaseM:3,trackWidthM:2,centerOfMassHeightM:1,frictionCoefficient:.6,speedMPerSecond:0};
test('flat stationary vehicle has gravity load at the contact center and no friction demand',()=>{const r=inspectVehicleStability(support(),input);assert.equal(r.status,'within-quasi-static-limits');assert.equal(r.samples[0].normalLoadPerKg,9.80665);assert.equal(r.samples[0].frictionDemand,0);assert.equal(Math.abs(r.samples[0].loadPointYM),0);});
test('turning acceleration has the analytical friction and rollover thresholds on flat ground',()=>{const r=inspectVehicleStability(support(),{...input,speedMPerSecond:10,curvaturePerM:.1});assert.equal(r.lateralAccelerationMPerSecond2,10);assert.ok(Math.abs(r.samples[0].frictionDemand-10/9.80665)<1e-12);assert.deepEqual(r.samples[0].reasons,['insufficient-friction','lateral-tip-risk']);
 const opposite=inspectVehicleStability(support(),{...input,speedMPerSecond:10,curvaturePerM:-.1});assert.equal(opposite.samples[0].loadPointYM,-r.samples[0].loadPointYM);
});
test('slope and prescribed braking contribute to slip and tip tests without erasing support failure',()=>{const r=inspectVehicleStability({...support(.4),status:'support-constraints-unmet'},{...input,frictionCoefficient:.3});assert.ok(Math.abs(r.samples[0].frictionDemand-.4)<1e-12);assert.equal(r.supportStatus,'support-constraints-unmet');assert.ok(r.violations.length);const braking=inspectVehicleStability(support(),{...input,longitudinalAccelerationMPerSecond2:-20});assert.ok(braking.samples[0].reasons.includes('longitudinal-tip-risk'));});
test('stability assessment requires explicit friction and CG and rejects nonfinite work',()=>{for(const patch of[{frictionCoefficient:undefined},{centerOfMassHeightM:0},{speedMPerSecond:-1},{curvaturePerM:Infinity}])assert.throws(()=>inspectVehicleStability(support(),{...input,...patch}));assert.throws(()=>inspectVehicleStability({samples:[]},input));});
import{bicycleAccelerationProfile}from'../src/core/vehicle-stability.mjs';import{traceVehicleTurn}from'../src/core/vehicle-sweep.mjs';
test('bicycle acceleration metadata follows turns and stops lateral forcing on the straight section',()=>{
 const motion=traceVehicleTurn({start:{xM:0,yM:0,headingRad:0,bottomElevationM:0},wheelbaseM:3,commands:[{distanceM:5,steeringRad:.3},{distanceM:10,steeringRad:0}]}),profile=bicycleAccelerationProfile(motion,{speedMPerSecond:4,wheelbaseM:3});
 assert.equal(profile.curvaturePerM.length,motion.poses.length);assert.equal(profile.curvaturePerM[0],Math.tan(.3)/3);assert.equal(profile.curvaturePerM.at(-1),0);
 const samples=motion.poses.map((_,index)=>({index,pitchSlope:0,rollSlope:0})),r=inspectVehicleStability({samples},{...input,speedMPerSecond:4,...profile});
 assert.equal(r.samples.at(-1).frictionDemand,0);assert.ok(r.samples[0].frictionDemand>0);assert.ok(profile.longitudinalAccelerationMPerSecond2[0]<0);
 assert.throws(()=>inspectVehicleStability({samples},{...input,curvaturePerM:[0]}));
});
