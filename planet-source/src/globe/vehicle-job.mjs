import {restorePlanetWorld} from '../core/planet-world.mjs';
import {planetVehicleSurface} from '../core/vehicle-support.mjs';
import {timeVehicleMotion,simulateVehicleDynamics} from '../core/vehicle-dynamics.mjs';
export function runVehicleJob(job){
 if(job?.type!=='dynamics')throw new TypeError('Unknown vehicle job');
 const world=restorePlanetWorld(job.snapshot);if(job.expectedWorldId!=null&&world.worldId!==job.expectedWorldId)throw new Error('表示元と保存世界が一致しません');
 const recipe=world.recipes.find(r=>r.id===job.settlementId);if(!recipe)throw new RangeError('Unknown vehicle settlement');
 const poses=timeVehicleMotion(job.motion,{speedMPerSecond:job.speedMPerSecond,wheelbaseM:job.parameters.wheelbaseM});
 const result=simulateVehicleDynamics({...job.parameters,poses,sampleSurface:planetVehicleSurface(world,recipe)});
 return{worldId:world.worldId,settlementId:recipe.id,input:structuredClone({motion:job.motion,speedMPerSecond:job.speedMPerSecond,parameters:job.parameters}),result};
}
