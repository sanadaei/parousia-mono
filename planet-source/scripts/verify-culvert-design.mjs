import fs from 'node:fs';import assert from 'node:assert/strict';
import {generatePlanetPackage} from './generate-planet.mjs';
import {restorePlanetWorld} from '../src/core/planet-world.mjs';
import {createPlanetRunoffScenario} from '../src/core/planet-runoff.mjs';
import {stepRunoff} from '../src/core/runoff-dynamics.mjs';
const design={diametersM:[.2,.3,.4,.6,.8,1],safetyFactor:1.2,headCases:[{id:'authored-design-case',targetFlowM3PerSecond:.06,upstreamDepthM:.6,downstreamDepthM:.1}]};
const directory='examples/planet/culvert-design',input={seed:'planet-1',settlementCount:1,culvertDesign:design},result=generatePlanetPackage({...input,directory});
const world=restorePlanetWorld(fs.readFileSync(`${directory}/world.snapshot.json`,'utf8')),routing=world.recipes[0].drainageRouting;
let state=createPlanetRunoffScenario(world);const steps=[];
for(let i=0;i<10;i++){state=stepRunoff(state,{seconds:60,rainfallMPerSecond:50/1000/3600});assert.ok(Math.abs(state.diagnostics.balanceErrorM3)<1e-6);steps.push(state.diagnostics);}
for(const c of state.culverts){const saved=routing.links.find(l=>l.id===c.id);assert.equal(c.hydraulics.diameterM,saved.design.selectedDiameterM);}
const report={input,worldId:result.worldId,routing,run:{seconds:600,rainfallMmPerHour:50,connectedLinks:state.culverts.length,finalM3:state.diagnostics.finalM3,maxBalanceErrorM3:Math.max(...steps.map(s=>Math.abs(s.balanceErrorM3)))},
 scope:'Design discharge and head cases are authored inputs, not inferred from the verification rain. Candidate diameter selection and saved-world runtime use the same disclosed hydraulic approximation.'};
fs.writeFileSync('examples/planet/verification/culvert-design.json',JSON.stringify(report,null,2));
console.log(JSON.stringify({worldId:report.worldId,diameters:routing.links.map(l=>({id:l.id,diameterM:l.hydraulics.diameterM})),...report.run}));
