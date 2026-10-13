import test from 'node:test';
import assert from 'node:assert/strict';
import {createL1SettlementSurveySurface} from '../src/core/l1-settlement-survey-surface.mjs';
const fixture=()=>({schema:'l1-broad-region@1',id:'l1',sourceWorldId:'world',snapshot:{layer:'L1',layerId:'l1',worldId:'world',grid:{columns:4,rows:2},frame:{radiusM:6371000},fields:{groundElevationM:[100,120,140,160,100,120,140,160],landMask:[1,1,1,0,1,1,1,0],lakeFillDepthM:[0,0,10,0,0,0,0,0]},references:{sea:{levelElevationM:0}}}});
test('L1 screening uses saved heights and masks and identifies the exact surface',()=>{
  const l1=fixture(),before=JSON.stringify(l1),s=createL1SettlementSurveySurface(l1);
  assert.equal(s.groundElevationAt(45,45),100);
  assert.equal(s.groundElevationAt(45,90),110);
  assert.equal(s.sampleSurfaceAt(45,225).sitingWet,true);
  assert.equal(s.sampleSurfaceAt(-45,225).sitingWet,false);
  assert.equal(s.sampleSurfaceAt(45,315).sitingWet,true);
  assert.equal(s.groundElevationAt(30,0),s.groundElevationAt(30,360));
  assert.equal(s.surfaceId,createL1SettlementSurveySurface(JSON.parse(before)).surfaceId);
  l1.snapshot.fields.groundElevationM[0]++;
  assert.notEqual(s.surfaceId,createL1SettlementSurveySurface(l1).surfaceId);
  assert.equal(s.groundElevationAt(45,45),100);
});
test('L1 screening rejects incomplete fields and invalid coordinates',()=>{
  const l1=fixture();l1.snapshot.fields.landMask.pop();
  assert.throws(()=>createL1SettlementSurveySurface(l1));
  const s=createL1SettlementSurveySurface(fixture());
  assert.throws(()=>s.sampleSurfaceAt(91,0));assert.throws(()=>s.groundElevationAt(0,NaN));
});
