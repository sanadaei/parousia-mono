import {cutLocalWaterContext,analyzeGroundRouting} from './fine-local-layer.mjs';
import {fineDetailSurface} from './flow-aware-detail.mjs';
import {reconcileWaterCandidate} from '../../src/core/refine-water-candidates.mjs';
import {hashJson,copyJson} from '../../src/core/json-contract.mjs';
export const NEXT_LOCAL_VERSION='bounded-next-local-2x@1';
/** Predetermined exhaustive row-major rectangles; stop at the FIRST hydraulic
 * match. No height, relief, visual score, or refinement outcome enters selection. */
export function selectNextLocalDomain(parent,{intervalsX=36,intervalsY=26}={}){
 const g=parent.grid,trials=[];
 // Validate even when the quick graph screen finds no eligible rectangle.
 cutLocalWaterContext(parent,{x0:0,y0:0,intervalsX,intervalsY});
 for(let y0=0;y0+intervalsY<g.rows;y0++)for(let x0=0;x0+intervalsX<g.columns;x0++){
  const inside=j=>j>=0&&j%g.columns>=x0&&j%g.columns<=x0+intervalsX&&Math.floor(j/g.columns)>=y0&&Math.floor(j/g.columns)<=y0+intervalsY;
  let outgoing=0;
  for(let y=y0;y<=y0+intervalsY&&outgoing<2;y++)for(let x=x0;x<=x0+intervalsX&&outgoing<2;x++)if(!inside(parent.receiver[y*g.columns+x]))outgoing++;
  const bounds={x0,y0,intervalsX,intervalsY};
  if(outgoing!==1){trials.push({bounds,eligible:false,reason:'multiple-outlets',outgoingLowerBound:outgoing});continue;}
  const cut=cutLocalWaterContext(parent,bounds),eligible=!cut.reentries.length&&cut.budget.importAnnualM3>0&&cut.budget.localAnnualM3>0;
  trials.push({bounds,eligible,incoming:cut.incoming.length,outgoing:cut.outgoing.length,reentries:cut.reentries.length,budget:cut.budget});
  if(eligible)return {order:'all-aligned-rectangles-row-major@1',trials,bounds};
 }
 return {order:'all-aligned-rectangles-row-major@1',trials,bounds:null};
}
export function nextLocalOptions(bounds){return {bounds,nativeCellSizeM:27.5,stageCount:1,seed:'muna-atlas-next-local-002',detailMethod:'quarter-strength',downstreamBudgetsStatus:'adopted'};}
/** Topology-independent necessary condition only: no reroute can carry a dry
 * nonascending bed from a fixed inlet below the sole fixed outlet. A positive
 * head deficit may require backwater/storage or explicit parent revision; it
 * does not prove that a physically valid hydraulic solution exists. */
export function fixedEndpointFeasibility(context){
 if(!Array.isArray(context?.outlets)||context.outlets.length!==1)throw Error('Single outlet required for endpoint necessity');
 const z=context.elevation,validCell=i=>Number.isSafeInteger(i)&&i>=0&&i<z.length;
 if(!Array.isArray(z)||!z.length||!Array.from(z).every(Number.isFinite))throw Error('Finite endpoint elevations required');
 const outlet=context.outlets[0],outletGroundM=z[outlet.cell],requiredOutletLevelM=outlet.levelM;
 if(typeof outlet.id!=='string'||!outlet.id.length||!validCell(outlet.cell)||!Number.isFinite(requiredOutletLevelM)||requiredOutletLevelM<outletGroundM)throw Error('Valid fixed outlet ground and level required');
 const inflows=context.supplyOwnership?.inflows,ids=new Set();
 if(!Array.isArray(inflows))throw Error('Explicit inlet ownership required');
 for(const p of inflows){if(typeof p.id!=='string'||!p.id.length||ids.has(p.id)||!validCell(p.cell)||!Number.isFinite(p.supplyM3PerYear)||p.supplyM3PerYear<0)throw Error('Unique valid inlet identities, nodes and nonnegative finite volumes required');ids.add(p.id);}

 const positiveInflows=context.supplyOwnership.inflows.filter(p=>p.supplyM3PerYear>0);
 const violations=positiveInflows.map(p=>({id:p.id,cell:p.cell,annualM3:p.supplyM3PerYear,inletGroundM:context.elevation[p.cell],minimumGroundClimbM:Math.max(0,outletGroundM-context.elevation[p.cell]),minimumWaterHeadAboveInletGroundM:Math.max(0,requiredOutletLevelM-context.elevation[p.cell])})).filter(p=>p.minimumGroundClimbM>1e-9||p.minimumWaterHeadAboveInletGroundM>1e-9);
 const maxGroundClimbM=Math.max(0,...violations.map(p=>p.minimumGroundClimbM)),maxRequiredHeadM=Math.max(0,...violations.map(p=>p.minimumWaterHeadAboveInletGroundM));
 return {basis:'topology-independent-fixed-inlet-to-single-outlet-necessary-condition@1',outletId:outlet.id,outletGroundM,requiredOutletLevelM,positiveInflowCount:positiveInflows.length,violations,affectedSourceCount:violations.length,affectedNodeCount:new Set(violations.map(p=>p.cell)).size,affectedAnnualM3:violations.reduce((sum,p)=>sum+p.annualM3,0),physicalHydraulicFeasibility:'undetermined-no-inlet-water-stages-or-energy',monotoneBedEndpointNecessaryConditionPassed:maxGroundClimbM<=1e-9,monotoneGroundBedGate:maxGroundClimbM<=1e-9,maxUnavoidableGroundClimbM:maxGroundClimbM,maxRequiredWaterHeadAboveInletGroundM:maxRequiredHeadM,dryNonascendingImportedRiverImpossible:maxGroundClimbM>1e-9,classification:maxGroundClimbM>1e-9?'unresolved-adverse-bed-or-backwater':'endpoint-necessity-only-passes-not-a-river-certification',physicalRiverCertified:false};
}
/** Independent all-open D8 priority flood. This intentionally excludes imported
 * flow and inherited outlet constraints, matching the real-reference diagnostic. */
export function openBoundaryTerrainDiagnostic(context){
 const {columns:w,rows:h}=context?.grid??{},z=context?.elevation;
 if(!Number.isSafeInteger(w)||!Number.isSafeInteger(h)||w<3||h<3||w*h>65536||!Array.isArray(z)||z.length!==w*h||!Array.from(z).every(Number.isFinite))throw Error('Bounded valid grid and finite elevations required');
 const n=z.length,filled=[...z],seen=new Uint8Array(n),heap=[];
 const less=(a,b)=>a[0]<b[0]||(a[0]===b[0]&&a[1]<b[1]);
 const push=v=>{let i=heap.length;heap.push(v);while(i){const p=(i-1)>>1;if(!less(v,heap[p]))break;heap[i]=heap[p];i=p;}heap[i]=v;};
 const pop=()=>{const out=heap[0],v=heap.pop();if(heap.length){let i=0;while(i*2+1<heap.length){let c=i*2+1;if(c+1<heap.length&&less(heap[c+1],heap[c]))c++;if(!less(heap[c],v))break;heap[i]=heap[c];i=c;}heap[i]=v;}return out;};
 const dirs=[[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
 for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(x===0||y===0||x===w-1||y===h-1){const i=y*w+x;seen[i]=1;push([z[i],i]);}
 while(heap.length){const [v,i]=pop(),x=i%w,y=Math.floor(i/w);for(const [dy,dx] of dirs){const xx=x+dx,yy=y+dy,j=yy*w+xx;if(xx>=0&&xx<w&&yy>=0&&yy<h&&!seen[j]){seen[j]=1;filled[j]=Math.max(v,z[j]);push([filled[j],j]);}}}
 let maxFillM=0,positive=0,pits=0;for(let i=0;i<n;i++){const d=filled[i]-z[i];maxFillM=Math.max(maxFillM,d);if(d>1e-7)positive++;}
 for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++)if(!dirs.some(([dy,dx])=>z[(y+dy)*w+x+dx]<z[y*w+x]))pits++;
 return {basis:'all-open-D8-priority-flood@1',maxFillM,positiveFillFraction:positive/n,interiorNoLowerNeighborFraction:pits/((w-2)*(h-2))};
}
export function terrainRealismScreen(parent,child){
 const before=openBoundaryTerrainDiagnostic(parent),after=openBoundaryTerrainDiagnostic(child),regressions=[];
 for(const key of ['maxFillM','positiveFillFraction','interiorNoLowerNeighborFraction'])if(after[key]>before[key]+1e-9)regressions.push(key);
 return {parent:before,child:after,regressions,nonregression:regressions.length===0,realismCertified:false,status:regressions.length?'FAIL-new-artificial-pit-regression':'unproven-not-a-realism-certification',scope:'Same-domain open-boundary diagnostic; not inherited-boundary water routing; different resolutions explicitly retained'};
}
export function verifyNextLocalLayer(parent,result){
 const exact=(a,b,label)=>{if(hashJson(copyJson(a))!==hashJson(copyJson(b)))throw Error(label);};
 const cut=cutLocalWaterContext(parent,result.cut.bounds);exact(cut,result.cut,'Full parent graph relation changed');
 if(cut.reentries.length||cut.outgoing.length!==1||cut.budget.importAnnualM3<=0)throw Error('Ineligible crop');
 if(result.stages.length!==1)throw Error('Exactly one adjacent factor-two stage required');
 const child=result.context,stage=result.stages[0],g=cut.context.grid,cg=child.grid;
 if(cg.cellSizeM!==g.cellSizeM/2||cg.cellSizeYM!==g.cellSizeYM/2||cg.columns!==(g.columns-1)*2+1||cg.rows!==(g.rows-1)*2+1)throw Error('Physical parent-child spacing changed');
 const fi=i=>Math.floor(i/g.columns)*2*cg.columns+i%g.columns*2;
 for(let i=0;i<cut.context.elevation.length;i++)if(child.elevation[fi(i)]!==cut.context.elevation[i])throw Error('Parent anchor changed');
 exact(child.supplyOwnership.inflows,cut.context.supplyOwnership.inflows.map(p=>({...p,cell:fi(p.cell)})),'Imported source identity, quantity, or node changed');
 const p=cut.context.outlets[0],q=child.outlets[0];
 if(child.outlets.length!==1||q.id!==p.id||q.cell!==fi(p.cell)||q.levelM!==p.levelM)throw Error('Exact outlet changed');
 const ledger=result.downstreamEdgeLedger[0],relativeExportDelta=Math.abs(ledger.deltaAnnualM3)/Math.max(1,ledger.previousAnnualM3);
 if(relativeExportDelta>1e-9||ledger.id!==cut.outgoing[0].id||ledger.toParentCell!==cut.outgoing[0].toParentCell)throw Error('External ledger changed');
 if(!child.annualFlowM3.every(v=>Number.isFinite(v)&&v>=0)||!child.supplyOwnership.localSupplyM3PerYear.every(v=>Number.isFinite(v)&&v>=0))throw Error('Negative or invalid mass');
 const totalLocal=child.supplyOwnership.localSupplyM3PerYear.reduce((a,b)=>a+b,0);
 if(Math.abs(totalLocal-cut.budget.localAnnualM3)>1e-9*Math.max(1,totalLocal))throw Error('Local source mass changed');
 if(result.source.provenance.parentContextId!==cut.context.id||result.source.grid.cellSizeM>cg.cellSizeM||result.source.grid.cellSizeYM>cg.cellSizeYM||result.source.widthM!==(g.columns-1)*g.cellSizeM||result.source.heightM!==(g.rows-1)*g.cellSizeYM)throw Error('Native source support changed');
 const replay=fineDetailSurface(cut.context,result.source,{factor:2,detailMethod:'quarter-strength'});exact(replay,stage.surface,'Saved native-source replay changed');exact(stage.water.context,child,'Final context changed');
 const waterReplay=reconcileWaterCandidate(cut.context,{factor:2,elevation:replay.elevation,method:'soft-divide',softSlopeFraction:.15},{downstreamBudgetsStatus:'adopted'});exact(waterReplay,stage.water,'Saved water replay changed');
 if(!(replay.diagnostics.nonzeroDetailCells>0&&replay.diagnostics.rmsAddedHeightM>0))throw Error('No actual new detail');
 const [a,b]=result.windows;exact(a.elevation.slice(-a.grid.columns),b.elevation.slice(0,b.grid.columns),'Shared samples changed');
 const ports=a.ports.filter(p=>p.boundarySides.includes('south'));
 if(!ports.length||!ports.every(p=>b.ports.some(q=>q.id===p.id&&q.annualFlowM3===p.annualFlowM3&&q.direction!==p.direction&&q.parentProfileElevationM===p.parentProfileElevationM)))throw Error('Shared port mismatch');
 const interpolation=reconcileWaterCandidate(cut.context,{factor:2,method:'soft-divide',softSlopeFraction:.15},{downstreamBudgetsStatus:'adopted'});
 const routing={parentMinimum:analyzeGroundRouting(cut.context),interpolationMinimum:analyzeGroundRouting(interpolation.context),candidateMinimum:analyzeGroundRouting(child),interpolationSolver:analyzeGroundRouting(interpolation.context,interpolation.drainage.routingHeadM),candidateSolver:analyzeGroundRouting(child,stage.water.drainage.routingHeadM)};
 // Predeclared bounded acceptance: at most 0.5 m or 10% additional maximum
 // correction compared with both parent graph and equal-resolution baseline.
 const threshold=Math.min(routing.parentMinimum.maxRoutingCorrectionM,routing.interpolationMinimum.maxRoutingCorrectionM),allowanceM=Math.max(.5,.1*threshold);
 const correctionNonregression=routing.candidateMinimum.maxRoutingCorrectionM<=threshold+allowanceM;
 const feasibility=fixedEndpointFeasibility(cut.context),realism=terrainRealismScreen(cut.context,child),eligible=correctionNonregression&&!feasibility.dryNonascendingImportedRiverImpossible&&realism.nonregression;
 return {schema:NEXT_LOCAL_VERSION,contentHash:hashJson(copyJson(result)),parentContextId:parent.id,childContextId:child.id,grid:cg,physicalExtentM:{width:result.source.widthM,height:result.source.heightM},verification:{fullParentRelation:true,allAnchorsExact:true,importedSourcesExact:true,exactOutlet:true,externalDestinationsExact:true,relativeExportDelta,localMassPreserved:true,nonnegativeMass:true,sharedHeightsExact:true,sharedPorts:ports.length,nativeSourceReplayExact:true,waterReplayExact:true,newNativeSource:true},routing,upstreamFeasibility:fixedEndpointFeasibility(parent),feasibility,realism,detail:replay.diagnostics,adoption:{eligible,correctionNonregression,baselineMaximumCorrectionM:threshold,allowanceM,policy:'candidate minimum-head maximum <= min(parent, equal-resolution interpolation) + max(0.5m,10%)',status:feasibility.dryNonascendingImportedRiverImpossible?'experimental-only-fixed-endpoint-feasibility-blocked':eligible?'bounded-experimental-candidate':'rejected-do-not-adopt'},limits:['Generated shape prior, not measured finer terrain','Atomic experiment storage is not automatic renderer or global adoption','Routing head is not terrain excavation or a physical river certification']};
}
