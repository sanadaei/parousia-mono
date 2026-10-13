#!/usr/bin/env node
// Reproducible erosion-only mesh scenario, with all real inputs saved.
import fs from 'node:fs';import path from 'node:path';
import {createDrainageEnvelope} from './drainage-envelope.mjs';
import {createReliefMesh,evolveMeshRelief,rasterizeReliefMesh,preserveReliefMesh} from './mesh-relief.mjs';
const [meshFile,outputDir]=process.argv.slice(2);
if(!meshFile||!outputDir)throw new Error('Usage: run-mesh-relief.mjs MESH_JSON NEW_OUTPUT_DIRECTORY');
if(fs.statSync(meshFile).size>16*1024*1024)throw new RangeError('Research mesh input exceeds 16 MiB');
const data=JSON.parse(fs.readFileSync(meshFile,'utf8')),mesh=createReliefMesh(data);
const scenario=JSON.parse(fs.readFileSync(new URL('../../fixtures/drainage-skeleton-research.json',import.meta.url),'utf8'));
const envelope=createDrainageEnvelope(scenario.skeleton),initial=mesh.contract.points.map(p=>envelope.heightAt(...p));
const outlets=envelope.diagnostics.terminals.map(id=>{
 const p=envelope.contract.nodes.find(p=>p.id===id),matches=[];
 mesh.contract.points.forEach((q,i)=>{if(Math.hypot(q[0]-p.xM,q[1]-p.yM)<1e-8)matches.push(i);});
 if(matches.length!==1)throw new RangeError('Each declared terminal needs exactly one matching mesh node');return matches[0];
});
fs.mkdirSync(outputDir,{recursive:true});
for(const name of ['input.json','mesh.json','terrain.json','raster-preview.json','report.json'])if(fs.existsSync(path.join(outputDir,name)))throw new Error('Output exists; choose a new directory');
const forcing={steps:80,dtYears:5000,erodibility:.0001,areaExponent:.4,upliftMPerYear:.001};
const result=evolveMeshRelief({mesh,initial,outlets,...forcing});
const outputGrid={n:257,extentM:20000,originXM:-10000,originYM:-10000,seed:'independent-mesh-skeleton/20261011'};
const exported=rasterizeReliefMesh(mesh,result,outputGrid);
const canonical=preserveReliefMesh(mesh,result,{seed:outputGrid.seed});
let maxCanonicalNodeErrorM=0;
for(let i=0;i<mesh.nodeCount;i++)maxCanonicalNodeErrorM=Math.max(maxCanonicalNodeErrorM,Math.abs(canonical.groundElevationAt(...mesh.contract.points[i])-result.heights[i]));
const report={...result.report,outputWorldId:canonical.worldId,canonicalNodeChecks:mesh.nodeCount,maxCanonicalNodeErrorM,
 rasterPreviewWorldId:exported.terrain.worldId,rasterConversion:exported.diagnostics,
 forcingDescription:'Explicit erosion-only comparison: no hillslope diffusion in mesh or reference benchmark',
 visualAcceptance:false,planetAdoption:false,waterModel:false};
const files={
 'input.json':{scenario,forcing,outputGrid,initial,outlets,sourceMeshId:mesh.id},
 'mesh.json':{...mesh.contract,heights:Array.from(result.heights)},
 'terrain.json':canonical.toSnapshot(),'raster-preview.json':exported.terrain.toSnapshot(),'report.json':report};
for(const[name,value]of Object.entries(files))fs.writeFileSync(path.join(outputDir,name),JSON.stringify(value)+'\n',{flag:'wx'});
console.log(JSON.stringify(report));
