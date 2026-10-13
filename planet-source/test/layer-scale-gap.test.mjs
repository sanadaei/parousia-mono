import test from 'node:test';import assert from 'node:assert/strict';
import{waterFixture}from'./fixtures/l1-water.mjs';
import{compareLayerScaleGap}from'../scripts/experiments/compare-layer-scale-gap.mjs';
const settings={fromCell:55,toCell:71,columns:64,rows:64,cellSizeM:1000,detailAmplitude:0,stepsM:[32000,16000,8000,4000,2000]};
const parent=waterFixture(),before=JSON.stringify(parent),series=compareLayerScaleGap(parent,settings);
test('resolution stages sample one frozen terrain without mutating the parent',()=>{
 assert.equal(JSON.stringify(parent),before);assert.equal(series.cases.length,5);assert.equal(new Set(series.cases.map(c=>c.sourceTerrainId)).size,1);
 assert.deepEqual(series.cases.map(c=>c.grid.columns),[3,5,9,17,33]);
 for(const c of series.cases){assert.ok(c.elevation.every(Number.isFinite));assert.ok(c.elevation.length<=65536);assert.ok(c.drainage.outlets.every(p=>p.kind==='open-boundary'));assert.ok(c.sourceSnapDistanceM<=Math.hypot(c.grid.cellSizeM,c.grid.cellSizeYM)/2+1e-7);}
});
test('physical area and local annual input are conserved across sampling resolution',()=>{
 const expected=.1*63000**2;
 for(const c of series.cases){assert.ok(Math.abs(c.drainage.diagnostics.totalInputM3PerYear-expected)<1e-5);assert.ok(c.drainage.diagnostics.relativeBudgetResidual<1e-10);assert.ok(c.path.length>=1);assert.equal(c.drainage.receiver[c.path.at(-1).cell],-1);}
});
test('merely executing intermediate stages does not alter an identical finest solve',()=>{
 const direct=compareLayerScaleGap(parent,{...settings,stepsM:[2000]}).cases[0],staged=series.cases.at(-1);
 assert.deepEqual(direct.elevation,staged.elevation);assert.deepEqual(direct.drainage,staged.drainage);assert.deepEqual(direct.path,staged.path);
});
test('invalid scales and missing parent river cannot silently substitute another experiment',()=>{
 assert.throws(()=>compareLayerScaleGap(parent,{...settings,stepsM:[1000,2000]}),/decreasing/);
 assert.throws(()=>compareLayerScaleGap(parent,{...settings,fromCell:0,toCell:2}),/parent reach/);
});
