#!/usr/bin/env node
// Explicit local experiment on a saved base or planet-world JSON.
// node scripts/experiments/run-planet-relief.mjs SOURCE_JSON OUTPUT_DIR LAT LON [EXTENT_M]
import fs from 'node:fs';
import path from 'node:path';
import { preparePlanetReliefInput,evolvePlanetRelief } from './planet-relief-input.mjs';
const [sourceFile,output,lat,lon,extent='50000']=process.argv.slice(2);
if(!sourceFile||!output||lat===undefined||lon===undefined)throw new Error('Usage: run-planet-relief.mjs SOURCE_JSON OUTPUT_DIR LAT LON [EXTENT_M]');
const start=performance.now(),source=JSON.parse(fs.readFileSync(sourceFile,'utf8'));
const input=preparePlanetReliefInput(source.base??source,{centerLatDeg:Number(lat),centerLonDeg:Number(lon),extentM:Number(extent),n:129});
const forcing={steps:100,dtYears:10000,erodibility:.0001,upliftMPerYear:.001,hillslopeDiffusivityM2PerYear:.1};
fs.mkdirSync(output,{recursive:true});
for(const name of['input.json','terrain.json','report.json'])if(fs.existsSync(path.join(output,name)))throw new Error('Output exists; use a fresh directory');
const {terrain,result}=evolvePlanetRelief(input,forcing);
const report={status:'UNADOPTED local experiment, not a changed planet',inputId:input.inputId,
 originalWorldId:input.originalWorldId,derivedSourceWorldId:input.derivedSourceWorldId,
 outputWorldId:terrain.worldId,sourceMode:input.sourceMode,projection:input.projection,
 n:input.n,extentM:input.extentM,verticalDatum:input.verticalDatum,
 initialRangeM:[Math.min(...input.initial),Math.max(...input.initial)],
 outputRangeM:[Math.min(...result.heights),Math.max(...result.heights)],
 maxLoweringM:Math.max(...input.initial.map((v,i)=>v-result.heights[i])),
 maxRaisingM:Math.max(...input.initial.map((v,i)=>result.heights[i]-v)),
 forcing,routing:result.report,elapsedMs:performance.now()-start,
 limitations:['Only the base snapshot identity is validated; planet-world settlement state is not used',
  'Sampled dry derived source, not a continuous water proof',
  'Old detail and local river/pond effects removed only from the derived input copy',
  'All outer nodes fixed; independent watershed coupling unresolved',
  'Explicit uncalibrated forcing; no planet rewrite or browser acceptance']};
for(const [name,value]of[['input.json',input],['terrain.json',terrain.toSnapshot()],['report.json',report]])fs.writeFileSync(path.join(output,name),JSON.stringify(value,null,name==='report.json'?2:0)+'\n',{flag:'wx'});
console.log(JSON.stringify(report));
