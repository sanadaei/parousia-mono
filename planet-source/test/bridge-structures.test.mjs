import test from 'node:test';import assert from 'node:assert/strict';
import {assessBeamSpan,buildBridgeStructure,validateBridgeStructures,GENERATED_TIMBER} from '../src/core/bridge-structures.mjs';
const material={densityKgPerM3:1000,elasticModulusPa:1e9,shearModulusPa:1e8,allowableBendingPa:2e6,allowableShearPa:1e6};
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-10*Math.max(1,Math.abs(b)),`${a} != ${b}`);
test('rectangular simply supported beam matches independent uniform and centre-load calculations',()=>{
 const uniform=assessBeamSpan({spanM:10,widthM:.2,depthM:.5,gravityMPerS2:1,material,uniformLoadNPerM:900});
 near(uniform.uniformLoadNPerM,1000);near(uniform.momentNm,12500);near(uniform.shearN,5000);near(uniform.bendingPa,1500000);near(uniform.shearPa,75000);near(uniform.bendingDeflectionM,.0625);near(uniform.shearDeflectionM,.0015);assert.equal(uniform.status,'over-capacity');
 const point=assessBeamSpan({spanM:10,widthM:.2,depthM:.5,gravityMPerS2:1,material,centerLoadN:1000});near(point.momentNm,3750);near(point.deflectionM,.0167);assert.equal(point.status,'within-input-model');
});
test('missing material data, thick beams and invalid numbers never receive an unconditional strength pass',()=>{
 assert.equal(assessBeamSpan({spanM:10,widthM:.2,depthM:.5,material:{}}).status,'insufficient-material-data');
 assert.equal(assessBeamSpan({spanM:2,widthM:.2,depthM:.5,material}).status,'outside-slender-beam-model');
 assert.throws(()=>assessBeamSpan({spanM:NaN,widthM:.2,depthM:.5,material}));
});
test('bridge geometry, support elevations, road depth and beam assessment share one design',()=>{
 const s=buildBridgeStructure({id:'bridge',roadId:'road',start:{xM:0,yM:0},end:{xM:80,yM:0},deckElevationM:10,widthM:6,groundAt:()=>3});
 assert.equal(s.spanCount,10);assert.equal(s.supports.length,11);assert.equal(s.assessment.status,'within-input-model');assert.equal(s.foundationStatus,'unresolved-ground-bearing-and-scour');
 const roads=[{id:'road',halfWidthM:3,deckThicknessM:.8,structureKind:'bridge-deck',points:[{xM:0,yM:0,roadElevationM:10},{xM:80,yM:0,roadElevationM:10}]}];
 validateBridgeStructures([s],roads,()=>3);validateBridgeStructures([s],roads,()=>3+1e-9);assert.deepEqual(s.material,GENERATED_TIMBER);
 const bad=structuredClone(s);bad.boxes[0].bottomElevationM-=1;assert.throws(()=>validateBridgeStructures([bad],roads),/inconsistent/);
 assert.throws(()=>validateBridgeStructures([s],roads,()=>2),/inconsistent/);
});
