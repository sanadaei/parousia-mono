import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {CommittedMaterializer} from '../src/core/committed-materialization.mjs';
import {createFileMaterializationStorage} from '../scripts/materialization-file-store.mjs';
import {saveL2SettlementMaterialization,materializeL2SettlementCandidate} from '../src/core/l2-settlement-materialization.mjs';
const {handoff}=JSON.parse(fs.readFileSync(new URL('../fixtures/l2-settlement-handoff.json',import.meta.url)));
const population={id:handoff.populationId,sourceWorldId:handoff.sourceWorldId};
const surface={worldId:handoff.sourceWorldId,sourceLayerId:handoff.layerId,surfaceId:'controlled-native-persistence',
  layer:'L2',detailKind:'native-l2-terrain@1',nativeSpacingM:{east:50,north:50},frame:{radiusM:6371000},
  sampleSurfaceAt:()=>({groundElevationM:100,waterDepthM:0,waterLevelElevationM:null}),groundElevationAt:()=>100};
test('a new file-store instance reopens the exact layout and rejects changed detail without overwrite',async()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'l2-native-persistence-'));
  const options={slot:2,fieldLimit:2},maxRecordBytes=4*1024*1024;
  const fresh=()=>new CommittedMaterializer(createFileMaterializationStorage(directory,{maxRecordBytes}),{maxRecordBytes});
  const fail=()=>{throw Error('Cold reopening must not generate geometry');};
  try{
    const saved=await saveL2SettlementMaterialization(fresh(),surface,population,handoff,options);
    assert.deepEqual(await saveL2SettlementMaterialization(fresh(),surface,population,handoff,options,{generate:fail}),saved);
    await assert.rejects(saveL2SettlementMaterialization(fresh(),{...surface,surfaceId:'changed'},population,handoff,options),/conditions changed/);
    assert.deepEqual(await saveL2SettlementMaterialization(fresh(),surface,population,handoff,options,{generate:fail}),saved);
  }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
test('district demand is partitioned exactly without duplicate residential IDs',()=>{
  const first=materializeL2SettlementCandidate(surface,population,handoff,{slot:0,fieldLimit:1});
  let represented=0,requested=0;const ids=new Set();
  for(let districtIndex=0;districtIndex<first.districtCount;districtIndex++){
    const r=materializeL2SettlementCandidate(surface,population,handoff,{slot:0,districtIndex,fieldLimit:1});
    requested+=r.housing.requestedPopulation;represented+=r.housing.representedPopulation;
    for(const b of r.layout?.buildings??[]){assert.ok(!ids.has(b.id));ids.add(b.id);}
  }
  assert.equal(requested,first.housing.totalPopulation);
  assert.equal(represented,first.housing.totalPopulation);
});
