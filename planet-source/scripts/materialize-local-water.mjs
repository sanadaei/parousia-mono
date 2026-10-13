import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {restorePlanetWorld} from '../src/core/planet-world.mjs';
import {materializeLocalWaterPlan} from '../src/core/local-water-materialization.mjs';
import {CommittedMaterializer} from '../src/core/committed-materialization.mjs';
import {createFileMaterializationStorage} from './materialization-file-store.mjs';
/** Generate and save a reference-triggered water plan, not a terrain edit. */
export async function materializeReferencedWater(world,directory,parentId,pointIndex){
 return materializeLocalWaterPlan(world,new CommittedMaterializer(createFileMaterializationStorage(directory)),{parentId,pointIndex});
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const args=process.argv.slice(2),[snapshot,directory,parentId,index]=args;
  if(args.length!==4||!/^\d+$/.test(index))throw new Error('Usage: materialize-local-water.mjs world.snapshot.json save-directory parent-river-id point-index');
  const world=restorePlanetWorld(fs.readFileSync(snapshot,'utf8'));
  process.stdout.write(JSON.stringify(await materializeReferencedWater(world,directory,parentId,Number(index)),null,2)+'\n');
 }catch(e){console.error(e.stack??e.message);process.exitCode=1;}
}
