import fs from'node:fs';import{generatePlanet}from'../src/core/planet-generation.mjs';import{createPlanetRunoffScenario}from'../src/core/planet-runoff.mjs';import{stepRunoff}from'../src/core/runoff-dynamics.mjs';import{requireVerificationMemory}from'./verification-runtime.mjs';import assert from'node:assert/strict';
requireVerificationMemory();const world=generatePlanet(),initial=createPlanetRunoffScenario(world,{cellSizeM:5}),rainfallMmPerHour=50,steps=[];let state=initial;
for(let i=0;i<10;i++){state=stepRunoff(state,{seconds:60,rainfallMPerSecond:rainfallMmPerHour/1000/3600});assert.ok(Math.abs(state.diagnostics.balanceErrorM3)<1e-6);steps.push({elapsedSeconds:state.elapsedSeconds,...state.diagnostics});}
let closed=createPlanetRunoffScenario(world,{cellSizeM:5,includeDrainage:false});
for(let i=0;i<10;i++)closed=stepRunoff(closed,{seconds:60,rainfallMPerSecond:rainfallMmPerHour/1000/3600});
const drainageComparison={savedLinks:world.recipes[0].drainageRouting.links.length,connectedLinks:initial.culverts.length,
 transferredM3:steps.reduce((sum,s)=>sum+s.culvertTransfers.reduce((a,f)=>a+f.volumeM3,0),0),
 maxDepthDifferenceM:Math.max(...state.waterVolumeM3.map((v,i)=>Math.abs(v-closed.waterVolumeM3[i])/25)),
 closedFinalM3:closed.diagnostics.finalM3};
assert.ok(drainageComparison.connectedLinks>0);assert.ok(drainageComparison.transferredM3>0);assert.ok(drainageComparison.maxDepthDifferenceM>0);
const samples=[0,450,1800,2800,3599].map(cell=>({cell,groundElevationM:state.groundElevationM[cell],beforeDepthM:initial.waterVolumeM3[cell]/25,afterDepthM:state.waterVolumeM3[cell]/25}));
const report={input:{seed:'planet-1',settlementId:initial.sourceRegionId,cellSizeM:5,rainfallMmPerHour,seconds:600},sourceWorldId:state.sourceWorldId,initialDiagnostics:initial.diagnostics,steps,samples,drainageComparison,
 scope:'actual saved-world terrain, global river and road/building/pier geometry; prescribed boundary levels; fixed-grid surface reservoirs and saved circular quasi-steady hydraulic links; partial-barrel game approximation, not full momentum/backwater/erosion hydrodynamics'};
fs.writeFileSync('examples/planet/verification/runoff.json',JSON.stringify(report,null,2));fs.writeFileSync('examples/planet/verification/runoff-initial.json',JSON.stringify(initial));fs.writeFileSync('examples/planet/verification/runoff-after.json',JSON.stringify(state));console.log(JSON.stringify({cells:state.columns*state.rows,sourceWorldId:state.sourceWorldId,elapsedSeconds:state.elapsedSeconds,finalM3:state.diagnostics.finalM3,maxBalanceErrorM3:Math.max(...steps.map(s=>Math.abs(s.balanceErrorM3))),unresolvedPiers:initial.diagnostics.unresolvedSubcellSupports.length,drainageComparison}));
