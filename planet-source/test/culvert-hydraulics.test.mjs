import test from 'node:test';import assert from 'node:assert/strict';
import {CIRCULAR_CULVERT_MODEL,circularSection,circularCulvertFlow} from '../src/core/culvert-hydraulics.mjs';
import {submergedPipeFlow} from '../src/core/runoff-dynamics.mjs';
const p={model:CIRCULAR_CULVERT_MODEL,diameterM:1,lengthM:20,roughnessN:.015,entranceLoss:.5,exitLoss:1,inletInvertM:0,outletInvertM:0};
const near=(a,b,t=1e-10)=>assert.ok(Math.abs(a-b)<t,`${a} != ${b}`);
test('circular wet section reproduces dry, semicircle and full circle',()=>{
 near(circularSection(2,0).areaM2,0);near(circularSection(2,1).areaM2,Math.PI/2);
 near(circularSection(2,1).hydraulicRadiusM,.5);near(circularSection(2,2).areaM2,Math.PI);
 near(circularSection(2,2).hydraulicRadiusM,.5);assert.throws(()=>circularSection(-1,1));
});
test('submerged circular connection equals the independent full barrel energy equation',()=>{
 for(const [a,b] of [[3,2],[2,3],[2,2]]){const got=circularCulvertFlow(p,a,b),expected=submergedPipeFlow({...p,upstreamLevelM:a,downstreamLevelM:b});near(got.flowM3PerSecond,expected.flowM3PerSecond);}
});
test('partial circular flow is bounded, dry closes, reversed head reverses, and geometry matters',()=>{
 assert.equal(circularCulvertFlow(p,0,0).flowM3PerSecond,0);
 const a=circularCulvertFlow(p,.3,0);assert.ok(a.flowM3PerSecond>0);assert.equal(a.regime,'partial-barrel-approximation');
 near(circularCulvertFlow(p,0,.3).flowM3PerSecond,-a.flowM3PerSecond);
 assert.ok(circularCulvertFlow({...p,diameterM:.5},.3,0).flowM3PerSecond<a.flowM3PerSecond);
 assert.ok(circularCulvertFlow({...p,lengthM:2000},.3,0).flowM3PerSecond<a.flowM3PerSecond);
 assert.equal(circularCulvertFlow({...p,inletInvertM:2,outletInvertM:0},0,1).flowM3PerSecond,0);
 for(const change of [{roughnessN:0},{exitLoss:-1},{model:'invented'}])assert.throws(()=>circularCulvertFlow({...p,...change},3,2));
});
test('partial to submerged transition stays continuous under a high reverse or forward head',()=>{
 for(const lengthM of [.1,20,100]){const pipe={...p,lengthM},a=circularCulvertFlow(pipe,20,1-1e-8),b=circularCulvertFlow(pipe,20,1+1e-8);near(a.flowM3PerSecond,b.flowM3PerSecond,1e-6);}
});
import {createRunoffState,stepRunoff} from '../src/core/runoff-dynamics.mjs';
test('hydraulic links conserve mass, cannot drain below their mouth or overshoot a two-cell equilibrium',()=>{
 const state=createRunoffState({columns:2,rows:2,cellSizeM:1,groundElevationM:[0,0,0,0],waterDepthM:[3,0,0,0]});
 const hydraulics={...p,inletInvertM:1,outletInvertM:1},culverts=[{id:'pipe',fromCell:0,toCell:3,hydraulics}];
 const next=stepRunoff({...state,culverts},{seconds:60,conductanceM2PerSecond:0});
 near(next.waterVolumeM3.reduce((a,b)=>a+b,0),3);assert.ok(next.waterVolumeM3[0]>=1.5-1e-10);assert.ok(next.waterVolumeM3[3]<=1.5+1e-10);
 assert.equal(next.diagnostics.substeps,60);assert.ok(next.diagnostics.hydraulicStates.length===1);
 assert.deepEqual(state.waterVolumeM3,[3,0,0,0]);
 const drained=stepRunoff({...state,culverts:[{...culverts[0],hydraulics:{...hydraulics,outletInvertM:-10}}]}, {seconds:60,conductanceM2PerSecond:0});
 assert.ok(drained.waterVolumeM3[0]>=1-1e-10);near(drained.diagnostics.balanceErrorM3,0);
});
