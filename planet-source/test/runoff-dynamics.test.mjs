import test from'node:test';import assert from'node:assert/strict';import{createRunoffState,stepRunoff,submergedPipeFlow}from'../src/core/runoff-dynamics.mjs';
test('runoff conserves water and is nonnegative even at a large explicit step',()=>{let s=createRunoffState({columns:3,rows:2,cellSizeM:2,groundElevationM:[0,0,0,0,0,0],waterDepthM:[2,0,0,0,0,0]});for(let i=0;i<20;i++){s=stepRunoff(s,{seconds:10,rainfallMPerSecond:.001,infiltrationMPerSecond:.0002,conductanceM2PerSecond:5});assert.ok(Math.abs(s.diagnostics.balanceErrorM3)<1e-9);assert.ok(s.waterVolumeM3.every(v=>v>=0));}});
test('earthwork ridge blocks below-crest flow and a bounded culvert restores a path',()=>{
 const s=createRunoffState({columns:3,rows:2,cellSizeM:1,groundElevationM:[0,5,0,0,5,0],waterDepthM:[1,0,0,1,0,0]});
 const a=stepRunoff(s,{seconds:1});assert.equal(a.waterVolumeM3[2]+a.waterVolumeM3[5],0);
 const b=stepRunoff(s,{seconds:1,culverts:[{id:'pipe',fromCell:0,toCell:2,invertM:0,capacityM3PerSecond:.1,conductanceM2PerSecond:1}]});assert.ok(Math.abs(b.waterVolumeM3[2]+b.waterVolumeM3[5]-.1)<1e-12);assert.ok(Math.abs(b.diagnostics.balanceErrorM3)<1e-12);assert.equal(s.waterVolumeM3[0],1);
});
test('submerged barrel responds to head, roughness and downstream backwater',()=>{
 const p={diameterM:1,lengthM:20,roughnessN:.015,inletInvertM:0,outletInvertM:0,upstreamLevelM:3,downstreamLevelM:2};
 const a=submergedPipeFlow(p);assert.ok(a.flowM3PerSecond>0);assert.ok(submergedPipeFlow({...p,roughnessN:.03}).flowM3PerSecond<a.flowM3PerSecond);assert.equal(submergedPipeFlow({...p,downstreamLevelM:3}).flowM3PerSecond,0);assert.equal(submergedPipeFlow({...p,downstreamLevelM:.5}).flowM3PerSecond,null);
});

import { generatePlanet } from '../src/core/planet-generation.mjs';
import { createGlobeFeatureChart } from '../src/core/globe-features.mjs';
import { runoffFromTerrain } from '../src/core/runoff-dynamics.mjs';
test('runoff grid uses the actual generated and earthworked metric terrain',()=>{
 const w=generatePlanet({columns:32,rows:16,settlementCount:1}),chart=createGlobeFeatureChart(w.base,w.recipes[0]),bounds={minXM:-40,maxXM:40,minYM:-40,maxYM:40};
 const initial=runoffFromTerrain(chart.metricTerrain,{bounds,cellSizeM:10,initialWater:'dry'});
 assert.equal(initial.groundElevationM[0],chart.metricTerrain.groundElevationAt(-35,-35));
 const next=stepRunoff(initial,{seconds:60,rainfallMPerSecond:.00001,conductanceM2PerSecond:1});
 assert.ok(Math.abs(next.diagnostics.balanceErrorM3)<1e-10);assert.ok(next.waterVolumeM3.some(v=>v>0));assert.equal(next.sourceWorldId,w.base.worldId);
});
test('prescribed world-boundary levels exchange water with exact tracked mass and no negative cells',()=>{
 const dry=createRunoffState({columns:3,rows:2,cellSizeM:1,groundElevationM:Array(6).fill(0)}),boundary={id:'upstream',cell:0,edge:'west',levelElevationM:2,sillElevationM:0,conductanceM2PerSecond:.1};
 const wet=stepRunoff({...dry,boundaries:[boundary]},{seconds:1,conductanceM2PerSecond:0});near(wet.diagnostics.boundaryInM3,.2);near(wet.diagnostics.finalM3,.2);near(wet.diagnostics.balanceErrorM3,0);
 const drained=stepRunoff(wet,{seconds:10,conductanceM2PerSecond:0,boundaries:[{...boundary,levelElevationM:0}]});assert.ok(drained.diagnostics.boundaryOutM3>0);assert.ok(drained.waterVolumeM3.every(v=>v>=0));near(drained.diagnostics.balanceErrorM3,0);
 assert.throws(()=>stepRunoff(dry,{seconds:1,boundaries:[{...boundary,cell:1,edge:'west'}]}),/boundary/);
 assert.throws(()=>createRunoffState({columns:1e9,rows:1e9,cellSizeM:1,groundElevationM:[]}),/grid/);
});
function near(a,b){assert.ok(Math.abs(a-b)<1e-10,`${a} != ${b}`);}
