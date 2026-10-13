import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {buildL0SettlementBaseline,parseBaselineArgs,saveBaseline,SETTLEMENT_BUDGETS} from './build-l0-settlement-baseline.mjs';
import {createL2SettlementHandoff,validateL2SettlementHandoff,readL2SettlementCandidatePage,surveyL2SettlementCandidates,settlementKindBounds} from '../src/core/l2-settlement-handoff.mjs';
import {createL1SettlementSurveySurface} from '../src/core/l1-settlement-survey-surface.mjs';
import {CommittedMaterializer} from '../src/core/committed-materialization.mjs';
import {createFileMaterializationStorage} from './materialization-file-store.mjs';
import {renderSavedSettlementDistributionReview} from './build-settlement-distribution-review.mjs';
import {buildL2SettlementReview} from './build-l2-settlement-review.mjs';
import {requireVerificationMemory} from './verification-runtime.mjs';

/** Persist a bounded regional handoff and its screening result. An existing
 * committed page is read without running the sampler or changing its sites. */
export async function saveL2SettlementCandidateSurvey(l1,population,cellIndex,{offset=0,limit=64,directory,surface=createL1SettlementSurveySurface(l1),generateSurvey=surveyL2SettlementCandidates}={}) {
  const handoff=createL2SettlementHandoff(l1,population,cellIndex);
  if(!surface.surfaceId||surface.sourceLayerId!==handoff.layerId)throw new RangeError('Identified matching L1 screening surface required');
  if(typeof directory!=='string'||!directory)throw new TypeError('A persistent regional output directory is required');
  const page=readL2SettlementCandidatePage(handoff,{offset,limit});
  const maxRecordBytes=1024*1024;
  const store=new CommittedMaterializer(createFileMaterializationStorage(directory,{maxRecordBytes}),{maxRecordBytes});
  return store.resolve({worldId:handoff.sourceWorldId,entityId:`L2-candidates:${handoff.id}/${page.offset}/${page.limit}`,
    conditions:{handoffId:handoff.id,surfaceId:surface.surfaceId,sourceLayerId:surface.sourceLayerId,offset:page.offset,limit:page.limit},
    generator:'l2-settlement-screening@1',generate:()=>({handoff,page,survey:generateSurvey(surface,population,handoff,{offset:page.offset,limit:page.limit})})});
}

function checkRecord(record) {
  const {handoff,page,survey}=record;validateL2SettlementHandoff(handoff);
  assert.deepEqual(page,readL2SettlementCandidatePage(handoff,{offset:page.offset,limit:page.limit}));
  for(const key of SETTLEMENT_BUDGETS){
    assert.equal(survey.budgets.requested[key],survey.budgets.adopted[key]+survey.budgets.unresolved[key]);
    assert.equal(handoff.budget[key],survey.budgets.requested[key]+survey.budgets.unvisited[key]);
  }
  const f=survey.farmlandDemandM2;
  assert.equal(f.requested,f.adopted+f.unresolved);assert.equal(f.total,f.requested+f.unvisited);
}

function selectRegions(l1) {
  const d=l1.settlementDistribution,w=d.grid.columns,h=d.grid.rows,z=l1.snapshot.fields.groundElevationM;
  const occupied=d.fields.population.map((p,i)=>p?i:-1).filter(i=>i>=0), used=new Set();
  const choices=[];
  const choose=(label,compare,filter=()=>true)=>{const i=occupied.filter(i=>!used.has(i)&&filter(i)).sort(compare)[0];if(i!==undefined){used.add(i);choices.push({cellIndex:i,label});}};
  choose('都市を含む地域',(a,b)=>d.fields.cityPopulation[b]-d.fields.cityPopulation[a]||a-b,i=>d.fields.cities[i]>0);
  choose('村が多い地域',(a,b)=>d.fields.villages[b]-d.fields.villages[a]||a-b);
  const relief=i=>{const x=i%w,y=Math.floor(i/w),neighbours=[y*w+(x+w-1)%w,y*w+(x+1)%w,...(y?[i-w]:[]),...(y<h-1?[i+w]:[])];return Math.max(...neighbours.map(j=>Math.abs(z[j]-z[i])));};
  choose('起伏が大きい地域',(a,b)=>relief(b)-relief(a)||a-b);
  if(!choices.length)choose('人口0の地域',()=>0); // Fully empty scenarios still have a valid empty handoff.
  if(!choices.length)choices.push({cellIndex:0,label:'人口0の地域'});
  return choices;
}

export async function buildL2SettlementBaseline(options) {
  const {seed,population,columns,rows,levels,outputDir}=options;
  const baseline=buildL0SettlementBaseline({seed,targetPopulation:population,columns,rows,levels});
  const saved=saveBaseline(baseline,outputDir);
  renderSavedSettlementDistributionReview(outputDir,path.join(outputDir,'distribution.html'));
  fs.copyFileSync(path.join(outputDir,'summary.json'),path.join(outputDir,'l0-summary.json'));
  const {l0,l1}=baseline,surface=createL1SettlementSurveySurface(l1),regions=[],manifest=[];
  const committedDir=path.join(outputDir,'committed');
  for(const selection of selectRegions(l1)){
    const handoff=createL2SettlementHandoff(l1,l0.population,selection.cellIndex),total=handoff.budget.villages+handoff.budget.towns+handoff.budget.cities;
    const offsets=[...new Set([0,...(total>64?[64,Math.floor((total-1)/64)*64]:[])])];
    const pages=[];
    for(const offset of offsets){
      const record=await saveL2SettlementCandidateSurvey(l1,l0.population,selection.cellIndex,{offset,limit:64,directory:committedDir,surface});
      checkRecord(record);
      const reopened=await saveL2SettlementCandidateSurvey(l1,l0.population,selection.cellIndex,{offset,limit:64,directory:committedDir,surface,generateSurvey:()=>{throw new Error('Saved screening must not run again');}});
      assert.deepEqual(reopened,record);
      const file=`cell-${selection.cellIndex}-page-${offset}.json`;
      fs.writeFileSync(path.join(outputDir,file),JSON.stringify(record));
      assert.deepEqual(JSON.parse(fs.readFileSync(path.join(outputDir,file),'utf8')),record);
      manifest.push({cellIndex:selection.cellIndex,label:selection.label,handoffId:handoff.id,offset,file});
      const siteById=new Map(record.survey.sites.map(s=>[s.id,s]));
      const reasons=new Map((record.survey.unresolvedCandidates??[]).map(c=>[c.id,c.reason]));
      const unknown=handoff.farmland.unresolved;
      pages.push({offset:record.page.offset,total:record.page.total,requestedBudget:record.survey.budgets.requested,
        acceptedBudget:record.survey.budgets.adopted,unresolvedBudget:record.survey.budgets.unresolved,unvisitedBudget:record.survey.budgets.unvisited,
        requestedAgricultureM2:unknown?null:record.survey.farmlandDemandM2.requested,
        acceptedAgricultureM2:unknown?null:record.survey.farmlandDemandM2.adopted,unresolvedAgricultureM2:unknown?null:record.survey.farmlandDemandM2.unresolved,
        candidates:record.page.candidates.map(c=>{const site=siteById.get(c.id);return {id:c.id,slot:c.slot,kind:c.kind,settlementClass:c.settlementClass,population:c.population,
          latDeg:c.latDeg,lonDeg:c.lonDeg,requestedCultivatedAreaM2:unknown?null:c.farmlandDemandM2,status:site?'sited-needs-local-layout':'unresolved',reason:site?null:reasons.get(c.id)??'not-established'};})});
    }
    regions.push({id:handoff.id,label:selection.label,cellIndex:selection.cellIndex,rootCell:handoff.parentCell,bounds:handoff.bounds,budget:handoff.budget,
      agriculture:{status:handoff.farmland.unresolved?'unresolved':'demand-only',requestedCultivatedAreaM2:handoff.farmland.unresolved?null:handoff.farmland.totalDemandM2},pages});
  }
  const data={schema:'l2-settlement-review@1',seed,census:{requestedPopulation:l0.population.totals.targetPopulation,supportedPopulation:l0.population.totals.supportedPopulation,unplacedPopulation:l0.population.totals.unplacedPopulation},
    global:{grid:l1.snapshot.grid,population:l1.settlementDistribution.fields.population,cellAreaM2:l1.climate.cellAreaM2,surface:l1.snapshot.fields.landMask.map((v,i)=>!v?'sea':l1.snapshot.fields.lakeFillDepthM[i]>0?'lake':'land')},
    sizePolicy:Object.fromEntries(['village','town','city'].map(kind=>[kind,settlementKindBounds(l0.population.sizePolicy,kind)])),regions};
  const summary={schema:'l2-settlement-baseline@1',seed,census:data.census,l0Totals:l0.settlementDistribution.totals,l1Totals:l1.settlementDistribution.totals,l1Unallocated:l1.settlementDistribution.unallocated.totals,
    sourceLayerId:l1.id,screeningSurfaceId:surface.surfaceId,screeningMethod:surface.method,sizes:saved.sizes,
    regions:regions.map(r=>({label:r.label,cellIndex:r.cellIndex,budget:r.budget,requestedCultivatedAreaM2:r.agriculture.requestedCultivatedAreaM2,pages:r.pages.map(p=>({offset:p.offset,total:p.total,requested:p.requestedBudget,accepted:p.acceptedBudget,unresolved:p.unresolvedBudget,unvisited:p.unvisitedBudget}))})),
    checks:{sevenBudgetsConserved:true,farmlandDemandConserved:true,savedPagesReopenedWithoutSurvey:true},
    limitations:['Regional candidate screening on saved coarse L1 heights and water masks; local L2 relief and plots are unresolved','Cultivated area is demand only, not acquired or laid-out land','No houses, roads, flood certification or drinking-water evidence','Only selected representative pages are saved by this command; the core page API works for any valid L1 cell']};
  fs.writeFileSync(path.join(outputDir,'manifest.json'),JSON.stringify(manifest,null,2));
  fs.writeFileSync(path.join(outputDir,'summary.json'),JSON.stringify(summary,null,2));
  fs.writeFileSync(path.join(outputDir,'review-data.json'),JSON.stringify(data));
  fs.writeFileSync(path.join(outputDir,'review.html'),buildL2SettlementReview(data));
  return summary;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  requireVerificationMemory();
  const options=parseBaselineArgs(['reports/l2-settlement-baseline',...process.argv.slice(2)]);
  console.log(JSON.stringify(await buildL2SettlementBaseline(options),null,2));
}
