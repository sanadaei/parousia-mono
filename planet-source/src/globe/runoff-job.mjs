import {inspectPlanetCatchments} from '../core/planet-catchments.mjs';
import {restorePlanetWorld} from '../core/planet-world.mjs';
import {createPlanetRunoffScenario} from '../core/planet-runoff.mjs';
import {stepRunoff} from '../core/runoff-dynamics.mjs';
/** Same deterministic Core jobs in the browser Worker and verification process. */
export function runRunoffJob(job){
 if(job?.type==='initialize'){
  const world=restorePlanetWorld(job.snapshot);
  if(job.expectedWorldId!=null&&world.worldId!==job.expectedWorldId)throw new Error('指定された世界と保存データが一致しません');
  const state=createPlanetRunoffScenario(world,job.options??{});
  return {world:{worldId:world.worldId,settlements:world.settlements.map(({id,name})=>({id,name}))},state};
 }
 if(job?.type==='catchments'){
  const world=restorePlanetWorld(job.snapshot);
  if(job.expectedWorldId!=null&&world.worldId!==job.expectedWorldId)throw new Error('指定された世界と保存データが一致しません');
  return {assessment:inspectPlanetCatchments(world,job.options)};
 }
 if(job?.type==='step'){
  if(!Number.isFinite(job.rainfallMmPerHour)||job.rainfallMmPerHour<0||job.rainfallMmPerHour>500)throw new RangeError('雨量は0〜500 mm/時で指定してください');
  if(!Number.isFinite(job.seconds)||job.seconds<=0||job.seconds>60)throw new RangeError('A runoff job advances at most 60 seconds');
  return {state:stepRunoff(job.state,{seconds:job.seconds,rainfallMPerSecond:job.rainfallMmPerHour/1000/3600})};
 }
 throw new TypeError('Unknown runoff job');
}
