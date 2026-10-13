import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runVerification as run, requireVerificationMemory, sha256File, writeVerificationReport } from './verification-runtime.mjs';
import assert from 'node:assert/strict';
import { TEST_FILES } from './test-files.mjs';
import { verificationDirectory } from './verification-paths.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),output=verificationDirectory('audit-0.3.3');
mkdirSync(output,{recursive:true});
const read=p=>JSON.parse(readFileSync(resolve(root,p),'utf8'));
const digest=p=>sha256File(resolve(root,p));
const hashes=()=>['geography-lite','dynamic-terrain-runtime'].flatMap(module=>{
  const sourceRoot=`../MinimalWorld_Modules_0.3_Core/MinimalWorld_Modules_0.3/${module}`;
  return read(`${sourceRoot}/PROVENANCE.json`).files.map(p=>({module,file:p.file,expectedSha256:p.sha256,observedSha256:digest(`${sourceRoot}/${p.file}`)}));
});
const before=hashes(); for(const s of before) assert.equal(s.expectedSha256,s.observedSha256);
const freeMemoryBeforeMiB = requireVerificationMemory();

const tests=run(['--test',...TEST_FILES]);writeFileSync(resolve(output,'unit-tests.log'),tests);
const count=Number(tests.match(/# tests (\d+)/)?.[1]),pass=Number(tests.match(/# pass (\d+)/)?.[1]);assert.ok(count>0&&count===pass);
const seeds=['audit-a','audit-b'],sites=['date-line','source-seam','north-pole','south-pole'];
const globalNames=[...seeds.flatMap(seed=>sites.map(site=>`${seed}-${site}`)),'explicit-bowl-lake'];
const finiteNames=['world-a','world-b','lake-ocean-fixture','concave-body-fixture','combined-surface-fixture','combined-groundwater-fixture',
  'world-a-strahler','world-b-strahler','world-a-c1','world-b-c1'];
const oldGlobalBase=seeds.map(seed=>({snapshot:`examples/global/${seed}.snapshot.json`,witnesses:`examples/global/${seed}.witnesses.json`,seed}));
const oldGlobalWater=['examples/global-water','examples/global-water/0.3.3'].flatMap(folder=>globalNames.map(name=>({
  snapshot:`${folder}/${name}.snapshot.json`,witnesses:`${folder}/${name}.witnesses.json`,name})));
const oldFiniteWater=[...finiteNames.map(name=>({snapshot:`examples/surface-water/${name}.snapshot.json`,witnesses:`examples/surface-water/${name}.witnesses.json`,name})),
  ...['world-a-c1','world-b-c1'].map(name=>({snapshot:`examples/audit-0.3.2/${name}.snapshot.json`,witnesses:`examples/audit-0.3.2/${name}.witnesses.json`,name}))];
const oldExports=seeds.flatMap(seed=>sites.map(site=>({snapshot:`examples/audit-0.3.2/${seed}-${site}.snapshot.json`,witnesses:`examples/audit-0.3.2/${seed}-${site}.witnesses.json`,site})));
const inputs=[...oldGlobalBase,...oldGlobalWater,...oldFiniteWater,...oldExports].map(p=>({file:p.snapshot,sha256:digest(p.snapshot)}));
const legacy=[];
for(const p of oldGlobalBase) legacy.push({file:p.snapshot,...JSON.parse(run(['scripts/global-terrain-worker.mjs','reopen',p.seed,p.snapshot,p.witnesses]))});
for(const p of oldGlobalWater) legacy.push({file:p.snapshot,...JSON.parse(run(['scripts/global-water-worker.mjs','reopen','unused',p.name,p.snapshot,p.witnesses]))});
for(const p of oldFiniteWater) legacy.push({file:p.snapshot,...JSON.parse(run(['scripts/surface-water-worker.mjs','reopen',p.name,p.snapshot,p.witnesses]))});
for(const p of oldExports) legacy.push({file:p.snapshot,...JSON.parse(run(['scripts/canonical-export-worker.mjs','reopen','unused',p.site,p.snapshot,p.witnesses]))});
console.log(`Legacy contracts: ${legacy.length} snapshots restored with exact witnesses`);
const multipleChartCases=[];
for(const seed of seeds) {
  const snapshot=resolve(output,`${seed}.snapshot.json`),witnesses=resolve(output,`${seed}.witnesses.json`);
  const captured=JSON.parse(run(['scripts/stage3-water-worker.mjs','capture',`examples/global/${seed}.snapshot.json`,snapshot,witnesses]));
  const reopened=JSON.parse(run(['scripts/stage3-water-worker.mjs','reopen','unused',snapshot,witnesses]));
  assert.equal(captured.worldId,reopened.worldId);multipleChartCases.push({seed,...captured,reopened});
  console.log(`${seed}: ${captured.charts} simultaneous charts, ${captured.centerlineSamples} river probes, ${reopened.framesCompared} exact frames`);
}
const finiteCases=[];
for(const seed of ['world-a-c1','world-b-c1']) {
  const snapshot=resolve(output,`${seed}.snapshot.json`),witnesses=resolve(output,`${seed}.witnesses.json`);
  const captured=JSON.parse(run(['scripts/surface-water-worker.mjs','capture',seed,snapshot,witnesses]));
  const reopened=JSON.parse(run(['scripts/surface-water-worker.mjs','reopen',seed,snapshot,witnesses]));
  assert.equal(captured.worldId,reopened.worldId);finiteCases.push({...captured,reopened});
  console.log(`${seed}: new smooth banks, ${captured.centerlineSamples} river probes, ${reopened.comparedFrames} exact frames`);
}
const after=hashes();assert.deepEqual(before,after);for(const p of inputs) assert.equal(digest(p.file),p.sha256);
const report={schema:'minimal-world-stage3-audit-verification@1',implementationVersion:read('package.json').version,
  measuredAtUTC:new Date().toISOString(),verificationDateJST:new Date(Date.now()+9*3600000).toISOString().slice(0,10),node:process.version,
  limits:{childHeapMiB:256,timeoutPerChildMs:30000,workersConcurrent:1},freeMemoryBeforeMiB,unitTests:{tests:count,pass},
  multipleChartCases,finiteCases,legacy,sourceHashes:after,sourceFilesUnchanged:true,inputSnapshots:inputs,inputSnapshotsUnchanged:true,
  unverified:['C1 interior river beds, bends, caps and confluence/minimum composition',
    'This run covers independent charts; connected inter-chart rivers and post-detail drainage require their separate tests',
    'Local source-field corner envelope for residual detail, measured fine terrain, earthwork/runoff coupling',
    'Automatic water bodies deferred by user; holes, calibrated flow/velocity and seasonal simulation',
    'Road/building core and UI are covered by unit tests here; full-width clearance, structural acceptance and human visual acceptance are not',
    'Maximum-scale performance, all seeds/resolutions and full original-module suites']};
writeVerificationReport(resolve(output,'verification.json'), report);
console.log(JSON.stringify({unitTests:report.unitTests,multipleChartWorlds:multipleChartCases.length,
  charts:multipleChartCases.reduce((s,c)=>s+c.charts,0),sourceCenters:multipleChartCases.reduce((s,c)=>s+c.sourceCentersCompared,0),
  centerlineProbes:multipleChartCases.reduce((s,c)=>s+c.centerlineSamples,0),
  multipleChartFrames:multipleChartCases.reduce((s,c)=>s+c.reopened.framesCompared,0),legacySnapshots:legacy.length,
  sourceFilesUnchanged:true,inputSnapshotsUnchanged:true}));
