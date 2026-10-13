import fs from 'node:fs';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {refineWaterCandidate} from './src/candidate/refine-water-candidates.mjs';
import {solveRegionalDrainage} from './src/core/regional-drainage.mjs';
const input=JSON.parse(fs.readFileSync(new URL('./data/inputs.json',import.meta.url))),results=[];
for(const crop of input.crops)for(const factor of input.factors){
 const data=JSON.parse(fs.readFileSync(new URL(`./results/case-${crop.name}-f${factor}.json`,import.meta.url))),g=crop.grid,z=crop.elevation,w=g.columns;
 const allEdges=z.flatMap((levelM,i)=>i<w||i>=w*(w-1)||i%w===0||i%w===w-1?[{id:`fine:${i}`,cell:i,kind:'open-boundary',levelM}]:[]);
 const truth=solveRegionalDrainage({...g,elevation:z,localSupplyM3PerYear:data.localSupplyM3PerYear,outlets:allEdges});
 const t=performance.now(),r=refineWaterCandidate(data.parent,{factor,elevation:z,method:'provisional-boundary',boundaryState:'provisional'}),elapsed=performance.now()-t,d=r.drainage;
 assert.deepEqual(d.receiver,truth.receiver);assert.deepEqual(d.routingFillM,truth.routingFillM);assert.deepEqual(d.outletCell,truth.outletCell);
 assert(d.routedSupplyM3PerYear.every((v,i)=>Math.abs(v-truth.routedSupplyM3PerYear[i])<=1e-6));
 assert.equal(d.outlets.length,4*(w-1));assert.equal(r.context,null);assert(r.reconciliation.required);
 const ids=Array.from({length:w*w},(_,i)=>i).filter(i=>i%w>=4&&i%w<w-4&&Math.floor(i/w)>=4&&Math.floor(i/w)<w-4);
 const sparse=data.reference;results.push({crop:crop.name,factor,timeMs:elapsed,addedExitSamples:r.diagnostics.addedProvisionalBoundaryOutlets,allFineEdgeSamples:d.outlets.length,interiorCells:ids.length,provisionalVsFineOpenReceiverAgreement:1,provisionalVsFineOpenDestinationAgreement:1,provisionalVsFineOpenMaxAddedHeadM:0,sparseVsFineOpenMaxAddedHeadM:Math.max(...ids.map(i=>sparse.routingFillM[i]-truth.routingFillM[i])),sparseVsFineOpenDestinationAgreement:ids.filter(i=>sparse.outletCell[i]===truth.outletCell[i]).length/ids.length,corridorBudgetRedistributionFraction:r.reconciliation.totalRedistributedAnnualM3/d.diagnostics.totalInputM3PerYear,requiresBudgetReconciliation:r.reconciliation.required,contextCommitted:r.context!==null,globalBudgetResidual:d.diagnostics.relativeBudgetResidual});
}
fs.writeFileSync(new URL('./results/provisional-boundary.json',import.meta.url),JSON.stringify({schema:'provisional-boundary-scale-test@1',method:'Coarse open-boundary exits explicitly provisional; add fine boundary samples tied to nearest open parent corridor IDs. Compare actual fine DEM against every fine boundary node open, same source supply.',limits:['Agreement with all-open reference is by construction when every coarse boundary node is open; this verifies obstruction removal, not physical boundary truth.','New fine endpoints are not allowed for adopted/hard receiving ports.','Still unresolved external water context; must widen domain or provide real downstream constraints.','Changed parent-corridor volume budgets remain pending and candidate is not committed.'],results},null,2));console.log(JSON.stringify(results.map(r=>({crop:r.crop,factor:r.factor,removedHeadM:r.sparseVsFineOpenMaxAddedHeadM,redistributed:r.corridorBudgetRedistributionFraction})),null,2));
