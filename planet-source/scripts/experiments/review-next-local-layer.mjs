import fs from 'node:fs';
import {CommittedMaterializer} from '../../src/core/committed-materialization.mjs';
import {createFileMaterializationStorage} from '../materialization-file-store.mjs';
import {saveFineLocalLayer} from './fine-local-layer.mjs';
import {selectNextLocalDomain,nextLocalOptions,verifyNextLocalLayer,NEXT_LOCAL_VERSION} from './next-local-layer.mjs';
const [input,output,...flags]=process.argv.slice(2);if(!output)throw Error('Usage: review-next-local-layer.mjs PARENT.json OUTPUT_DIR [--reload]');
const reload=flags.includes('--reload'),upstream=JSON.parse(fs.readFileSync(input)),parent=upstream.context??upstream;
fs.mkdirSync(output,{recursive:true});const selection=selectNextLocalDomain(parent);
if(!selection.bounds){fs.writeFileSync(`${output}/rejected-selection.json`,JSON.stringify(selection,null,2));throw Error('No eligible single-outlet crop; retained parent unchanged');}
const options=nextLocalOptions(selection.bounds),storage=createFileMaterializationStorage(`${output}/save`);
if(reload){const get=storage.get;storage.get=async key=>{const value=await get(key);if(!value)throw Error('Fresh-process reload cannot generate a missing record');return value;};storage.putIfAbsent=()=>{throw Error('Fresh-process reload cannot write');};}
const result=await saveFineLocalLayer(new CommittedMaterializer(storage),parent,options,NEXT_LOCAL_VERSION);
const report={...verifyNextLocalLayer(parent,result),selection,options,source:{id:result.source.id,grid:result.source.grid,provenance:result.source.provenance},recordBytes:fs.readdirSync(`${output}/save`).filter(f=>f.endsWith('.json')).map(f=>fs.statSync(`${output}/save/${f}`).size),freshProcessReloadWithoutGeneration:reload};
if(reload){const prior=JSON.parse(fs.readFileSync(`${output}/summary.json`));if(prior.contentHash!==report.contentHash)throw Error('Fresh-process content changed');}
else{fs.writeFileSync(`${output}/fine-local-layer.json`,JSON.stringify(result));fs.writeFileSync(`${output}/parent-crop.json`,JSON.stringify(result.cut.context));fs.writeFileSync(`${output}/experiment-status.json`,JSON.stringify({schema:NEXT_LOCAL_VERSION,contentHash:report.contentHash,worldAdoption:'not-adopted-experimental-only',adoption:report.adoption,feasibility:report.feasibility,upstreamFeasibility:report.upstreamFeasibility,realism:report.realism},null,2));}
fs.writeFileSync(`${output}/${reload?'reload-summary':'summary'}.json`,JSON.stringify(report,null,2));
console.log(JSON.stringify({...report,selection:{...selection,trials:selection.trials.length}},null,2));
