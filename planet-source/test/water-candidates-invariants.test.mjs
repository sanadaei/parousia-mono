import test from 'node:test';
import assert from 'node:assert/strict';
import {solveRegionalDrainage} from '../src/core/regional-drainage.mjs';
import {createRegionalWaterContext,regionalWaterWindow} from '../src/core/regional-water-context.mjs';
import {refineWaterCandidate,saveWaterCandidate,reconcileWaterCandidate} from '../src/core/refine-water-candidates.mjs';
test('water-candidates-invariants',async()=>{
let checked=0,changed=0,portsChecked=0;
for(let seed=1;seed<=12;seed++)for(const factor of [2,4,8]){
 const cw=5,w=(cw-1)*factor+1,n=w*w;
 const z=Array.from({length:n},(_,i)=>{const x=i%w/(w-1),y=Math.floor(i/w)/(w-1);return 100+40*Math.sin(x*5+seed*.2)*Math.sin(y*4)+20*x+Math.sin(i*17.13+seed)*3;});
 const coarse=Array.from({length:25},(_,i)=>z[Math.floor(i/5)*factor*w+i%5*factor]);
 const outlets=[0,4,20,24].map((cell,i)=>({id:`outlet-${i}`,cell,kind:'open-boundary',levelM:coarse[cell]}));
 const drainage=solveRegionalDrainage({columns:5,rows:5,cellSizeM:factor*100,cellSizeYM:factor*120,elevation:coarse,localSupplyM3PerYear:Array(25).fill(100),outlets});
 const parent=createRegionalWaterContext({sourceWorldId:'test-world',sourceLayerId:'parent',grid:drainage.grid,elevation:coarse,drainage});
 for(const method of ['terrain-joint','soft-divide']){
  const options={factor,elevation:z,method};const r=refineWaterCandidate(parent,options),d=r.drainage;
  assert.equal(r.id,refineWaterCandidate(parent,options).id);assert.deepEqual(r.candidateContext.elevation,z);
  assert.ok(d.diagnostics.relativeBudgetResidual<1e-12);assert.ok(Math.abs(d.diagnostics.totalInputM3PerYear-2500)<1e-8);
  assert.deepEqual(d.outlets.map(o=>o.id),outlets.map(o=>o.id));
  for(let i=0;i<n;i++){const j=d.receiver[i];if(j>=0)assert.ok(d.routingHeadM[j]<=d.routingHeadM[i]);let p=i,steps=0;while(d.receiver[p]>=0){p=d.receiver[p];assert.ok(++steps<=n);}assert.equal(p,d.outletCell[i]);}
  if(r.reconciliation.required){changed++;assert.equal(r.context,null);await assert.rejects(()=>saveWaterCandidate({},parent,options,'fine'),/Adopted downstream/);assert.throws(()=>refineWaterCandidate(parent,{...options,acceptBudgetReconciliation:'wrong'}),/exact proposal/);}
  const committed=refineWaterCandidate(parent,{...options,acceptBudgetReconciliation:r.reconciliation.proposalId});assert.ok(committed.context);assert.equal(committed.context.id,r.candidateContext.id);
  const extent=(w-1)*100,ey=(w-1)*120,split=extent*.473;
  const left=regionalWaterWindow(committed.context,{x0M:0,y0M:0,widthM:split,heightM:ey,cellSizeM:100});
  const right=regionalWaterWindow(committed.context,{x0M:split,y0M:0,widthM:extent-split,heightM:ey,cellSizeM:100});
  const a=left.ports.filter(p=>p.boundarySides.includes('east')).sort((a,b)=>a.id.localeCompare(b.id));
  const b=right.ports.filter(p=>p.boundarySides.includes('west')).sort((a,b)=>a.id.localeCompare(b.id));
  assert.equal(a.length,b.length);for(let i=0;i<a.length;i++){for(const key of ['id','xM','yM','annualFlowM3'])assert.equal(a[i][key],b[i][key]);assert.notEqual(a[i].direction,b[i].direction);portsChecked++;}
  const auto=reconcileWaterCandidate(parent,options,{downstreamBudgetsStatus:'provisional'});assert.equal(auto.context.id,committed.context.id);
  if(r.reconciliation.required)assert.throws(()=>reconcileWaterCandidate(parent,options,{downstreamBudgetsStatus:'adopted'}),/cannot change/);
  checked++;
 }
}
console.log(JSON.stringify({candidateCases:checked,changedBudgetProposalsBlocked:changed,pairedPortsChecked:portsChecked,passed:true},null,2));
});
