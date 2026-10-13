import test from'node:test';import assert from'node:assert/strict';
import{assessSupportBase,inspectBridgeFoundations}from'../src/core/bridge-foundations.mjs';import{buildBridgeStructure}from'../src/core/bridge-structures.mjs';
const input={lengthM:2,widthM:3,verticalLoadN:60000,allowableBearingPa:20000,frictionCoefficient:.5,embedDepthM:1,scourDepthM:0};
test('support contact matches N/A and linear eccentric pressure independently',()=>{
 const a=assessSupportBase(input);assert.equal(a.meanPressurePa,10000);assert.equal(a.status,'within-input-conditions');assert.equal(a.frictionCapacityN,30000);
 const b=assessSupportBase({...input,momentAlongNm:10000});assert.equal(b.minPressurePa,5000);assert.equal(b.maxPressurePa,15000);
 const c=assessSupportBase({...input,momentAlongNm:10000,momentAcrossNm:15000});assert.equal(c.minPressurePa,0);assert.equal(c.maxPressurePa,20000);
});
test('unknown soil, partial contact, overload, sliding and exposed bases never pass',()=>{
 assert.equal(assessSupportBase({...input,allowableBearingPa:undefined}).status,'insufficient-ground-data');assert.equal(assessSupportBase({...input,verticalLoadN:0}).status,'no-compressive-contact');
 for(const [patch,reason]of [[{momentAlongNm:30000},'partial-contact-outside-model'],[{allowableBearingPa:5000},'bearing-pressure-exceeded'],[{horizontalLoadN:30001},'sliding-demand-exceeded'],[{scourDepthM:1},'base-exposed-by-specified-scour']])assert.ok(assessSupportBase({...input,...patch}).violations.includes(reason));
 assert.throws(()=>assessSupportBase({...input,scourDepthM:-1}));
});
test('actual bridge reactions conserve deck load and assign one vehicle, without mutating its save',()=>{
 const s=buildBridgeStructure({id:'bridge',roadId:'road',start:{xM:0,yM:0},end:{xM:24,yM:0},deckElevationM:10,widthM:6,groundAt:()=>3}),before=JSON.stringify(s),options={allowableBearingPa:200000,frictionCoefficient:.5,scourDepthM:0,supportDensityKgPerM3:2400};
 const a=inspectBridgeFoundations(s,options),b=inspectBridgeFoundations(s,{...options,vehicleSpanIndex:2});
 assert.ok(Math.abs(a.totalReactionN-a.totalDeckAndTrafficLoadN)<1e-8);assert.equal(a.supports.length,4);assert.equal(a.supports[0].reactionN-b.supports[0].reactionN,20000);assert.equal(JSON.stringify(s),before);
 assert.equal(inspectBridgeFoundations(s).status,'insufficient-ground-data');assert.throws(()=>inspectBridgeFoundations(s,{...options,vehicleSpanIndex:3}));
 const scour=inspectBridgeFoundations(s,{...options,scourDepthM:2});assert.ok(scour.supports.every(r=>r.assessment.violations.includes('base-exposed-by-specified-scour')));
});
