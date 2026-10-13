#!/usr/bin/env node
// Explicit, bounded local scenarios. Does not alter an existing planet or defaults.
import fs from 'node:fs';
import path from 'node:path';
import { evolveRelief } from './mst-relief.mjs';
import { reliefTerrain } from './relief-terrain.mjs';
import { restoreTerrain } from '../../src/core/index.mjs';
import { hashJson } from '../../src/core/json-contract.mjs';

const output=process.argv[2];
if(!output)throw new Error('Usage: node scripts/experiments/run-relief-scenarios.mjs OUTPUT_DIRECTORY');
fs.mkdirSync(output,{recursive:true});
const names=['uplifted-mountain','eroding-escarpment','uplift-belt'];
for(const name of names)for(const suffix of['terrain.json','diagnostic.json'])if(fs.existsSync(path.join(output,`${name}.${suffix}`)))throw new Error('Output exists; choose a new directory');
const n=129;
for(const name of names){
 let seed=20261011;const random=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return(seed>>>0)/4294967296;};
 const mountain=name!=='eroding-escarpment',belt=name==='uplift-belt',extentM=mountain?50000:3000;
 const initial=Array.from({length:n*n},(_,i)=>{
  if(mountain)return random()*.1;
  const y=Math.floor(i/n)*extentM/(n-1),t=Math.max(0,Math.min(1,(y-1470)/60));
  return 60*t*t*(3-2*t)+random()*.05;
 });
 const parameters={n,extentM,steps:mountain?100:60,dtYears:mountain?20000:1000,
  erodibility:.0001,areaExponent:.4,upliftMPerYear:mountain?.005:0};
 if(belt){
  parameters.upliftMPerYear=Array.from({length:n*n},(_,i)=>{
   const x=(i%n)/(n-1)*extentM-extentM/2,y=Math.floor(i/n)/(n-1)*extentM-extentM/2;
   return .005*Math.exp(-(((x+.4*y)/6500)**2+(y/15000)**4));
  });
  parameters.hillslopeDiffusivityM2PerYear=1;
 }
 const summarize=v=>Array.isArray(v)?{kind:'explicit-node-field',nodes:v.length,min:Math.min(...v),max:Math.max(...v),hash:hashJson(v)}:v;
 const start=performance.now(),result=evolveRelief({...parameters,initial}),elapsedMs=performance.now()-start;
 const terrain=reliefTerrain(result,{seed:`${name}/20261011`}),snapshot=terrain.toSnapshot();
 const restored=restoreTerrain(JSON.stringify(snapshot));
 if(restored.worldId!==terrain.worldId||restored.sampleAt(extentM/2,extentM/2).groundElevationM!==terrain.sampleAt(extentM/2,extentM/2).groundElevationM)throw new Error('Canonical restore mismatch');
 const slopes=[];const step=extentM/(n-1);
 for(let y=1;y<n-1;y++)for(let x=1;x<n-1;x++){const i=y*n+x,e=(result.heights[i+1]-result.heights[i-1])/(2*step),v=(result.heights[i+n]-result.heights[i-n])/(2*step);slopes.push(Math.atan(Math.hypot(e,v))*180/Math.PI);}
 slopes.sort((a,b)=>a-b);
 const diagnostic={name,worldId:snapshot.worldId,status:'UNADOPTED synthetic scenario',
  input:{parameters:{...parameters,upliftMPerYear:summarize(parameters.upliftMPerYear)},forcingDescription:belt?'Prescribed Gaussian-like uplift belt and uniform linear hillslope diffusion, not simulated tectonics':'Spatially uniform forcing',initialDescription:mountain?'Near-flat deterministic noise':'Authored 60 m escarpment with a 60 m transition, then erosion; not spontaneous cliff genesis',seed:20261011,boundary:'All outer nodes fixed'},
  output:{heightMinM:Math.min(...result.heights),heightMaxM:Math.max(...result.heights),slopeMedianDeg:slopes[Math.floor(slopes.length*.5)],slopeP95Deg:slopes[Math.floor(slopes.length*.95)],elapsedMs},
  routing:{...result.report,upliftMPerYear:summarize(result.report.upliftMPerYear)},acceptance:{canonicalTerrainRestore:true,planetIntegration:false,browserInspection:false,earthCalibration:false}};
 fs.writeFileSync(path.join(output,`${name}.terrain.json`),JSON.stringify(snapshot)+'\n',{flag:'wx'});
 fs.writeFileSync(path.join(output,`${name}.diagnostic.json`),JSON.stringify(diagnostic,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify(diagnostic));
}
