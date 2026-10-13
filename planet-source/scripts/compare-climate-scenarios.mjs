import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {generateClimate} from '../src/core/planet-climate.mjs';import {hashJson} from '../src/core/json-contract.mjs';
import {auditL0} from './audit-l0.mjs';import {requireVerificationMemory} from './verification-runtime.mjs';
export const CLIMATE_SCENARIOS=Object.freeze([
 {id:'baseline',label:'基準',temperatureOffsetC:0,precipitationScale:1},
 {id:'arid',label:'温暖・乾燥',temperatureOffsetC:8,precipitationScale:.08},
 {id:'glacial',label:'寒冷期',temperatureOffsetC:-6,precipitationScale:.8},
 {id:'deep-cold',label:'強い寒冷',temperatureOffsetC:-18,precipitationScale:.6}
]);
export function compareClimateScenarios(snapshot){
 const before=hashJson(snapshot),results=CLIMATE_SCENARIOS.map(scenario=>{
  const climate=generateClimate(snapshot,scenario),land=climate.biome.map(b=>b!=='ocean'&&b!=='lake'),total=climate.cellAreaM2.reduce((a,b)=>a+b,0),dryArea=climate.cellAreaM2.reduce((s,a,i)=>s+(land[i]?a:0),0),globalPercent={},dryLandPercent={};
  for(let i=0;i<land.length;i++){const b=climate.biome[i],a=climate.cellAreaM2[i];globalPercent[b]=(globalPercent[b]??0)+a/total*100;if(land[i])dryLandPercent[b]=(dryLandPercent[b]??0)+a/dryArea*100;}
  return{scenario,climate,summary:{scenario:scenario.id,sourceWorldId:snapshot.worldId,sourceSnapshotHash:before,globalPercent,dryLandPercent,annualLandMeanTemperatureC:climate.annualMeanTemperatureC.reduce((s,t,i)=>s+(land[i]?t*climate.cellAreaM2[i]:0),0)/dryArea,annualLandMeanPrecipitationMm:climate.annualPrecipitationMm.reduce((s,p,i)=>s+(land[i]?p*climate.cellAreaM2[i]:0),0)/dryArea,potentialWaterBalance:climate.catchmentWater?.diagnostics??null}};
 });
 if(hashJson(snapshot)!==before)throw new Error('Scenario comparison changed geography');
 return{sourceWorldId:snapshot.worldId,sourceSnapshotHash:before,unchangedGeography:true,limitations:['Ocean and lake geometry and water levels remain fixed','Ice biome means year-round freezing air temperature, not simulated glacier or sea ice','No ice sheets, glacial erosion, albedo feedback, sea-level response or physical atmospheric forcing','Existing rendered river geometry is unchanged; potential runoff is recomputed, not hydraulic geometry'],results};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 requireVerificationMemory();const dir=process.argv[2]??'reports/l0-scenarios';fs.mkdirSync(dir,{recursive:true});const input=process.argv[3]?JSON.parse(fs.readFileSync(process.argv[3],'utf8')):auditL0('planet-1'),snapshot=input.snapshot??input;
 const result=compareClimateScenarios(snapshot);fs.writeFileSync(path.join(dir,'scenarios.json'),JSON.stringify(result));fs.writeFileSync(path.join(dir,'summary.json'),JSON.stringify({...result,results:result.results.map(r=>r.summary)},null,2));console.log(JSON.stringify(result.results.map(r=>r.summary),null,2));
}
