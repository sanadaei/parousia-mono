import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {createL2SettlementHandoff,readL2SettlementCandidatePage} from '../src/core/l2-settlement-handoff.mjs';
import {makeL2SettlementDetail,createL2SettlementSurface} from '../src/core/l2-settlement-surface.mjs';
import {saveL2SettlementMaterialization} from '../src/core/l2-settlement-materialization.mjs';
import {createL1SettlementSurveySurface} from '../src/core/l1-settlement-survey-surface.mjs';
import {CommittedMaterializer} from '../src/core/committed-materialization.mjs';
import {createFileMaterializationStorage} from './materialization-file-store.mjs';
import {generateShapeFirstBundle} from '../src/globe/shape-first-generated.mjs';
import {readL2MaterializationReviewData} from './l2-materialization-review-data.mjs';
import {buildL2MaterializationReview} from './build-l2-materialization-review.mjs';

const RECORD_LIMIT=4*1024*1024;
export async function buildL2SettlementMaterialization({inputDir='reports/l2-settlement-baseline',outputDir='reports/l2-settlement-materialization'}={}){
  const l0=JSON.parse(fs.readFileSync(path.join(inputDir,'l0.json'),'utf8'));
  const l1=JSON.parse(fs.readFileSync(path.join(inputDir,'l1.json'),'utf8'));
  const summary=JSON.parse(fs.readFileSync(path.join(inputDir,'summary.json'),'utf8'));
  const coarse=createL1SettlementSurveySurface(l1),examples=[];
  fs.mkdirSync(outputDir,{recursive:true});
  const store=new CommittedMaterializer(createFileMaterializationStorage(path.join(outputDir,'committed'),{maxRecordBytes:RECORD_LIMIT}),{maxRecordBytes:RECORD_LIMIT});
  for(const region of summary.regions){
    const handoff=createL2SettlementHandoff(l1,l0.population,region.cellIndex);
    // Fixed selection, never search for a nicer native outcome or move a site.
    const slot=region.label.includes('村が多い')?handoff.budget.cities+handoff.budget.towns:0;
    const candidate=readL2SettlementCandidatePage(handoff,{offset:slot,limit:1}).candidates[0];
    if(!candidate)continue;
    const seed=`l2-native:${region.cellIndex}:${slot}`;
    const conditions={handoffId:handoff.id,parentLayerId:l1.id,radiusM:l1.snapshot.frame.radiusM,
      sourceSurfaceId:coarse.surfaceId,seed,version:'selected-native-settlement-demo@1'};
    const detail=await store.resolve({worldId:handoff.sourceWorldId,entityId:`L2-native:${handoff.id}/slot:${slot}`,
      conditions,generator:'selected-native-settlement-demo@1',generate:()=>{
        const bundle=generateShapeFirstBundle(seed),native=JSON.parse(bundle.candidateText),g=native.grid;
        const centerHeight=native.elevation[Math.floor(g.rows/2)*g.columns+Math.floor(g.columns/2)];
        return makeL2SettlementDetail(handoff,{candidate:native,water:bundle.water,
          center:{latDeg:candidate.latDeg,lonDeg:candidate.lonDeg},radiusM:l1.snapshot.frame.radiusM,
          elevationOffsetM:coarse.groundElevationAt(candidate.latDeg,candidate.lonDeg)-centerHeight,
          provenance:{method:'selected-native-settlement-demo@1',seed,parentSurfaceId:coarse.surfaceId,
            generator:native.generator.schema,placement:'Native shape translated to the saved candidate; one parent datum, no local origin relocation',
            water:'Designed channels with illustrative 400mm/year runoff; external river inflow, drinking water and flood recurrence unresolved',
            scope:'An explicit local L2 design example; adjacent native domains and adoption into the global runtime are unresolved'}});
      }});
    const reopenedDetail=await store.resolve({worldId:handoff.sourceWorldId,entityId:`L2-native:${handoff.id}/slot:${slot}`,
      conditions,generator:'selected-native-settlement-demo@1',generate:()=>{throw Error('Native source must not regenerate');}});
    assert.deepEqual(reopenedDetail,detail);
    const surface=createL2SettlementSurface(detail,handoff);
    const target=surface.projection.toGeographic(surface.extent.widthM/2-100,0);
    const options={slot,districtIndex:0,fieldOffset:0,fieldLimit:16,
      accessTarget:{id:`${handoff.id}/slot:${slot}/east-boundary`,...target,kind:'local-boundary-portal',provenance:'Explicit east-edge survey target; neighbouring road unresolved'}};
    const result=await saveL2SettlementMaterialization(store,surface,l0.population,handoff,options);
    const reopened=await saveL2SettlementMaterialization(store,surface,l0.population,handoff,options,{generate:()=>{throw Error('Saved layout must not regenerate');}});
    assert.deepEqual(reopened,result);
    const h=result.housing,f=result.fields;
    assert.equal(h.totalPopulation,h.requestedPopulation+h.unvisitedPopulation);
    assert.equal(h.requestedPopulation,h.representedPopulation+h.unresolvedPopulation);
    assert.equal(f.totalDemandM2,f.requestedM2+f.outsidePageM2);
    assert.equal(f.requestedM2,f.surveyedM2+f.unresolvedM2);
    const file=`cell-${region.cellIndex}-slot-${slot}.json`;
    const exported={label:region.label,handoff,detail,result};
    fs.writeFileSync(path.join(outputDir,file),JSON.stringify(exported));
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(outputDir,file),'utf8')),exported);
    examples.push({label:region.label,cellIndex:region.cellIndex,slot,file,candidateId:candidate.id,
      nativeSurfaceId:detail.id,origin:{latDeg:candidate.latDeg,lonDeg:candidate.lonDeg},population:candidate.population,
      housing:h,fields:{...f,accepted:f.accepted.length,rejected:f.rejected.length},accessStatus:result.access.status});
  }
  const output={schema:'l2-settlement-materialization-baseline@1',purpose:'diagnostic-only',realismAcceptance:'unaccepted',platform:'PC',inputDir,sourceLayerId:l1.id,
    examples,checks:{populationAndAreaConserved:true,reopenedWithoutRegeneration:true},
    limitations:['Orthogonal housing and rectangular field slots are diagnostic fixtures, not adopted village morphology',
      'Passing numerical checks or reference review does not establish landscape realism',
      'Only fixed representative candidates and bounded district/field pages were generated',
      'Local native designs are not adopted into the global terrain renderer; adjacent patches remain unjoined',
      'Surveyed fields do not establish food yield, rights or complete agricultural access',
      'A local road to a survey portal does not establish a neighbouring road connection',
      'Designed river water is not certified drinking water, global water balance or flood safety']};
  fs.writeFileSync(path.join(outputDir,'summary.json'),JSON.stringify(output,null,2));
  const reviewData=readL2MaterializationReviewData(outputDir);
  fs.writeFileSync(path.join(outputDir,'review-data.json'),JSON.stringify(reviewData));
  fs.writeFileSync(path.join(outputDir,'review.html'),examples.length?buildL2MaterializationReview(reviewData):
    '<!doctype html><html lang="ja"><meta charset="utf-8"><title>L2集落の検査</title><h1>詳細化する集落候補がありません</h1><p>入力されたL1には今回対象となる人口候補がありません。</p></html>');
  return output;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  console.error('診断用の仮配置を保存します。地形・村のリアリティは未受入で、全球ランタイムへの採用対象ではありません。');
  console.log(JSON.stringify(await buildL2SettlementMaterialization({inputDir:process.argv[2],outputDir:process.argv[3]}),null,2));
}
