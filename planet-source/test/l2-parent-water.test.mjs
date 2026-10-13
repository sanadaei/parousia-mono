import test from 'node:test';import assert from 'node:assert/strict';import fs from'node:fs';import os from'node:os';import path from'node:path';
import{waterFixture}from'./fixtures/l1-water.mjs';
import{connectL2Water,saveConnectedL2Water}from'../scripts/experiments/connect-l2-water.mjs';
const settings={latDeg:0,lonDeg:168.75,columns:24,rows:24,cellSizeM:60,seed:'water-test',detailAmplitude:0};
test('L2 receives L1 water, debits owned local rainfall, preserves ports and closes budget',()=>{
 const parent=waterFixture(),before=JSON.stringify(parent),r=connectL2Water(parent,settings,{minFlowM3PerSecond:0});
 assert.equal(r.parentWater.inflows.length,1);assert.equal(r.parentWater.routes.length,1);assert.ok(r.parentWater.routes[0].outletId);assert.ok(r.drainage.diagnostics.relativeBudgetResidual<1e-10);assert.equal(r.drainage.diagnostics.depressionCells,0);assert.ok(r.parentWater.localYieldDebits[0].localYieldDebitM3>0);assert.ok(r.parentWater.inflows[0].supplyM3PerYear<r.parentWater.localYieldDebits[0].parentAnnualSupplyM3);
 for(const p of r.parentWater.paths)for(let k=1;k<p.cells.length;k++){assert.equal(r.drainage.receiver[p.cells[k-1]],p.cells[k]);assert.ok(r.elevation[p.cells[k-1]]>=r.elevation[p.cells[k]]);}
 assert.equal(JSON.stringify(parent),before);assert.ok(r.cover.every(c=>c.kind));
 const reordered=Object.fromEntries(Object.entries(settings).reverse());assert.equal(connectL2Water(parent,reordered,{minFlowM3PerSecond:0}).id,r.id);
 const repeated=connectL2Water(parent,settings,{minFlowM3PerSecond:0,boundaryAnchors:r.parentWater.boundaryAnchors});assert.deepEqual(repeated.elevation,r.elevation);
});
test('L2 saved materialization reopens identical; changed parent-water conditions require migration',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'parent-water-'));try{const p=waterFixture(),opts={minFlowM3PerSecond:0};const a=await saveConnectedL2Water(p,settings,dir,opts),b=await saveConnectedL2Water(p,settings,dir,opts);assert.deepEqual(a,b);await assert.rejects(saveConnectedL2Water(p,{...settings,seed:'changed'},dir,opts),/migration/);}finally{fs.rmSync(dir,{recursive:true});}
});
test('L2 rejects absent river and inconsistent committed riverbed instead of inventing water',()=>{
 const p=waterFixture();assert.throws(()=>connectL2Water(p,settings,{minFlowM3PerSecond:1e6}),/through-channel/);
 const r=connectL2Water(p,settings,{minFlowM3PerSecond:0}),anchors=r.parentWater.boundaryAnchors.map(a=>({...a,elevationM:10000}));assert.throws(()=>connectL2Water(p,settings,{minFlowM3PerSecond:0,boundaryAnchors:anchors}),/conflict/);
});

test('a rectangular window must not merge separate parent catchments',()=>{
 const p=waterFixture();assert.throws(()=>connectL2Water(p,{...settings,lonDeg:180},{minFlowM3PerSecond:0}),/through-channel|watershed divide/);
});
