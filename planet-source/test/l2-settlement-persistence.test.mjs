import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {buildL0SettlementBaseline} from '../scripts/build-l0-settlement-baseline.mjs';
import {saveL2SettlementCandidateSurvey} from '../scripts/build-l2-settlement-baseline.mjs';
import {createL1SettlementSurveySurface} from '../src/core/l1-settlement-survey-surface.mjs';

test('L2 candidate pages reopen with the original screening and reject a changed surface',async()=>{
  const {l0,l1}=buildL0SettlementBaseline({seed:'settlement-reopen',targetPopulation:100000,columns:16,rows:8,levels:2});
  const cell=l1.settlementDistribution.fields.population.findIndex(n=>n>0),surface=createL1SettlementSurveySurface(l1);
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'l2-candidate-reopen-'));
  try{
    const saved=await saveL2SettlementCandidateSurvey(l1,l0.population,cell,{limit:2,directory,surface});
    const reopened=await saveL2SettlementCandidateSurvey(l1,l0.population,cell,{limit:2,directory,surface,
      generateSurvey:()=>{throw new Error('A saved page must never be screened again');}});
    assert.deepEqual(reopened,saved);
    assert.ok(saved.page.candidates.length>0);
    assert.equal(saved.survey.farmlandDemandM2.requested+saved.survey.farmlandDemandM2.unvisited,saved.handoff.farmland.totalDemandM2);
    await assert.rejects(saveL2SettlementCandidateSurvey(l1,l0.population,cell,{limit:2,directory,surface:{...surface,surfaceId:'changed-surface'}}),/conditions changed/);
    await assert.rejects(saveL2SettlementCandidateSurvey(l1,l0.population,cell,{limit:2,directory,surface:{...surface,sourceLayerId:'other-layer'}}),/matching L1/);
  }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
