import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {planRegionalDomains} from '../src/core/regional-domains.mjs';
import {CommittedMaterializer} from '../src/core/committed-materialization.mjs';
import {createFileMaterializationStorage} from './materialization-file-store.mjs';
import {hashJson} from '../src/core/json-contract.mjs';
import {requireVerificationMemory} from './verification-runtime.mjs';
export async function saveRegionalDomainPlan(snapshot,climate,directory,settings={}){
 const store=new CommittedMaterializer(createFileMaterializationStorage(directory));
 return store.resolve({worldId:hashJson({sourceWorldId:snapshot.worldId,climateId:climate.id}),entityId:'regional-domain-atlas',conditions:{sourceWorldId:snapshot.worldId,climateId:climate.id,settings},generator:'drainage-work-domains@1',generate:()=>planRegionalDomains(snapshot,climate,settings)});
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 requireVerificationMemory();const [input,directory,output]=process.argv.slice(2);if(!input||!directory||!output)throw new Error('Usage: plan-regional-domains.mjs L0-SNAPSHOT-AND-CLIMATE.json SAVE-DIRECTORY OUTPUT.json');
 const data=JSON.parse(fs.readFileSync(input,'utf8')),result=await saveRegionalDomainPlan(data.snapshot,data.climate,directory);
 fs.writeFileSync(output,JSON.stringify(result));console.log(JSON.stringify(result.diagnostics));
}
