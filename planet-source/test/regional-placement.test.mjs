import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {auditL0} from '../scripts/audit-l0.mjs';
import {placeRegionalCandidate,regionalView,savePlacedRegion} from '../scripts/experiments/place-regional-candidate.mjs';
const parent=auditL0('regional-placement',{columns:32,rows:16});
const s=parent.snapshot,i=s.fields.landMask.findIndex((v,i)=>v&&!(s.fields.lakeFillDepthM[i]>0)&&Math.floor(i/32)>2&&Math.floor(i/32)<13);
const settings={latDeg:90-(Math.floor(i/32)+.5)*180/16,lonDeg:(i%32+.5)*360/32,seed:'placement',columns:32,rows:24,cellSizeM:120,detailAmplitude:1};
const result=placeRegionalCandidate(parent,settings);
test('regional placement uses parent yield rather than independent constant supply',()=>{
 const expected=result.yieldMm.reduce((sum,y)=>sum+y/1000*120**2,0);
 const exits=result.drainage.outlets.reduce((sum,o)=>sum+result.drainage.routedSupplyM3PerYear[o.cell],0);
 assert.ok(Math.abs(expected-exits)<1e-6);assert.equal(result.sourceWorldId,s.worldId);assert.ok(result.elevation.every(Number.isFinite));
});
test('adjacent views share exact terrain samples and keep directed water flux',()=>{
 const a=regionalView(result,{x0:0,y0:0,columns:17,rows:24}),b=regionalView(result,{x0:16,y0:0,columns:16,rows:24});
 for(let y=0;y<24;y++)assert.equal(a.elevation[y*17+16],b.elevation[y*16]);
 const left=regionalView(result,{x0:0,y0:0,columns:16,rows:24}),right=regionalView(result,{x0:16,y0:0,columns:16,rows:24});
 assert.ok(left.crossings.length>0);
 assert.deepEqual(left.crossings.map(({direction,...v})=>v),right.crossings.map(({direction,...v})=>v));
 assert.ok(left.crossings.every((v,i)=>v.direction!==right.crossings[i].direction));
});
test('changed rainfall changes water supply without remaking terrain',()=>{
 const p=structuredClone(parent);p.climate.id+=':zero';p.climate.catchmentWater.annualLocalYieldMm.fill(0);
 const r=placeRegionalCandidate(p,settings);assert.deepEqual(r.elevation,result.elevation);assert.ok(r.drainage.routedSupplyM3PerYear.every(v=>v===0));
});
test('region persists across reopened storage and rejects silent condition changes',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'placed-region-'));
 try{const a=await savePlacedRegion(parent,settings,dir);const b=await savePlacedRegion(parent,settings,dir);assert.deepEqual(a,b);await assert.rejects(savePlacedRegion(parent,{...settings,seed:'changed'},dir),/migration/);}finally{fs.rmSync(dir,{recursive:true});}
});
test('placement and view reject unsupported inputs',()=>{
 assert.throws(()=>placeRegionalCandidate(parent,{...settings,latDeg:89}),/nonpolar/);
 assert.throws(()=>regionalView(result,{x0:30,y0:0,columns:4,rows:24}),/outside/);
 const p=structuredClone(parent);p.climate.sourceWorldId='other';assert.throws(()=>placeRegionalCandidate(p,settings),/Matching/);
});

test('failed independent-neighbour experiment never changes the committed region',async()=>{
 const {extendRegionalCandidate}=await import('../scripts/experiments/extend-regional-candidate.mjs');
 const before=JSON.stringify(result),trial=extendRegionalCandidate(parent,result,{seed:'next-region',columns:24});
 assert.equal(JSON.stringify(result),before);
 assert.ok(['rejected','constraints-pass-visual-unapproved'].includes(trial.status));
 if(trial.status!=='rejected'){
  assert.equal(trial.diagnostics.oldHeightChanges,0);assert.equal(trial.diagnostics.oldInteriorReceiverChanges,0);
  assert.ok(trial.diagnostics.relativeBudgetResidual<1e-10);
 }
});
