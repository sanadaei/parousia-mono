import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {hashJson} from '../src/core/json-contract.mjs';
import {createHash} from '../src/core/sha256.mjs';
import {makeL2SettlementDetail,createL2SettlementSurface} from '../src/core/l2-settlement-surface.mjs';
import {readL2SettlementCandidatePage} from '../src/core/l2-settlement-handoff.mjs';
const {handoff} = JSON.parse(fs.readFileSync(new URL('../fixtures/l2-settlement-handoff.json',import.meta.url)));
const origin = readL2SettlementCandidatePage(handoff,{offset:2,limit:1}).candidates[0];
const digest = v => createHash('sha256').update(JSON.stringify(v)).digest('hex');
function fixture(){
  const candidate={schema:'shape-first-candidate@1',grid:{columns:5,rows:5,cellSizeM:100,cellSizeYM:100,row0:'north',yDirection:'south'},
    elevation:Array.from({length:25},(_,i)=>20+(i%5)*.1),rivers:[[{xM:0,yM:0},{xM:400,yM:0}]],
    riverDesign:{rivers:[{id:'r',parentId:null,order:1,designBedElevationM:[19,20]}]}};
  const hashes={height:digest(candidate.elevation),rivers:digest(candidate.rivers)};
  const water={schema:'shape-first-water-annotation@1',scenario:{kind:'synthetic-demonstration',runoffMmPerYear:0},
    preservation:{before:hashes,after:hashes},rivers:[{id:'r',parent:null,segmentFlowM3PerSecond:[.1]}]};
  return {candidate,water,center:{latDeg:origin.latDeg,lonDeg:origin.lonDeg},radiusM:6371000,elevationOffsetM:100,
    provenance:{method:'controlled-synthetic-native-fixture'}};
}
test('saved native L2 terrain is shared and never falls back outside its domain',()=>{
  const input=fixture(),detail=makeL2SettlementDetail(handoff,input),surface=createL2SettlementSurface(detail,handoff);
  const center=surface.sampleSurfaceAt(origin.latDeg,origin.lonDeg);
  assert.ok(center.groundElevationM>120&&center.groundElevationM<121);
  assert.equal(center.waterDepthM,0);assert.equal(surface.layer,'L2');
  const outside=surface.projection.toGeographic(300,0);
  assert.equal(surface.sampleSurfaceAt(outside.latDeg,outside.lonDeg).unknown,true);
  assert.ok(Number.isNaN(surface.groundElevationAt(outside.latDeg,outside.lonDeg)));
  const snapshot=surface.toSnapshot();snapshot.candidate.elevation.fill(-1000);
  input.candidate.elevation.fill(-2000);
  assert.deepEqual(surface.sampleSurfaceAt(origin.latDeg,origin.lonDeg),center);
  assert.deepEqual(createL2SettlementSurface(JSON.parse(JSON.stringify(detail)),handoff).toSnapshot(),detail);
});
test('native-grid, content identity, handoff and water-geometry mismatches fail closed',()=>{
  const detail=makeL2SettlementDetail(handoff,fixture());
  const corrupt=structuredClone(detail);corrupt.candidate.elevation[0]++;
  assert.throws(()=>createL2SettlementSurface(corrupt,handoff),/identity/);
  const tooCoarse=fixture();tooCoarse.candidate.grid.cellSizeM=101;
  assert.throws(()=>makeL2SettlementDetail(handoff,tooCoarse),/spacing/);
  const altered=structuredClone(detail);altered.parentLayerId='wrong';delete altered.id;altered.id=hashJson(altered);
  assert.throws(()=>createL2SettlementSurface(altered,handoff),/geography/);
  const badWater=fixture();badWater.water.preservation.before.height='bad';
  assert.throws(()=>makeL2SettlementDetail(handoff,badWater),/height/);
});
