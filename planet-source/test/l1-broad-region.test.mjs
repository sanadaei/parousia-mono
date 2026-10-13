import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {auditL0} from '../scripts/audit-l0.mjs';import {createL0ResolutionSeries} from '../scripts/experiments/l0-resolution-series.mjs';
import {createL1BroadRegion} from '../src/core/l1-broad-region.mjs';import {saveL1BroadRegion} from '../scripts/experiments/build-l1-broad-region.mjs';import {placeRegionalCandidate} from '../scripts/experiments/place-regional-candidate.mjs';
const parent=auditL0('regional-placement',{columns:32,rows:16}),series=createL0ResolutionSeries(parent.snapshot,{levels:2}),level=series.cases[1];
test('L1 preserves root world, has distinct layer identity and conserved annual water projection',()=>{
 const before=JSON.stringify(parent),r=createL1BroadRegion(parent,level);assert.equal(r.snapshot.worldId,parent.snapshot.worldId);assert.equal(r.snapshot.layer,'L1');assert.equal(r.snapshot.layerId,r.id);assert.notEqual(r.id,parent.snapshot.worldId);assert.equal(r.climate.sourceLayerId,r.id);assert.deepEqual(r.snapshot.grid,{columns:64,rows:32});assert.ok(r.diagnostics.relativeBudgetResidual<1e-10);assert.equal(JSON.stringify(parent),before);
});
test('old regional generator now consumes the L1 parent as L2 with recorded provenance',()=>{
 const r=createL1BroadRegion(parent,level),w=r.snapshot.grid.columns,h=r.snapshot.grid.rows;
 const i=r.snapshot.fields.landMask.findIndex((v,i)=>v&&!r.snapshot.fields.lakeFillDepthM[i]&&Math.floor(i/w)>3&&Math.floor(i/w)<h-4&&r.climate.biome[i]!=='unresolved-coastal');assert.ok(i>=0);
 const settings={latDeg:90-(Math.floor(i/w)+.5)*180/h,lonDeg:(i%w+.5)*360/w,seed:'L2-example',columns:32,rows:24,cellSizeM:120};
 const local=placeRegionalCandidate(r,settings);assert.equal(local.sourceLayerId,r.id);assert.equal(local.parentLayer,'L1');assert.equal(local.sourceWorldId,parent.snapshot.worldId);assert.ok(local.parentElevation.every(Number.isFinite));assert.ok(local.drainage.diagnostics.relativeBudgetResidual<1e-10);
});
test('saved L1 reloads identically and refuses silent climate replacement',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'L1-save-'));try{const a=await saveL1BroadRegion(parent,level,dir),b=await saveL1BroadRegion(parent,level,dir);assert.deepEqual(a,b);const p=structuredClone(parent);p.climate.id+='changed';await assert.rejects(saveL1BroadRegion(p,level,dir),/migration/);}finally{fs.rmSync(dir,{recursive:true});}
});
test('L1 rejects mismatched or altered stage inputs',()=>{
 const l=structuredClone(level);l.sourceWorldId='wrong';assert.throws(()=>createL1BroadRegion(parent,l),/Matching/);l.sourceWorldId=level.sourceWorldId;l.elevation[0]+=1;assert.throws(()=>createL1BroadRegion(parent,l),/identity/);
});

test('L2 rejects climate from a different L1 layer even within the same world',()=>{
 const r=createL1BroadRegion(parent,level);r.climate.sourceLayerId='other-layer';
 assert.throws(()=>placeRegionalCandidate(r,{latDeg:0,lonDeg:0,seed:'mismatch'}),/Matching parent/);
});
