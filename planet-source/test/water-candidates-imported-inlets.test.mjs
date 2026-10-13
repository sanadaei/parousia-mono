import test from 'node:test';
import assert from 'node:assert/strict';
import {solveRegionalDrainage} from '../src/core/regional-drainage.mjs';
import {createRegionalWaterContext} from '../src/core/regional-water-context.mjs';
import {reconcileWaterCandidate,refineWaterCandidate,saveWaterCandidate} from '../src/core/refine-water-candidates.mjs';
test('water-candidates-imported-inlets',async()=>{
const z=Array.from({length:25},(_,i)=>100-Math.floor(i/5)*10-i%5);
const drainage=solveRegionalDrainage({columns:5,rows:5,cellSizeM:200,elevation:z,localSupplyM3PerYear:Array(25).fill(1),inflows:[{id:'inlet-upstream-A',cell:2,supplyM3PerYear:10000}],outlets:[{id:'downstream-A',cell:24,kind:'river',levelM:z[24]}]});
const parent=createRegionalWaterContext({sourceWorldId:'world',sourceLayerId:'layer',grid:drainage.grid,elevation:z,drainage});
const r=reconcileWaterCandidate(parent,{factor:2,method:'soft-divide'},{downstreamBudgetsStatus:'provisional'});
assert.deepEqual(r.context.supplyOwnership.inflows,[{id:'inlet-upstream-A',cell:4,supplyM3PerYear:10000}]);
assert.ok(Math.abs(r.context.supplyOwnership.localSupplyM3PerYear.reduce((a,b)=>a+b,0)-25)<1e-10);
assert.ok(Math.abs(r.drainage.diagnostics.totalInputM3PerYear-10025)<1e-8);
const r2=reconcileWaterCandidate(r.context,{factor:2,method:'soft-divide'},{downstreamBudgetsStatus:'provisional'});
assert.deepEqual(r2.context.supplyOwnership.inflows,[{id:'inlet-upstream-A',cell:8,supplyM3PerYear:10000}]);
assert.ok(Math.abs(r2.drainage.diagnostics.totalInputM3PerYear-10025)<1e-8);
assert.notEqual(refineWaterCandidate(parent,{factor:2,method:'soft-divide',softSlopeFraction:.15}).id,refineWaterCandidate(parent,{factor:2,method:'soft-divide',softSlopeFraction:.5}).id);
const records=new Map();const store={resolve:async q=>{const key=JSON.stringify(q.conditions);if(records.has(q.entityId)){assert.equal(records.get(q.entityId).key,key,'existing immutable entity conditions differ');return records.get(q.entityId).value;}const value=q.generate();records.set(q.entityId,{key,value});return value;}};
const a=await saveWaterCandidate(store,parent,{factor:2},'fine',{downstreamBudgetsStatus:'provisional'});
const b=await saveWaterCandidate(store,parent,{factor:2},'fine',{downstreamBudgetsStatus:'provisional'});assert.equal(a,b);assert.ok(Math.abs(a.downstreamBudgetLedger[0].annualM3-10025)<1e-8);
await assert.rejects(()=>saveWaterCandidate(store,parent,{factor:4},'fine',{downstreamBudgetsStatus:'provisional'}),/conditions differ/);
console.log(JSON.stringify({exactInletAcrossStages:true,localGenerationNotDuplicated:true,stablePersistence:true,adoptedConditionsCannotChange:true,passed:true},null,2));
});

test('default solver preserves multiple imported inlet identities without ownership flag',()=>{
 const elevation=Array.from({length:25},(_,i)=>100-i);
 const inflows=[{id:'upstream-A',cell:0,supplyM3PerYear:10000},{id:'upstream-B',cell:4,supplyM3PerYear:2500}];
 const d=solveRegionalDrainage({columns:5,rows:5,cellSizeM:200,elevation,localSupplyM3PerYear:Array(25).fill(1),inflows,outlets:[{id:'downstream',cell:24,kind:'river',levelM:76}]});
 const p=createRegionalWaterContext({grid:d.grid,elevation,drainage:d});assert.deepEqual(p.supplyOwnership.inflows,inflows);
 const r=reconcileWaterCandidate(p,{factor:2},{downstreamBudgetsStatus:'provisional'});
 assert.deepEqual(r.context.supplyOwnership.inflows,[{id:'upstream-A',cell:0,supplyM3PerYear:10000},{id:'upstream-B',cell:8,supplyM3PerYear:2500}]);
 assert.ok(Math.abs(r.drainage.diagnostics.totalInputM3PerYear-12525)<1e-8);
 assert.ok(Math.abs(r.context.supplyOwnership.localSupplyM3PerYear.reduce((a,b)=>a+b,0)-25)<1e-10);
});
