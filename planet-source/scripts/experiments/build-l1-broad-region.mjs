import fs from 'node:fs';
import {createL1BroadRegion} from '../../src/core/l1-broad-region.mjs';
import {CommittedMaterializer} from '../../src/core/committed-materialization.mjs';
import {createFileMaterializationStorage} from '../materialization-file-store.mjs';
import {requireVerificationMemory} from '../verification-runtime.mjs';
export async function saveL1BroadRegion(parent,level,directory){
 // Measured 512x256 parent is ~17 MB; this dedicated L1 store has a 24 MiB
 // cap. Do not enlarge the ordinary local-world 16 MiB store or UI archive.
 const maxRecordBytes=24*1024*1024;
 const store=new CommittedMaterializer(createFileMaterializationStorage(directory,{maxRecordBytes}),{maxRecordBytes});
 return store.resolve({worldId:parent.snapshot.worldId,entityId:`L1-resolution:${level.columns}x${level.rows}`,conditions:{resolutionId:level.id,parentClimateId:parent.climate.id,...(parent.settlementDistribution?{parentDistributionId:parent.settlementDistribution.id}:{})},generator:'l1-broad-region@1',generate:()=>createL1BroadRegion(parent,level)});
}
if(process.argv[1]?.endsWith('/build-l1-broad-region.mjs')){
 const [input,seriesFile,output,directory,levelArg='2']=process.argv.slice(2);if(!directory)throw Error('Usage: build-l1-broad-region.mjs L0.json SERIES.json OUTPUT.json SAVE_DIR [LEVEL_INDEX]');
 requireVerificationMemory();const parent=JSON.parse(fs.readFileSync(input,'utf8')),series=JSON.parse(fs.readFileSync(seriesFile,'utf8')),level=series.cases[Number(levelArg)];if(!level)throw Error('Requested resolution level is absent');
 const result=await saveL1BroadRegion(parent,level,directory);fs.writeFileSync(output,JSON.stringify(result));console.log(JSON.stringify({id:result.id,grid:result.snapshot.grid,diagnostics:result.diagnostics,status:result.status}));
}
