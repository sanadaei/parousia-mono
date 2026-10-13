import test from'node:test';import assert from'node:assert/strict';
import{sizeCircularCulvert,circularCulvertFlow}from'../src/core/culvert-hydraulics.mjs';
const geometry={lengthM:12,roughnessN:.015,entranceLoss:.5,exitLoss:1,inletInvertM:1,outletInvertM:.8};
const input={geometry,diametersM:[.8,.2,.6,.4],conditions:[{id:'design',targetFlowM3PerSecond:.06,upstreamLevelM:1.6,downstreamLevelM:1}],safetyFactor:1.2};
test('culvert sizing chooses smallest sufficient supplied diameter without mutating inputs',()=>{
 const before=structuredClone(input),a=sizeCircularCulvert(input);assert.equal(a.status,'sized-within-input-model');assert.deepEqual(input,before);
 const chosen=a.candidates.find(c=>c.diameterM===a.selectedDiameterM);assert.ok(chosen.passes);assert.ok(a.candidates.filter(c=>c.diameterM<a.selectedDiameterM).every(c=>!c.passes));
 assert.equal(chosen.cases[0].availableFlowM3PerSecond,circularCulvertFlow({...geometry,model:'circular-quasi-steady@1',diameterM:a.selectedDiameterM},1.6,1).flowM3PerSecond);
});
test('all explicit head and tailwater cases constrain culvert sizing; impossible inputs stay unsized',()=>{
 const conditions=[...input.conditions,{id:'high-tailwater',targetFlowM3PerSecond:.06,upstreamLevelM:1.6,downstreamLevelM:1.599}];
 const a=sizeCircularCulvert({...input,conditions});assert.equal(a.status,'no-candidate-meets-design');assert.equal(a.selectedDiameterM,null);assert.ok(a.candidates.every(c=>!c.passes));
});
test('sizing refuses missing flow, duplicate options and unbounded or reversed conditions',()=>{
 for(const patch of[{diametersM:[]},{diametersM:[.4,.4]},{conditions:[]},{safetyFactor:.5},{conditions:[{id:'x',targetFlowM3PerSecond:0,upstreamLevelM:2,downstreamLevelM:1}]},{conditions:[{id:'x',targetFlowM3PerSecond:1,upstreamLevelM:1,downstreamLevelM:2}]}])assert.throws(()=>sizeCircularCulvert({...input,...patch}));
});
