import fs from 'node:fs';
import path from 'node:path';
import {createL0ResolutionSeries} from './l0-resolution-series.mjs';
import {createL1BroadRegion} from '../../src/core/l1-broad-region.mjs';
import {buildGlobalWaterHandoff,saveGlobalWaterOverlay,createOverlayFlowAccessor} from './global-water-handoff.mjs';
import {CommittedMaterializer} from '../../src/core/committed-materialization.mjs';
import {createFileMaterializationStorage} from '../materialization-file-store.mjs';
const [input,expectedLayerId,directory]=process.argv.slice(2);
if(!directory)throw Error('Usage: build-global-water-handoff.mjs L0.json EXPECTED_L1_ID NEW_OUTPUT_DIRECTORY');
const l0=JSON.parse(fs.readFileSync(input,'utf8')),series=createL0ResolutionSeries(l0.snapshot),l1=createL1BroadRegion(l0,series.cases[2]);
if(l1.id!==expectedLayerId)throw Error('Reproduced L1 differs from expected saved source');
const handoff=buildGlobalWaterHandoff(l1),store=new CommittedMaterializer(createFileMaterializationStorage(path.join(directory,'store'))),overlay=await saveGlobalWaterOverlay(store,l1,handoff),read=createOverlayFlowAccessor(l1,overlay);
fs.mkdirSync(directory,{recursive:true});
function writeNew(name,value){const file=path.join(directory,name),text=JSON.stringify(value);try{fs.writeFileSync(file,text,{flag:'wx'});}catch(e){if(e.code!=='EEXIST')throw e;if(fs.readFileSync(file,'utf8')!==text)throw Error('Existing output differs; choose a new review directory');}}
writeNew('handoff.json',handoff);writeNew('overlay.json',overlay);
const summary={sourceLayerId:l1.id,handoffId:handoff.id,overlayId:overlay.id,contextId:overlay.regionalContext.id,grid:handoff.context.grid,diagnostics:handoff.diagnostics,outletLedger:handoff.outletLedger,downstreamUpdates:overlay.downstreamLedger.updates.length,maxExteriorRelativeResidual:overlay.downstreamLedger.maxExteriorRelativeResidual,terminalDeltaAnnualM3:overlay.downstreamLedger.terminalDeltaAnnualM3,status:overlay.status,sampleOutsideFlow:read(33507)};
writeNew('summary.json',summary);console.log(JSON.stringify(summary,null,2));
