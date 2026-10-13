import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {buildTerrainWithSurfaceWater,restoreTerrain,PLANAR_C1_BED} from '../src/core/index.mjs';
import {requireVerificationMemory} from './verification-runtime.mjs';
requireVerificationMemory();
const directory='examples/planet/verification/planar-c1';fs.mkdirSync(directory,{recursive:true});
const cases=[];
for(const name of ['world-a','world-b']){
 const file=`examples/surface-water/${name}-c1.snapshot.json`,bytes=fs.readFileSync(file),input=JSON.parse(bytes),source=restoreTerrain(input),converted=structuredClone(input);
 const maxGround=input.fields.groundElevationM.reduce((a,b)=>Math.max(a,b),-Infinity),minTarget=input.hydrology.edges.reduce((min,e)=>e.points.reduce((m,p)=>Math.min(m,p.waterLevelElevationM-p.depthM),min),maxGround);
 // An explicit conservative experiment cap, derived from this finite input.
 // It is not an automatic geology or construction recommendation.
 const cap=Math.max(1,Math.ceil(maxGround-minTarget+1+input.hydrology.edges.length*.01));
 converted.hydrology.bed={method:PLANAR_C1_BED,maxIncisionM:cap};converted.revision+='|explicit-c1-conversion@1';delete converted.worldId;
 const terrain=buildTerrainWithSurfaceWater(converted),saved=terrain.toSnapshot(),restored=restoreTerrain(saved);fs.writeFileSync(`${directory}/${name}.snapshot.json`,JSON.stringify(saved));
 let samples=0,wet=0,maxChangeM=0;const examples=[],b=terrain.bounds;
 for(let y=0;y<=64;y++)for(let x=0;x<=64;x++){
  const xM=b.minXM+(b.maxXM-b.minXM)*x/64,yM=b.minYM+(b.maxYM-b.minYM)*y/64,a=terrain.sampleAt(xM,yM),old=source.sampleAt(xM,yM);
  assert.deepEqual(a,restored.sampleAt(xM,yM));assert.ok(a.waterDepthM===null||a.waterDepthM>=0);maxChangeM=Math.max(maxChangeM,Math.abs(a.groundElevationM-old.groundElevationM));samples++;if(a.waterDepthM>0)wet++;
 }
 for(const edge of saved.hydrology.edges.slice(0,8)){const p=edge.points[Math.floor(edge.points.length/2)],sample=terrain.sampleAt(p.xM,p.yM);examples.push({input:{xM:p.xM,yM:p.yM},output:sample});}
 assert.equal(createHash('sha256').update(fs.readFileSync(file)).digest('hex'),createHash('sha256').update(bytes).digest('hex'));
 cases.push({sourceFile:file,sourceSha256:createHash('sha256').update(bytes).digest('hex'),sourceWorldId:source.worldId,bed:saved.hydrology.bed,worldId:terrain.worldId,outputFile:`${directory}/${name}.snapshot.json`,samples,wet,maxChangedGroundM:maxChangeM,examples});
}
const report={schema:'planar-c1-real-inputs@1',createdAt:new Date().toISOString(),status:'pass',scope:'explicit new worlds from two preserved real finite inputs; restoration and grid samples, not a proof of universal C1 or hydrology',cases};fs.writeFileSync(`${directory}/report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(cases.map(({examples,...c})=>c)));
