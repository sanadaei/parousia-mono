import test from 'node:test';import assert from 'node:assert/strict';
import {inspectLandforms} from '../src/core/landform-inspection.mjs';
function base({coarse=400,surface=(lat,lon)=>400+80*Math.sin(lon*100),waterDepthM=0}={}){return{toSnapshot:()=>({grid:{columns:2,rows:1},frame:{radiusM:6371000},fields:{groundElevationM:[coarse,coarse]}}),sampleSurfaceAt:(lat,lon)=>({groundElevationM:surface(lat,lon),waterDepthM})};}
test('landform targets measure saved relief deterministically with bounded calls',()=>{const b=base(),a=inspectLandforms(b);assert.deepEqual(a,inspectLandforms(b));assert.ok(a.targets.length>0);assert.ok(a.sampleCount<=2*64*33);for(const p of a.targets){assert.equal(p.kind,'hill');assert.equal(p.reliefM,p.maxElevationM-p.minElevationM);assert.equal(p.totalSamples,33);assert.equal(p.drySamples,33);}});
test('high but flat ground is not claimed as a mountain; wet and unknown surfaces withheld',()=>{assert.equal(inspectLandforms(base({coarse:5000,surface:()=>5000})).targets.length,0);for(const waterDepthM of [1,null])assert.equal(inspectLandforms(base({waterDepthM})).targets.length,0);assert.equal(inspectLandforms(base({surface:()=>NaN})).targets.length,0);});
test('inspection budgets reject invalid input and zero targets do not sample',()=>{assert.equal(inspectLandforms(base(),{perKind:0}).sampleCount,0);assert.throws(()=>inspectLandforms(base(),{candidateBudget:129}));assert.throws(()=>inspectLandforms(base(),{perKind:9}));});

import {inspectLandformShape,classifyLandformDirections,landformShapeSummary} from '../src/core/landform-inspection.mjs';
test('finite ray shape distinguishes flat, peaks, pits, ridges, valleys and slopes without changing heights',()=>{
 const cases=[[()=>100,'flat'],[(x,y)=>100-(x*x+y*y)*.001,'peak'],[(x,y)=>100+(x*x+y*y)*.001,'pit'],[(x,y)=>100-x*x*.001,'ridge'],[(x,y)=>100+x*x*.001,'valley'],[(x,y)=>100+x*.3,'slope']];
 for(const [height,expected] of cases){let calls=0;const run=()=>inspectLandformShape((x,y)=>{calls++;return height(x,y);},{radiiM:[250],stepsPerRay:16});const a=run();assert.equal(a.scales[0].form,expected);assert.equal(a.sampleCount,129);assert.deepEqual(a,run());assert.equal(calls,258);}
});
test('shape grouping is rotation/reflection invariant and complete for eight ternary directions',()=>{
 for(let pattern=0;pattern<6561;pattern++){let n=pattern;const signs=Array.from({length:8},()=>{const s=n%3-1;n=Math.floor(n/3);return s;});const form=classifyLandformDirections(signs);assert.ok(form);assert.equal(classifyLandformDirections([...signs.slice(1),signs[0]]),form);assert.equal(classifyLandformDirections([...signs].reverse()),form);}
 assert.throws(()=>classifyLandformDirections([0]));
});
test('shape survey preserves missingness, metre scales, legacy display and bounded work',()=>{
 const a=inspectLandformShape((x,y)=>x>100?null:0,{radiiM:[250]});assert.equal(a.scales[0].form,'unknown');assert.equal(a.scales[0].sampledReliefM,null);assert.ok(a.scales[0].missingSamples>0);
 const b=inspectLandformShape((x,y)=>-(x*x+y*y)*.00001,{radiiM:[10,10000]});assert.equal(b.scales[0].form,'flat');assert.equal(b.scales[1].form,'peak');assert.match(landformShapeSummary(b),/10m.*10km/);assert.equal(landformShapeSummary(null),'');
 for(const radiiM of [[],[1,1],[100001],[NaN]])assert.throws(()=>inspectLandformShape(()=>0,{radiiM}));assert.throws(()=>inspectLandformShape(()=>0,{stepsPerRay:65}));
});
