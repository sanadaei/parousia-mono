import fs from 'node:fs';import assert from 'node:assert/strict';
import {restorePlanetWorld} from '../src/core/planet-world.mjs';
import {inspectPlanetCatchments} from '../src/core/planet-catchments.mjs';
const file='examples/planet/generated/world.snapshot.json',text=fs.readFileSync(file,'utf8'),world=restorePlanetWorld(text),storm={rainfallMmPerHour:50,durationSeconds:3600,runoffCoefficient:.6,travelSpeedMPerSecond:.2},design={diametersM:[.2,.3,.4,.6,.8,1,1.2,1.5,2],upstreamDepthM:.6,downstreamDepthM:.1,safetyFactor:1.2},cases=[];
for(const recipe of world.recipes.slice(0,3))for(const collectorWidthM of [0,20])for(const cellSizeM of [5,10]){
 const options={settlementId:recipe.id,cellSizeM,collectorWidthM,storm,design},output=inspectPlanetCatchments(world,options);
 for(const a of output.assessments){assert.ok(a.catchment.areaM2>=cellSizeM**2);if(a.peak.status!=='eligible-with-explicit-assumptions')assert.equal(a.sizing,null);if(a.sizing?.selectedDiameterM)assert.ok(a.sizing.candidates.find(c=>c.diameterM===a.sizing.selectedDiameterM).passes);}
 cases.push({input:options,output});
}
assert.equal(fs.readFileSync(file,'utf8'),text);
const report={source:{file,worldId:world.worldId},cases,scope:'Real saved terrain at two fixed resolutions and 0/20m hypothetical ideal collection widths; collector conveyance is not physically modeled; no snapshot mutation. A selected diameter is conditional on disclosed game assumptions, not a calibrated or full hydrologic design.'};
fs.writeFileSync('examples/planet/verification/collectors.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(cases.map(({input,output})=>({settlement:input.settlementId,resolution:input.cellSizeM,collectorWidthM:input.collectorWidthM,pipes:output.assessments.map(a=>({areaM2:a.catchment.areaM2,status:a.catchment.status,flow:a.peak.estimatedPeakM3PerSecond,selectedDiameterM:a.sizing?.selectedDiameterM??null}))})),null,2));
