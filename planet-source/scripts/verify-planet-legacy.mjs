import fs from'node:fs';import path from'node:path';import assert from'node:assert/strict';import{runVerification,requireVerificationMemory,sha256File}from'./verification-runtime.mjs';
const baseline=JSON.parse(fs.readFileSync('examples/handoff/2026-10-10/verification.json','utf8'));
const results=[];for(const entry of baseline.restored.slice(0,40)){
 const file=entry.file,witness=file.replace('.snapshot.json','.witnesses.json'),name=path.basename(file,'.snapshot.json');
 if(!fs.existsSync(witness))throw new Error(`Missing original witnesses ${witness}`);
 const before=[sha256File(file),sha256File(witness)];requireVerificationMemory();let args;
 if(file.startsWith('examples/global/'))args=['scripts/global-terrain-worker.mjs','reopen',name,file,witness];
 else if(file.startsWith('examples/global-water/'))args=['scripts/global-water-worker.mjs','reopen','unused',name,file,witness];
 else if(file.startsWith('examples/surface-water/')||/world-[ab]-c1/.test(name))args=['scripts/surface-water-worker.mjs','reopen',name,file,witness];
 else args=['scripts/canonical-export-worker.mjs','reopen','unused',name,file,witness];
 let result;try{result=JSON.parse(runVerification(args));}catch(error){fs.writeFileSync('examples/planet/verification/legacy-reopen-failure.json',JSON.stringify({status:'failed',node:process.version,file,message:error.message,completed:results},null,2));throw error;}assert.equal(result.worldId,entry.worldId);assert.deepEqual([sha256File(file),sha256File(witness)],before);results.push({file,...result});
}
assert.equal(results.length,40);const report={schema:'planet-legacy-reopen@1',createdAt:new Date().toISOString(),status:'pass',snapshots:40,results};fs.writeFileSync('examples/planet/verification/legacy-reopen.json',JSON.stringify(report,null,2));console.log('40 legacy snapshots reopened in separate serial processes with exact saved witnesses');
