import test from'node:test';import assert from'node:assert/strict';import{generatePlanet}from'../src/core/planet-generation.mjs';import{createPlanetRunoffScenario}from'../src/core/planet-runoff.mjs';import{stepRunoff}from'../src/core/runoff-dynamics.mjs';
test('generated-world runoff starts with the real global river and exchanges flow through the world boundary',()=>{
 const w=generatePlanet(),state=createPlanetRunoffScenario(w,{cellSizeM:10});assert.ok(state.waterVolumeM3.some(v=>v>0));assert.equal(state.sourceRegionId,w.recipes[0].id);assert.equal(state.boundaries.length,120);
 assert.ok(state.diagnostics.unresolvedSubcellSupports.length>0,'coarse cells must disclose unresolved piers');
 const next=stepRunoff(state,{seconds:30,rainfallMPerSecond:.00002});assert.ok(Math.abs(next.diagnostics.balanceErrorM3)<1e-6);assert.ok(next.waterVolumeM3.every(v=>v>=0));assert.equal(next.diagnostics.boundary,'prescribed-head');assert.ok(next.diagnostics.boundaryInM3+next.diagnostics.boundaryOutM3>0);
 assert.equal(state.elapsedSeconds,0);assert.equal(next.sourceWorldId,state.sourceWorldId);
});

test('saved-world pier faces affect runoff without inventing replacement supports',()=>{
 const world=generatePlanet(),state=createPlanetRunoffScenario(world,{cellSizeM:5,subcellSupports:true}),report=state.scenarioDiagnostics.supportFaceObstructions;
 assert.ok(report.faces>0);assert.ok(report.coupledSupportIds.length>0);assert.equal(report.coupledSupportIds.length+report.unresolvedSupportIds.length,world.recipes[0].bridgeStructures.flatMap(s=>s.boxes.filter(b=>b.id.includes('/support:'))).length);
 const next=stepRunoff(state,{seconds:10});const open=stepRunoff({...state,faceObstructions:[]},{seconds:10});
 assert.ok(next.waterVolumeM3.some((v,i)=>Math.abs(v-open.waterVolumeM3[i])>1e-9));assert.ok(Math.abs(next.diagnostics.balanceErrorM3)<1e-6);
});
