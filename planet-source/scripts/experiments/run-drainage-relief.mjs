#!/usr/bin/env node
// Research-only: explicit shared skeleton -> one evolved field -> existing format.
// Never regenerate separate view tiles, or silently insert this into a planet.
import fs from 'node:fs';
import path from 'node:path';
import { createDrainageEnvelope } from './drainage-envelope.mjs';
import { evolveRelief } from './mst-relief.mjs';
import { reliefTerrain } from './relief-terrain.mjs';
import { createTerrainAdapter, restoreTerrain } from '../../src/core/index.mjs';
import { hashJson } from '../../src/core/json-contract.mjs';
import { delineateGridCatchments } from '../../src/core/catchment-flow.mjs';
const [inputFile,outputDir]=process.argv.slice(2);
if(!inputFile||!outputDir)throw new Error('Usage: run-drainage-relief.mjs INPUT_JSON NEW_OUTPUT_DIRECTORY');
if(fs.statSync(inputFile).size>2*1024*1024)throw new RangeError('Research input exceeds 2 MiB');
const input=JSON.parse(fs.readFileSync(inputFile,'utf8'));
const envelope=createDrainageEnvelope(input.skeleton);
if(!envelope.diagnostics.compatibleAtSampledPoints)throw new RangeError('Sampled channel height conflicts; refuse silent reconciliation');
const {n,extentM,originXM=0,originYM=0}=input.grid??{},initial=envelope.sampleGrid(input.grid);
const terminals=new Set(envelope.diagnostics.terminals);
const outlets=envelope.contract.nodes.filter(p=>terminals.has(p.id)).map(p=>{
 const x=(p.xM-originXM)*(n-1)/extentM,y=(p.yM-originYM)*(n-1)/extentM;
 if(x<0||y<0||x>n-1||y>n-1||Math.abs(x-Math.round(x))>1e-8||Math.abs(y-Math.round(y))>1e-8)throw new RangeError('Declared terminal must occupy a grid node');
 return Math.round(y)*n+Math.round(x);
});
if(envelope.contract.nodes.some(p=>p.xM<originXM||p.xM>originXM+extentM||p.yM<originYM||p.yM>originYM+extentM))throw new RangeError('Skeleton lies outside the shared regional domain');
if(!input.forcing||!['steps','dtYears','erodibility','upliftMPerYear'].every(k=>Object.hasOwn(input.forcing,k)))throw new TypeError('Explicit forcing required');
fs.mkdirSync(outputDir,{recursive:true});
for(const name of ['input.json','terrain.json','report.json'])if(fs.existsSync(path.join(outputDir,name)))throw new Error('Output exists; choose a new directory');
const result=evolveRelief({...input.forcing,n,extentM,initial,outlets});
const state=reliefTerrain(result,{seed:hashJson(input),verticalDatum:input.verticalDatum??'synthetic-skeleton-datum'}).toSnapshot();
delete state.worldId;
state.references.reliefResearch.initialSkeleton={id:envelope.id,contract:envelope.contract,
 sourceOriginM:{x:originXM,y:originYM},diagnostics:envelope.diagnostics,
 limitation:'Final flow may differ from the initial skeleton. Closed external edges are not planetary ridge coupling.'};
const terrain=createTerrainAdapter(state),saved=terrain.toSnapshot();
if(restoreTerrain(JSON.stringify(saved)).worldId!==terrain.worldId)throw new Error('Canonical restoration failed');
// Reuse the actual strict-ground catchment implementation. Graph area routed
// through a depression is not evidence of runoff reaching a physical outlet.
const strictGroundCatchments=n*n<=65536?delineateGridCatchments({
 ...saved.grid,originXM:saved.frame.originXM,originYM:saved.frame.originYM,
 groundElevationM:saved.fields.groundElevationM,
 outlets:outlets.map(cell=>({id:`outlet:${cell}`,xM:(cell%n)*extentM/(n-1),yM:Math.floor(cell/n)*extentM/(n-1)})),
}):{status:'not-run:grid-exceeds-existing-catchment-limit',limit:65536};
const uphillEdges=[];
for(let i=0;i<result.heights.length;i++) {
 const j=result.routing.receiver[i];
 if(j>=0&&result.heights[j]>result.heights[i])uphillEdges.push({from:i,to:j,
  riseM:result.heights[j]-result.heights[i],potentialGraphAreaM2:result.routing.area[i]});
}
const report={status:'UNADOPTED shared-skeleton research output',inputId:hashJson(input),skeletonId:envelope.id,
 worldId:terrain.worldId,initialRangeM:[Math.min(...initial),Math.max(...initial)],
 outputRangeM:[Math.min(...result.heights),Math.max(...result.heights)],solver:result.report,
 initialConstraints:envelope.diagnostics,
 surfaceDrainage:{strictGroundCatchments,uphillEdgeCount:uphillEdges.length,firstUphillEdges:uphillEdges.slice(0,128),
  interpretation:'Potential graph drainage includes depression crossings. Strict sampled ground drainage does not model overflow or water storage; neither is a discharge estimate.'},
 boundary:'Only declared terminal nodes are fixed; other external borders have no external hillslope flux',
 limitations:['Prescribed skeleton and cross-slope are not inferred geology','Finite sampled constraint audit is not a continuous proof',
 'Routing may change during erosion; no water surface or river corridor is asserted',
 'No coupling between independently solved neighbouring basins; render tiles must crop this one solution',
 'No planetary adoption, browser acceptance, or Earth calibration']};
for(const [name,value]of[['input.json',input],['terrain.json',saved],['report.json',report]])fs.writeFileSync(path.join(outputDir,name),JSON.stringify(value,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(report));
