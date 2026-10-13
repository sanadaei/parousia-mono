/** Finite stratified slope audit of an existing canonical planet, not a census
 * of every cliff. Four fixed samples per source land cell; no world mutation. */
import fs from 'node:fs';import path from 'node:path';import{pathToFileURL}from'node:url';
import {restorePlanetWorld} from '../src/core/planet-world.mjs';import{offsetGeographic}from'../src/core/spherical.mjs';import{requireVerificationMemory}from'./verification-runtime.mjs';
export function auditTerrainSlopes(world){
 const base=world.base,s=base.toSnapshot(),{columns,rows}=s.grid,thresholds=[5,15,30,45,60,90],bins=thresholds.map(upperDeg=>({upperDeg,samples:0,areaWeight:0})),examples=[];let samples=0,wet=0,totalWeight=0;
 for(let row=0;row<rows;row++)for(let col=0;col<columns;col++){
  if(!s.fields.landMask[row*columns+col])continue;
  for(const [u,v] of [[.25,.25],[.75,.25],[.25,.75],[.75,.75]]){
   const p={latDeg:90-(row+v)/rows*180,lonDeg:(col+u)/columns*360},surface=base.sampleSurfaceAt(p.latDeg,p.lonDeg);if(surface.waterDepthM>0){wet++;continue;}
   const h=(east,north)=>{const q=offsetGeographic(p,east,north,base.frame.radiusM);return base.groundElevationAt(q.latDeg,q.lonDeg);},stepM=5,grade=Math.hypot((h(stepM,0)-h(-stepM,0))/(2*stepM),(h(0,stepM)-h(0,-stepM))/(2*stepM)),angleDeg=Math.atan(grade)*180/Math.PI,weight=Math.cos(p.latDeg*Math.PI/180),bin=bins.find(b=>angleDeg<=b.upperDeg);
   samples++;totalWeight+=weight;bin.samples++;bin.areaWeight+=weight;examples.push({...p,angleDeg,grade,elevationM:surface.groundElevationM});examples.sort((a,b)=>b.angleDeg-a.angleDeg);if(examples.length>12)examples.pop();
  }
 }
 return{worldId:world.worldId,method:'four-fixed-subcell-samples; central-derivative-5m@1',samples,wetSamplesExcluded:wet,bins:bins.map(b=>({...b,estimatedAreaFraction:totalWeight?b.areaWeight/totalWeight:null})),steepestSamples:examples,scope:'Finite stratified sample of source land cells, weighted by latitude. Narrow cliffs can be missed; not a proof of their absence, geomorphological validity, or renderer quality.'};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){requireVerificationMemory();const[input,output]=process.argv.slice(2);if(!input||!output)throw Error('Usage: node audit-terrain-slopes.mjs WORLD.json REPORT.json');const report=auditTerrainSlopes(restorePlanetWorld(JSON.parse(fs.readFileSync(input))));fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));}
