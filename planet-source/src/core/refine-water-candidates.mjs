import {createRegionalWaterContext,regionalWaterWindow} from './regional-water-context.mjs';
import {solveRegionalDrainage} from './regional-drainage.mjs';
import {hashJson} from './json-contract.mjs';

/** Experimental jointly resolved refinement. Changed outlet allocations are
 * proposals, NEVER silently committed as inherited budgets. No rainfall is
 * fabricated to restore old budgets. Shared windows use a single committed
 * context; independently solved tiles are intentionally unsupported. */
export function refineWaterCandidate(parent,{factor=2,elevation=null,method='soft-divide',softSlopeFraction=.15,boundaryState='adopted',acceptBudgetReconciliation=null}={}){
 const g=parent?.grid;
 if(!g||!Number.isSafeInteger(factor)||factor<2||factor>8)throw Error('Trial factor must be 2 through 8');
 if(!['terrain-joint','soft-divide','provisional-boundary'].includes(method))throw Error('Unknown refinement method');
 const w=(g.columns-1)*factor+1,h=(g.rows-1)*factor+1,n=w*h,pn=g.columns*g.rows;
 if(n>65536)throw Error('Refinement exceeds joint-domain budget');
 regionalWaterWindow(parent,{x0M:0,y0M:0,widthM:(g.columns-1)*g.cellSizeM,heightM:(g.rows-1)*g.cellSizeYM,cellSizeM:Math.max(g.cellSizeM,g.cellSizeYM)});
 // Hash integrity is not semantic graph validation. Revalidate loaded parents.
 createRegionalWaterContext({sourceWorldId:parent.sourceWorldId,sourceLayerId:parent.sourceLayerId,geography:parent.geography,grid:g,elevation:parent.elevation,supplyOwnership:parent.supplyOwnership,drainage:{receiver:parent.receiver,routedSupplyM3PerYear:parent.annualFlowM3,outlets:parent.outlets,status:parent.status}});
 const sample=(x,y)=>{const px=x/factor,py=y/factor,ix=Math.min(g.columns-2,Math.floor(px)),iy=Math.min(g.rows-2,Math.floor(py)),u=px-ix,v=py-iy,i=iy*g.columns+ix,z=parent.elevation;return z[i]*(1-u)*(1-v)+z[i+1]*u*(1-v)+z[i+g.columns]*(1-u)*v+z[i+g.columns+1]*u*v;};
 const z=elevation??Array.from({length:n},(_,i)=>sample(i%w,Math.floor(i/w)));
 if(!Array.isArray(z)||z.length!==n||!z.every(v=>Number.isFinite(v)&&Math.abs(v)<1e7))throw Error('Bounded fine terrain required');
 for(let i=0;i<pn;i++)if(Math.abs(z[Math.floor(i/g.columns)*factor*w+(i%g.columns)*factor]-parent.elevation[i])>1e-7)throw Error('Fine terrain moved an adopted parent sample');
 const root=new Int32Array(pn).fill(-1),local=[...parent.annualFlowM3];
 for(let i=0;i<pn;i++)if(parent.receiver[i]>=0)local[parent.receiver[i]]-=parent.annualFlowM3[i];
 for(let i=0;i<pn;i++){
  if(local[i]< -1e-7*Math.max(1,parent.annualFlowM3[i]))throw Error('Inconsistent parent budget');
  local[i]=Math.max(0,local[i]);let j=i,path=[];
  while(root[j]<0&&parent.receiver[j]>=0){path.push(j);j=parent.receiver[j];}
  const end=root[j]>=0?root[j]:j;root[j]=end;for(const k of path)root[k]=end;
 }
 const fineIndex=p=>Math.floor(p/g.columns)*factor*w+p%g.columns*factor;
 const inheritedInflows=(parent.supplyOwnership?.inflows??[]).map(p=>({...p,cell:fineIndex(p.cell)}));
 if(parent.supplyOwnership){
  // Recovered source contains imported inflow. Remove it before redistributing
  // local generation; inject it once at the exact adopted inlet node below.
  for(const p of parent.supplyOwnership.inflows)local[p.cell]-=p.supplyM3PerYear;
  for(let i=0;i<pn;i++){
   const declared=parent.supplyOwnership.localSupplyM3PerYear[i];
   if(Math.abs(local[i]-declared)>1e-7*Math.max(1,parent.annualFlowM3[i]))throw Error('Parent source ownership disagrees with routed flow');
   local[i]=declared;
  }
 }
 const owner=new Int32Array(n),weight=new Float64Array(n),sum=new Float64Array(pn),preferred=Array(n);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const i=y*w+x,p=Math.round(y/factor)*g.columns+Math.round(x/factor);
  owner[i]=p;weight[i]=(x===0||x===w-1?.5:1)*(y===0||y===h-1?.5:1);sum[p]+=weight[i];preferred[i]=fineIndex(root[p]);
 }
 const supply=Array.from(owner,(p,i)=>local[p]*weight[i]/sum[p]);
 const outlets=parent.outlets.map(o=>({...o,inheritedOutletId:o.id,cell:fineIndex(o.cell),levelM:o.levelM}));
 if(method==='provisional-boundary'){
  if(boundaryState!=='provisional'||parent.status!=='partial-survey-routing-only')throw Error('Boundary refinement requires an explicitly provisional unresolved survey context');
  const parentAt=new Map(parent.outlets.filter(o=>o.kind==='open-boundary').map(o=>[o.cell,o])),occupied=new Set(outlets.map(o=>o.cell));
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
   if(x!==0&&x!==w-1&&y!==0&&y!==h-1)continue;
   const i=y*w+x;if(occupied.has(i))continue;
   const p=Math.round(y/factor)*g.columns+Math.round(x/factor),old=parentAt.get(p);
   // An absent or closed coarse boundary sample does not authorize an exit.
   // Boundary corridors partition the explicit unresolved coarse edge samples.
   if(!old)continue;
   outlets.push({id:`${old.id}/boundary/${x}/${y}`,inheritedOutletId:old.id,cell:i,kind:'open-boundary',levelM:z[i]});occupied.add(i);
  }
 }

 const drainage=solveRegionalDrainage({columns:w,rows:h,cellSizeM:g.cellSizeM/factor,cellSizeYM:g.cellSizeYM/factor,elevation:z,localSupplyM3PerYear:supply,outlets,inflows:inheritedInflows,retainSupplyOwnership:true,preferredOutletCell:method==='soft-divide'?preferred:null,softSlopeFraction:method==='soft-divide'?softSlopeFraction:0});
 if(!parent.supplyOwnership||parent.supplyOwnership.sourceClassification==='legacy-combined-source')drainage.supplyOwnership.sourceClassification='legacy-combined-source';
 if(parent.status==='partial-survey-routing-only')drainage.status=parent.status;
 const budgets=parent.outlets.map(o=>{const descendants=drainage.outlets.filter(p=>p.inheritedOutletId===o.id),before=parent.annualFlowM3[o.cell],after=descendants.reduce((s,p)=>s+p.supplyM3PerYear,0);return{id:o.id,parentCell:o.cell,fineCell:fineIndex(o.cell),fineCells:descendants.map(p=>p.cell),parentAnnualM3:before,fineAnnualM3:after,deltaAnnualM3:after-before,relativeResidual:Math.abs(after-before)/Math.max(1,before)};});
 const budgetChanged=budgets.some(b=>b.relativeResidual>1e-9),boundaryTopologyChanged=outlets.length!==parent.outlets.length,changed=budgetChanged||boundaryTopologyChanged;
 const candidateContext=createRegionalWaterContext({sourceWorldId:parent.sourceWorldId,sourceLayerId:parent.sourceLayerId,geography:parent.geography,grid:{columns:w,rows:h,cellSizeM:g.cellSizeM/factor,cellSizeYM:g.cellSizeYM/factor},elevation:z,drainage});
 const proposalId=hashJson({parentId:parent.id,contextId:candidateContext.id,method,factor,boundaryState,softSlopeFraction:method==='soft-divide'?softSlopeFraction:0,budgets});
 if(acceptBudgetReconciliation!==null&&acceptBudgetReconciliation!==proposalId)throw Error('Budget reconciliation does not match this exact proposal');
 const committed=!changed||acceptBudgetReconciliation===proposalId;
 const reconciliation={proposalId,required:changed,budgetChanged,boundaryTopologyChanged,status:committed?'reconciled':'pending',totalRedistributedAnnualM3:budgets.reduce((s,b)=>s+Math.abs(b.deltaAnnualM3),0)/2,budgets};
 return{schema:'joint-water-refinement-trial@1',id:proposalId,parentId:parent.id,method,factor,terrainMode:elevation?'supplied-parent-anchored-surface':'parent-interpolation',drainage,budgets,reconciliation,candidateContext,context:committed?candidateContext:null,diagnostics:{addedProvisionalBoundaryOutlets:outlets.length-parent.outlets.length,changedDestinationFraction:drainage.outletCell.filter((v,i)=>v!==preferred[i]).length/n,localSupplyTotalM3:supply.reduce((a,b)=>a+b,0)},limits:['Experimental trial; original production method unchanged','True fine DEM must retain exact adopted parent sample anchors',method==='provisional-boundary'?'Only explicit provisional open-boundary corridors acquire finer exit samples; budgets reconciled by inherited corridor ID':'Outlet identities and locations retained; changed budgets require exact proposal reconciliation before commit','No individual outlet budget repaired by inventing source supply','Soft preference only applies among nearly equivalent downhill routing-head edges','All adjacent views must use the same committed shared context','Routing head is not ground or a physical lake','Interpolation adds no measured fine terrain',parent.supplyOwnership&&parent.supplyOwnership.sourceClassification!=='legacy-combined-source'?'Explicit imported supply remains at exact inherited inlet nodes':'Legacy parent has no source ownership; recovered supply cannot distinguish local generation from imported inflow','Independent halo tiles are not certified by this trial']};
}

/** Internal transaction for a still-provisional shared domain. This is not a
 * user approval gate. Caller must own the downstream ledger in the same atomic
 * commit. Adopted allocations cannot be revised by this operation. */
export function reconcileWaterCandidate(parent,options,{downstreamBudgetsStatus='adopted',adoptedOutletBudgets=[]}={}){
 if(!['provisional','adopted'].includes(downstreamBudgetsStatus))throw Error('Explicit downstream budget state required');
 if(!Array.isArray(adoptedOutletBudgets)||!adoptedOutletBudgets.every(b=>b&&typeof b.id==='string'&&Number.isFinite(b.annualM3)&&b.annualM3>=0))throw Error('Invalid adopted outlet budget ledger');
 const ledgerIds=new Set();for(const b of adoptedOutletBudgets){if(ledgerIds.has(b.id)||!parent.outlets.some(o=>o.id===b.id))throw Error('Adopted ledger contains duplicate or unknown outlet identity');ledgerIds.add(b.id);}
 if(options?.method==='provisional-boundary'&&(downstreamBudgetsStatus!=='provisional'||adoptedOutletBudgets.length))throw Error('Refining provisional boundary corridors requires an entirely unadopted boundary ledger; retain hard ports or widen joint domain');
 const proposal=refineWaterCandidate(parent,{...options,acceptBudgetReconciliation:null});
 for(const b of proposal.budgets){
  const adopted=adoptedOutletBudgets.find(x=>x.id===b.id);
  if(adopted&&Math.abs(adopted.annualM3-b.fineAnnualM3)>1e-9*Math.max(1,adopted.annualM3))throw Error(`Adopted outlet ${b.id} conflicts: widen the uncommitted joint domain or retain the adopted solution`);
 }
 if(downstreamBudgetsStatus==='adopted'&&proposal.reconciliation.required)throw Error('Adopted downstream budgets cannot change: widen the uncommitted joint domain or retain the adopted solution');
 if(proposal.drainage.diagnostics.relativeBudgetResidual>1e-9)throw Error('Cannot reconcile nonconservative proposal');
 const netChange=proposal.budgets.reduce((s,b)=>s+b.deltaAnnualM3,0),total=proposal.drainage.diagnostics.totalInputM3PerYear;
 if(Math.abs(netChange)>1e-9*Math.max(1,total))throw Error('Budget revision invents supply');
 const result=refineWaterCandidate(parent,{...options,acceptBudgetReconciliation:proposal.reconciliation.proposalId});
 return{...result,reconciliation:{...result.reconciliation,downstreamBudgetsStatus,netChangeAnnualM3:netChange},downstreamBudgetLedger:result.budgets.map(b=>({id:b.id,annualM3:b.fineAnnualM3,previousAnnualM3:b.parentAnnualM3,deltaAnnualM3:b.deltaAnnualM3}))};
}

export async function saveWaterCandidate(store,parent,options,entityId,budgetTransaction={}){
 if(!parent.sourceWorldId)throw Error('Persistence requires world identity');
 // Context and complete revised downstream ledger are ONE immutable record.
 const result=reconcileWaterCandidate(parent,options,budgetTransaction);
 return store.resolve({worldId:parent.sourceWorldId,entityId,conditions:{parentId:parent.id,options:options??{},budgetTransaction,proposalId:result.id},generator:'joint-water-refinement-trial@1',generate:()=>result});
}
