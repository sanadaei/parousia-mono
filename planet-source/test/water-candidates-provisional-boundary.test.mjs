import test from 'node:test';
import assert from 'node:assert/strict';
import {solveRegionalDrainage} from '../src/core/regional-drainage.mjs';
import {createRegionalWaterContext} from '../src/core/regional-water-context.mjs';
import {refineWaterCandidate,reconcileWaterCandidate} from '../src/core/refine-water-candidates.mjs';
test('water-candidates-provisional-boundary',async()=>{
const z=Array.from({length:25},(_,i)=>Math.floor(i/5)+i%5);
const outlets=z.flatMap((levelM,cell)=>cell<5||cell>=20||cell%5===0||cell%5===4?[{id:`edge-${cell}`,cell,levelM,kind:'open-boundary'}]:[]);
const d=solveRegionalDrainage({columns:5,rows:5,cellSizeM:200,elevation:z,localSupplyM3PerYear:Array(25).fill(10),outlets});
const parent=createRegionalWaterContext({grid:d.grid,elevation:z,drainage:d});
const options={factor:2,method:'provisional-boundary',boundaryState:'provisional'};
const p=refineWaterCandidate(parent,options);assert.equal(p.drainage.outlets.length,32);assert.equal(p.reconciliation.boundaryTopologyChanged,true);assert.equal(p.context,null);
const r=reconcileWaterCandidate(parent,options,{downstreamBudgetsStatus:'provisional'});assert.ok(r.context);assert.equal(r.budgets.length,16);assert.ok(Math.abs(r.budgets.reduce((s,b)=>s+b.fineAnnualM3,0)-250)<1e-8);
for(const o of outlets){const actual=r.drainage.outlets.find(v=>v.id===o.id);assert.equal(actual.levelM,o.levelM);assert.equal(actual.cell,Math.floor(o.cell/5)*2*9+o.cell%5*2);}
assert.throws(()=>refineWaterCandidate(parent,{...options,boundaryState:'adopted'}),/explicitly provisional/);
assert.throws(()=>reconcileWaterCandidate(parent,options,{downstreamBudgetsStatus:'adopted'}),/unadopted/);
assert.throws(()=>reconcileWaterCandidate(parent,options,{downstreamBudgetsStatus:'provisional',adoptedOutletBudgets:[{id:outlets[0].id,annualM3:10}]}),/unadopted/);
const one=solveRegionalDrainage({columns:5,rows:5,cellSizeM:200,elevation:z,localSupplyM3PerYear:Array(25).fill(10),outlets:[outlets.at(-1)]});
const oneParent=createRegionalWaterContext({grid:one.grid,elevation:z,drainage:one});const oneResult=refineWaterCandidate(oneParent,options);
assert.ok(oneResult.diagnostics.addedProvisionalBoundaryOutlets>0);assert.equal(oneResult.context,null);assert.equal(oneResult.reconciliation.budgetChanged,false);
// Closed boundary cells do not acquire exits merely because they touch an edge.
assert.ok(oneResult.drainage.outlets.every(o=>o.cell===80||o.cell===79||o.cell===71));
console.log(JSON.stringify({aggregateBudgetsConserved:true,adoptedBoundaryRejected:true,closedBoundaryRespected:true,topologyOnlyProposalRequiresTransaction:true,passed:true},null,2));
});
