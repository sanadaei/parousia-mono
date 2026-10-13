import fs from 'node:fs';import assert from 'node:assert/strict';
import {restorePlanetWorld} from '../src/core/planet-world.mjs';import {createPlanetRunoffScenario} from '../src/core/planet-runoff.mjs';import {stepRunoff} from '../src/core/runoff-dynamics.mjs';import {runoffWaterDepths} from '../src/core/runoff-storage.mjs';
const file='examples/planet/generated/world.snapshot.json',source=fs.readFileSync(file,'utf8'),world=restorePlanetWorld(source),cases=[];
for(const recipe of world.recipes.filter(r=>r.bridgeStructures?.length).slice(0,3)){
 const outputs=[];for(const displacedStorage of [false,true]){
  const options={settlementId:recipe.id,subcellSupports:true,displacedStorage},initial=createPlanetRunoffScenario(world,options);let state=initial,maxBalanceErrorM3=0;
  for(let i=0;i<10;i++){state=stepRunoff(state,{seconds:60,rainfallMPerSecond:50/1000/3600});maxBalanceErrorM3=Math.max(maxBalanceErrorM3,Math.abs(state.diagnostics.balanceErrorM3));}
  assert.ok(maxBalanceErrorM3<1e-6);outputs.push({input:{...options,rainfallMmPerHour:50,seconds:600},output:{schema:state.schema,initialVolumeM3:initial.waterVolumeM3.reduce((a,b)=>a+b,0),finalVolumeM3:state.waterVolumeM3.reduce((a,b)=>a+b,0),maximumDepthM:Math.max(...runoffWaterDepths(state)),maxBalanceErrorM3,storage:state.scenarioDiagnostics.displacedStorage}});
 }cases.push({settlementId:recipe.id,outputs});
}
assert.equal(fs.readFileSync(file,'utf8'),source);
const report={source:{file,worldId:world.worldId},cases,scope:'Actual saved support geometry; same initial levels with different available storage; finite-volume cell floors, no momentum or subcell currents.'};fs.writeFileSync('examples/planet/verification/support-storage.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
