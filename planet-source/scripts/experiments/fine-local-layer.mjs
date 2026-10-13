import {fineDetailSurface,DETAIL_METHOD_VERSION} from './flow-aware-detail.mjs';
import {createRegionalWaterContext,regionalWaterWindow} from '../../src/core/regional-water-context.mjs';
import {reconcileWaterCandidate} from '../../src/core/refine-water-candidates.mjs';
import {hashJson,copyJson} from '../../src/core/json-contract.mjs';
import {generateLandformCandidate} from './conditional-landform-candidate.mjs';
import {fixedDetailSource} from './anchored-regional-surface.mjs';
export const DEFAULT_FINE_DETAIL_METHOD='quarter-strength';
export const FINE_LOCAL_VERSION='graph-cut-fine-local-layer@1';
/** Exact induced parent graph: every incoming edge is a separate owned source,
 * every outgoing edge retains its external destination. No re-solve at crop. */
export function cutLocalWaterContext(parent,{x0,y0,intervalsX=10,intervalsY=8}={}){
 const checked=createRegionalWaterContext({sourceWorldId:parent.sourceWorldId,sourceLayerId:parent.sourceLayerId,geography:parent.geography,grid:parent.grid,elevation:parent.elevation,supplyOwnership:parent.supplyOwnership,drainage:{receiver:parent.receiver,routedSupplyM3PerYear:parent.annualFlowM3,outlets:parent.outlets,status:parent.status}});
 if(checked.id!==parent.id)throw Error('Parent context identity changed');
 const g=parent.grid,w=intervalsX+1,h=intervalsY+1;
 if(![x0,y0,intervalsX,intervalsY].every(Number.isSafeInteger)||x0<0||y0<0||intervalsX<2||intervalsY<2||x0+intervalsX>=g.columns||y0+intervalsY>=g.rows||w*h>65536||!parent.supplyOwnership||parent.supplyOwnership.sourceClassification==='legacy-combined-source')throw Error('Grid-aligned bounded crop with explicit parent source ownership required');
 const cells=Array.from({length:w*h},(_,i)=>(y0+Math.floor(i/w))*g.columns+x0+i%w),index=new Map(cells.map((p,i)=>[p,i]));
 const incoming=[],outgoing=[],receiver=cells.map(p=>index.get(parent.receiver[p])??-1),inflows=parent.supplyOwnership.inflows.filter(p=>index.has(p.cell)).map(p=>({...p,cell:index.get(p.cell)}));
 for(let i=0;i<parent.receiver.length;i++){
  const j=parent.receiver[i];if(j<0||index.has(i)===index.has(j))continue;
  const edgeId=`${parent.id}/edge/${i}/${j}`,record={id:edgeId,fromParentCell:i,toParentCell:j,annualM3:parent.annualFlowM3[i],fromNodeId:`${parent.id}/node/${i}`,toNodeId:`${parent.id}/node/${j}`};
  if(index.has(j)){const cell=index.get(j);incoming.push({...record,cell});inflows.push({id:edgeId,cell,supplyM3PerYear:record.annualM3,parentEdgeId:edgeId,externalSourceNodeId:record.fromNodeId});}
  else outgoing.push({...record,cell:index.get(i),kind:'cut-edge'});
 }
 for(const o of parent.outlets)if(index.has(o.cell))outgoing.push({id:o.id,cell:index.get(o.cell),fromParentCell:o.cell,toParentCell:null,annualM3:parent.annualFlowM3[o.cell],kind:'inherited-root',outlet:o});
 const reentries=[];
 for(const edge of outgoing){let j=edge.toParentCell;const path=[];while(j!==null&&j>=0&&!index.has(j)){path.push(j);j=parent.receiver[j];}if(j!==null&&j>=0)reentries.push({outgoingEdgeId:edge.id,reentryParentCell:j,reentryLocalCell:index.get(j),outsidePath:path});}
 const elevation=cells.map(p=>parent.elevation[p]),outlets=outgoing.map(o=>({...o.outlet,id:o.id,cell:o.cell,kind:o.outlet?.kind??'river',levelM:Math.max(elevation[o.cell],o.outlet?.levelM??elevation[o.cell]),supplyM3PerYear:o.annualM3}));
 const localSupplyM3PerYear=cells.map(p=>parent.supplyOwnership.localSupplyM3PerYear[p]);
 const context=createRegionalWaterContext({sourceWorldId:parent.sourceWorldId,sourceLayerId:parent.sourceLayerId,geography:{...parent.geography,parentContextId:parent.id,gridOrigin:{x0,y0},waterScope:'exact-parent-graph-cut; upstream-adoption-status-inherited'},grid:{columns:w,rows:h,cellSizeM:g.cellSizeM,cellSizeYM:g.cellSizeYM},elevation,supplyOwnership:{localSupplyM3PerYear,inflows,sourceClassification:'explicit-local-and-imported'},drainage:{receiver,routedSupplyM3PerYear:cells.map(p=>parent.annualFlowM3[p]),outlets,status:parent.status}});
 const budget={localAnnualM3:localSupplyM3PerYear.reduce((a,b)=>a+b,0),importAnnualM3:inflows.reduce((a,b)=>a+b.supplyM3PerYear,0),exportAnnualM3:outgoing.reduce((a,b)=>a+b.annualM3,0)};
 budget.residualAnnualM3=budget.localAnnualM3+budget.importAnnualM3-budget.exportAnnualM3;
 if(Math.abs(budget.residualAnnualM3)>1e-9*Math.max(1,budget.exportAnnualM3))throw Error('Parent cut budget does not close');
 return {schema:'exact-parent-water-cut@1',parentContextId:parent.id,bounds:{x0,y0,intervalsX,intervalsY},parentCells:cells,incoming,outgoing,reentries,budget,context};
}
export function createFineLocalSource(parent,{nativeCellSizeM=55,seed='muna-atlas-fine-local-001',generateCandidate=generateLandformCandidate}={}){
 const g=parent.grid,widthM=(g.columns-1)*g.cellSizeM,heightM=(g.rows-1)*g.cellSizeYM,columns=Math.max(24,Math.ceil(widthM/nativeCellSizeM)+1),rows=Math.max(24,Math.ceil(heightM/nativeCellSizeM)+1);
 if(!Number.isFinite(nativeCellSizeM)||nativeCellSizeM<10||columns*rows>32768)throw Error('Fine source exceeds native-spacing or 32768-cell budget');
 const raw=generateCandidate({seed,columns,rows,cellSizeM:nativeCellSizeM});
 return fixedDetailSource({grid:raw.grid,elevation:raw.elevation,widthM,heightM,provenance:{generator:'conditional-landform-candidate@1',seed,parentContextId:parent.id,nativeCellSizeM,status:'generated-shape-prior-not-measured-DEM'}});
}
export function buildFineLocalLayer(parent,{bounds,nativeCellSizeM=55,seed='muna-atlas-fine-local-001',stageCount=4,detailMethod=DEFAULT_FINE_DETAIL_METHOD,downstreamBudgetsStatus='adopted',adoptedOutletBudgets=[],generateCandidate=generateLandformCandidate}={}){
 const cut=cutLocalWaterContext(parent,bounds);
 if(cut.reentries.length)throw Error('Crop outflow reenters: widen the uncommitted joint halo or select a different bounded domain');
 if(!Number.isSafeInteger(stageCount)||stageCount<1||stageCount>5)throw Error('Bounded factor-two stage count required');
 const last=2**stageCount,g=cut.context.grid;
 if(Math.min(g.cellSizeM,g.cellSizeYM)/last<nativeCellSizeM-1e-9||((g.columns-1)*last+1)*((g.rows-1)*last+1)>65536)throw Error('Final stage exceeds native source floor or context budget');
 const source=createFineLocalSource(cut.context,{nativeCellSizeM,seed,generateCandidate});
 let context=cut.context;const stages=[];
 for(let i=0;i<stageCount;i++){
  const surface=fineDetailSurface(context,source,{factor:2,detailMethod});
  const water=reconcileWaterCandidate(context,{factor:2,elevation:surface.elevation,method:'soft-divide',softSlopeFraction:.15},{downstreamBudgetsStatus,adoptedOutletBudgets});
  stages.push({surface,water});context=water.context;
 }
 const downstreamEdgeLedger=cut.outgoing.map(o=>{const p=context.outlets.find(p=>p.id===o.id);return {...o,finalCell:p.cell,annualM3:context.annualFlowM3[p.cell],previousAnnualM3:o.annualM3,deltaAnnualM3:context.annualFlowM3[p.cell]-o.annualM3,status:downstreamBudgetsStatus==='adopted'?'adopted-unchanged':'provisional-external-destination-revision'};});
 const widthM=source.widthM,heightM=source.heightM,seam=heightM*.4875,spacing=Math.min(context.grid.cellSizeM,context.grid.cellSizeYM);
 const windows=[regionalWaterWindow(context,{x0M:0,y0M:0,widthM,heightM:seam,cellSizeM:spacing}),regionalWaterWindow(context,{x0M:0,y0M:seam,widthM,heightM:heightM-seam,cellSizeM:spacing})];
 const body={schema:FINE_LOCAL_VERSION,detailMethod:{name:detailMethod,version:DETAIL_METHOD_VERSION},parentContextId:parent.id,cut,source,stages,context,downstreamEdgeLedger,windows,status:downstreamBudgetsStatus==='adopted'?'adopted-boundary-preserving-detail':'provisional-joint-local-candidate',limits:['Every parent crossing edge is retained; imported inflows remain exact node sources through all stages','Provisional outgoing deltas are explicit proposed external-destination revisions; unchanged broad parent is not claimed to have adopted them','Upstream global linkage retains its own adoption status; this local record does not establish global hydraulic closure','Generated 55m/60m morphology is a bounded shape prior, not measured local terrain','Shared windows certify one context only; independent neighboring context adoption is not certified','Point anchors retained; parent cell means and sediment volume are not conserved']};
 return {...body,id:hashJson(copyJson(body))};
}
export async function saveFineLocalLayer(store,parent,options,entityId='fine-local-layer'){
 if(options?.generateCandidate)throw Error('Persisted detail requires accepted versioned generator');
 // Atomic core contains source, all stages and downstream ledger (under16MiB).
 // Large render windows are deterministic views, not generation commitments.
 const record=await store.resolve({worldId:parent.sourceWorldId,entityId,conditions:{parentContextId:parent.id,options,detailMethod:{name:options?.detailMethod??DEFAULT_FINE_DETAIL_METHOD,version:DETAIL_METHOD_VERSION},version:FINE_LOCAL_VERSION,storage:'atomic-core-derived-windows@1'},generator:FINE_LOCAL_VERSION,generate:()=>{const result=buildFineLocalLayer(parent,options),{windows,...core}=result;return {schema:'fine-local-core-record@1',core,windowSettings:windows.map(w=>w.settings),fullContentHash:hashJson(copyJson(result))};}});
 const result={...record.core,windows:record.windowSettings.map(settings=>regionalWaterWindow(record.core.context,settings))};
 if(hashJson(copyJson(result))!==record.fullContentHash)throw Error('Saved fine layer derived views changed');
 return result;
}
/** Minimum nonascending routing head along the actual adopted graph. This is a
 * lower bound on a routing correction, never an excavated bed or lake surface. */
export function analyzeGroundRouting(context,routingHeadM=null){
 const n=context.elevation.length,head=routingHeadM?[...routingHeadM]:Array(n).fill(null),outlets=new Map(context.outlets.map(o=>[o.cell,o.levelM]));
 if(!routingHeadM)for(let i=0;i<n;i++){if(head[i]!==null)continue;let j=i;const path=[];while(j>=0&&head[j]===null){path.push(j);j=context.receiver[j];}let level=j>=0?head[j]:-Infinity;for(let k=path.length-1;k>=0;k--){const p=path[k];level=Math.max(level,context.elevation[p],outlets.get(p)??-Infinity);head[p]=level;}}
 const fills=head.map((v,i)=>Math.max(0,v-context.elevation[i])).sort((a,b)=>a-b),imported=new Set();
 for(const inlet of context.supplyOwnership.inflows)if(inlet.supplyM3PerYear>0){let i=inlet.cell;while(i>=0&&!imported.has(i)){imported.add(i);i=context.receiver[i];}}
 const maxFlow=Math.max(...context.annualFlowM3),edges=[];for(let i=0;i<n;i++)if(context.receiver[i]>=0)edges.push(i);
 const stats=ids=>{let uphill=0,maxRiseM=0;for(const i of ids){const rise=context.elevation[context.receiver[i]]-context.elevation[i];if(rise>1e-7)uphill++;maxRiseM=Math.max(maxRiseM,rise);}return {edges:ids.length,uphillEdges:uphill,uphillFraction:ids.length?uphill/ids.length:0,maxGroundRiseM:maxRiseM};};
 return {headBasis:routingHeadM?'solver-routing-head':'minimum-head-along-preserved-parent-graph',maxRoutingCorrectionM:fills.at(-1),p95RoutingCorrectionM:fills[Math.floor((fills.length-1)*.95)],positiveCorrectionFraction:fills.filter(v=>v>1e-7).length/n,importedFlowPaths:stats(edges.filter(i=>imported.has(i))),mainChannel:stats(edges.filter(i=>context.annualFlowM3[i]>=.01*maxFlow&&context.annualFlowM3[i]>0)),mainChannelThresholdAnnualM3:.01*maxFlow,physicalRiverCertified:false};
}
