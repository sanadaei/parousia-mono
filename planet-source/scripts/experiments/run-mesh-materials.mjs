#!/usr/bin/env node
// Same mesh, drainage envelope and forcing; only material column changes.
import fs from 'node:fs';import path from 'node:path';
import {createDrainageEnvelope} from './drainage-envelope.mjs';
import {createReliefMesh,evolveMeshRelief,preserveReliefMesh} from './mesh-relief.mjs';
const [meshFile,outputDir]=process.argv.slice(2);
if(!meshFile||!outputDir)throw new Error('Usage: run-mesh-materials.mjs MESH_JSON NEW_OUTPUT_DIRECTORY');
if(fs.statSync(meshFile).size>16*1024*1024)throw new RangeError('Mesh input exceeds 16 MiB');
const input=JSON.parse(fs.readFileSync(meshFile,'utf8')),mesh=createReliefMesh(input);
const scenario=JSON.parse(fs.readFileSync(new URL('../../fixtures/drainage-skeleton-research.json',import.meta.url),'utf8'));
const material=JSON.parse(fs.readFileSync(new URL('../../fixtures/mesh-material-research.json',import.meta.url),'utf8'));
const envelope=createDrainageEnvelope(scenario.skeleton),initial=mesh.contract.points.map(p=>envelope.heightAt(...p));
const outlets=envelope.diagnostics.terminals.map(id=>{
 const p=envelope.contract.nodes.find(p=>p.id===id),matches=[];
 mesh.contract.points.forEach((q,i)=>{if(Math.hypot(q[0]-p.xM,q[1]-p.yM)<1e-8)matches.push(i);});
 if(matches.length!==1)throw new RangeError('Declared terminal must match exactly one mesh node');return matches[0];
});
// No overwrite, including partial prior runs.
fs.mkdirSync(outputDir);
fs.writeFileSync(path.join(outputDir,'input.json'),JSON.stringify({mesh:input,scenario,material,initial,outlets})+'\n',{flag:'wx'});
const reports=[];
for(const spec of material.cases){
 const start=performance.now(),result=evolveMeshRelief({mesh,initial,outlets,...material.forcing,lithology:spec.lithology});
 const terrain=preserveReliefMesh(mesh,result,{seed:'independent-mesh-skeleton/20261011'});
 fs.writeFileSync(path.join(outputDir,`${spec.name}.json`),JSON.stringify(terrain.toSnapshot())+'\n',{flag:'wx'});
 const h=Array.from(result.heights).sort((a,b)=>a-b),slopes=mesh.contract.triangles.map(t=>{
  const p=t.map(i=>mesh.contract.points[i]),z=t.map(i=>result.heights[i]),x1=p[1][0]-p[0][0],y1=p[1][1]-p[0][1],x2=p[2][0]-p[0][0],y2=p[2][1]-p[0][1],d=x1*y2-y1*x2;
  return Math.atan(Math.hypot(((z[1]-z[0])*y2-(z[2]-z[0])*y1)/d,(x1*(z[2]-z[0])-x2*(z[1]-z[0]))/d))*180/Math.PI;
 }).sort((a,b)=>a-b);
 let maximumUphillRiseM=0,uphillAboveTolerance=0;
 for(let i=0;i<mesh.nodeCount;i++){const q=result.routing.receiver[i];if(q>=0){const rise=result.heights[q]-result.heights[i];maximumUphillRiseM=Math.max(maximumUphillRiseM,rise);if(rise>1e-8)uphillAboveTolerance++;}}
 const report={name:spec.name,worldId:terrain.worldId,elapsedMs:performance.now()-start,nodes:mesh.nodeCount,
  heightRangeM:[h[0],h.at(-1)],triangleSlopeMedianDeg:slopes[Math.floor(slopes.length/2)],triangleSlopeP95Deg:slopes[Math.floor(slopes.length*.95)],
  ...result.report,maximumUphillRiseM,uphillAboveTolerance,routingToleranceM:1e-8,
  visualAcceptance:false,planetAdoption:false};reports.push(report);console.log(JSON.stringify(report));
}
fs.writeFileSync(path.join(outputDir,'report.json'),JSON.stringify({meshId:mesh.id,reports},null,2)+'\n',{flag:'wx'});
