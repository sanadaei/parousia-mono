import fs from 'node:fs';import assert from 'node:assert/strict';
import {generatePlanet}from'../src/core/planet-generation.mjs';import{createPlanetRunoffScenario}from'../src/core/planet-runoff.mjs';import{stepRunoff}from'../src/core/runoff-dynamics.mjs';import{requireVerificationMemory}from'./verification-runtime.mjs';
requireVerificationMemory();const world=generatePlanet(),results=[];
for(const recipe of world.recipes.filter(r=>r.bridgeStructures?.length)){
 const initial=createPlanetRunoffScenario(world,{settlementId:recipe.id,subcellSupports:true});let state=initial,unobstructed={...initial,faceObstructions:[]},maxBalanceErrorM3=0;
 for(let i=0;i<10;i++){state=stepRunoff(state,{seconds:60,rainfallMPerSecond:50/1000/3600});unobstructed=stepRunoff(unobstructed,{seconds:60,rainfallMPerSecond:50/1000/3600});maxBalanceErrorM3=Math.max(maxBalanceErrorM3,Math.abs(state.diagnostics.balanceErrorM3));}
 assert.ok(maxBalanceErrorM3<1e-6);assert.ok(state.waterVolumeM3.every(v=>v>=0));
 const maxDepthDifferenceM=Math.max(...state.waterVolumeM3.map((v,i)=>Math.abs(v-unobstructed.waterVolumeM3[i])/25));
 results.push({settlementId:recipe.id,input:{cellSizeM:5,rainfallMmPerHour:50,seconds:600},obstructions:initial.scenarioDiagnostics.supportFaceObstructions,initialWaterM3:initial.waterVolumeM3.reduce((a,b)=>a+b,0),finalWaterM3:state.diagnostics.finalM3,unobstructedFinalWaterM3:unobstructed.diagnostics.finalM3,maxDepthDifferenceM,maxBalanceErrorM3});
}
assert.ok(results.some(r=>r.maxDepthDifferenceM>1e-6));
const report={sourceWorldId:world.worldId,results,scope:'Same initial reservoir storage and terrain, with versus without exact saved-pier face obstructions. This isolates face conductance; displaced storage, within-cell flow, momentum and scour remain outside the model.'};
fs.writeFileSync('examples/planet/verification/support-runoff.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
