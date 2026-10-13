import {hashJson} from '../../src/core/json-contract.mjs';
import {solveRegionalDrainage} from '../../src/core/regional-drainage.mjs';
import {createRegionalWaterContext,regionalWaterWindow} from '../../src/core/regional-water-context.mjs';
import {reconcileWaterCandidate} from '../../src/core/refine-water-candidates.mjs';
import {generateLandformCandidate} from './conditional-landform-candidate.mjs';
import {fixedDetailSource,anchoredGeneratedSurface,sampleMetric} from './anchored-regional-surface.mjs';
export const BROAD_BRIDGE_VERSION='bounded-broad-local-bridge@1';
/** A physical 3x3 L1 lattice, never an arbitrary local-size stretch of L1.
 * All outer exits are survey hypotheses. External L1 water remains explicit
 * provenance, not silently treated as zero or injected at an invented port. */
export function createBroadBridgeParent(l1,{centerColumn,centerRow}={}){
 const s=l1?.snapshot,c=l1?.climate,w=s?.grid?.columns,h=s?.grid?.rows,n=w*h;
 if(!s||!c||l1.schema!=='l1-broad-region@1'||!Number.isInteger(w)||!Number.isInteger(h)||n>131072||!Number.isFinite(s.frame?.radiusM)||s.frame.radiusM<=0||!Number.isInteger(centerColumn)||centerColumn<0||centerColumn>=w||!Number.isInteger(centerRow)||centerRow<1||centerRow>=h-1)throw Error('Bounded L1 and an interior lattice center required');
 for(const a of [s.fields.groundElevationM,s.fields.downstream,c.annualMeanTemperatureC,c.annualPrecipitationMm,c.catchmentWater?.annualLocalYieldMm,c.catchmentWater?.annualRoutedYieldM3])if(!Array.isArray(a)||a.length!==n||!a.every(Number.isFinite))throw Error('Complete L1 terrain, climate and water provenance required');
 if(l1.sourceWorldId!==s.worldId||!s.fields.downstream.every((j,i)=>Number.isSafeInteger(j)&&j>=-1&&j<n&&j!==i)||!c.catchmentWater.annualLocalYieldMm.every(v=>v>=0)||!c.catchmentWater.annualRoutedYieldM3.every(v=>v>=0))throw Error('Consistent world, drainage and nonnegative climate supply required');
 const latDeg=90-(centerRow+.5)*180/h,lonDeg=(centerColumn+.5)*360/w;
 if(Math.abs(latDeg)>55)throw Error('Local tangent approximation is bounded to latitude 55 degrees');
 const dy=s.frame.radiusM*Math.PI/h,dx=s.frame.radiusM*2*Math.PI/w*Math.cos(latDeg*Math.PI/180),cells=[];
 for(let y=-1;y<=1;y++)for(let x=-1;x<=1;x++)cells.push((centerRow+y)*w+(centerColumn+x+w)%w);
 const index=new Map(cells.map((p,i)=>[p,i])),crossings=[];
 const endpoint=p=>({cell:p,latDeg:90-(Math.floor(p/w)+.5)*180/h,lonDeg:(p%w+.5)*360/w,elevationM:s.fields.groundElevationM[p]});
 for(let i=0;i<n;i++){const j=s.fields.downstream[i];if(j<0)continue;if(index.has(i)!==index.has(j))crossings.push({parentEdgeId:`${l1.id}/edge/${i}/${j}`,fromCell:i,toCell:j,from:endpoint(i),to:endpoint(j),direction:index.has(j)?'in':'out',boundaryAnchor:index.get(index.has(j)?j:i),annualPotentialM3:c.catchmentWater.annualRoutedYieldM3[i],status:'unadopted-coarse-crossing'});}
 const elevation=cells.map(p=>s.fields.groundElevationM[p]),localSupply=cells.map((p,i)=>c.catchmentWater.annualLocalYieldMm[p]/1000*dx*dy*(i%3===1?1:.5)*(Math.floor(i/3)===1?1:.5));
 const outlets=elevation.flatMap((z,i)=>i===4?[]:[{id:`broad-survey:${l1.id}:${cells[i]}`,cell:i,kind:'open-boundary',levelM:z}]);
 const drainage=solveRegionalDrainage({columns:3,rows:3,cellSizeM:dx,cellSizeYM:dy,elevation,localSupplyM3PerYear:localSupply,outlets,retainSupplyOwnership:true});
 const climate={sourceClimateId:c.id,sourceCells:cells,annualMeanTemperatureC:cells.map(p=>c.annualMeanTemperatureC[p]),annualPrecipitationMm:cells.map(p=>c.annualPrecipitationMm[p]),annualLocalYieldMm:cells.map(p=>c.catchmentWater.annualLocalYieldMm[p])};
 const context=createRegionalWaterContext({sourceWorldId:s.worldId,sourceLayerId:l1.id,geography:{latDeg,lonDeg,projection:'local-tangent-at-L1-center',sourceGrid:{columns:w,rows:h},radiusM:s.frame.radiusM,parentCells:cells,externalWaterStatus:'coarse-crossings-not-adopted',externalCrossings:crossings},grid:{columns:3,rows:3,cellSizeM:dx,cellSizeYM:dy},elevation,drainage});
 return {context,climate,crossings,drainage};
}
/** Preflight occurs before invoking the candidate generator. */
export function planBroadBridge(parent,{factors=[2,2,2,2,2,2],nativeCellSizeM=null}={}){
 if(!Array.isArray(factors)||!factors.length||factors.length>8||factors.some(f=>f!==2))throw Error('Broad bridge requires bounded explicit factor-two stages');
 const g=parent.grid,product=2**factors.length,native=nativeCellSizeM??Math.min(1000,g.cellSizeM/product,g.cellSizeYM/product),widthM=(g.columns-1)*g.cellSizeM,heightM=(g.rows-1)*g.cellSizeYM;
 if(!Number.isFinite(native)||native<10||native>1000)throw Error('Candidate native spacing must be 10..1000 m');
 const columns=Math.max(24,Math.ceil(widthM/native)+1),rows=Math.max(24,Math.ceil(heightM/native)+1);
 if(columns*rows>32768)throw Error('Broad native source exceeds bounded 32768-cell budget');
 let grid={...g};const stages=factors.map(factor=>{grid={columns:(grid.columns-1)*2+1,rows:(grid.rows-1)*2+1,cellSizeM:grid.cellSizeM/2,cellSizeYM:grid.cellSizeYM/2};if(grid.columns*grid.rows>65536||Math.min(grid.cellSizeM,grid.cellSizeYM)<native-1e-8)throw Error('Stage exceeds budget or native terrain evidence');return {factor,grid:{...grid}};});
 return {nativeCellSizeM:native,columns,rows,widthM,heightM,stages};
}
export function buildBroadLocalBridge(l1,{centerColumn,centerRow,seed='muna-atlas-001',factors=[2,2,2,2,2,2],nativeCellSizeM=null,envelope={maxAddedSlopeMPerM:.14,maxDetailReliefM:300},generateCandidate=generateLandformCandidate}={}){
 const parent=createBroadBridgeParent(l1,{centerColumn,centerRow}),plan=planBroadBridge(parent.context,{factors,nativeCellSizeM});
 const raw=generateCandidate({seed,columns:plan.columns,rows:plan.rows,cellSizeM:plan.nativeCellSizeM});
 const source=fixedDetailSource({grid:raw.grid,elevation:raw.elevation,widthM:plan.widthM,heightM:plan.heightM,provenance:{generator:'conditional-landform-candidate@1',seed,sourceLayerId:l1.id,status:'bounded-shape-prior-not-independent-world'}});
 let context=parent.context;const stages=[];
 for(const {factor} of plan.stages){const surface=anchoredGeneratedSurface(context,source,{factor,...envelope});const water=reconcileWaterCandidate(context,{factor,elevation:surface.elevation,method:'provisional-boundary',boundaryState:'provisional'},{downstreamBudgetsStatus:'provisional',adoptedOutletBudgets:[]});context=water.context;
  const climate={sourceClimateId:parent.climate.sourceClimateId,projection:'bilinear inherited L1 climate; temperature adjusted for added relief only'};
  for(const field of ['annualMeanTemperatureC','annualPrecipitationMm','annualLocalYieldMm'])climate[field]=context.elevation.map((z,i)=>{const x=i%context.grid.columns*context.grid.cellSizeM,y=Math.floor(i/context.grid.columns)*context.grid.cellSizeYM;const v=sampleMetric(parent.context.grid,parent.climate[field],x,y);return field==='annualMeanTemperatureC'?v-.0065*(z-sampleMetric(parent.context.grid,parent.context.elevation,x,y)):v;});
  stages.push({surface,water,climate});
 }
 const body={schema:BROAD_BRIDGE_VERSION,sourceWorldId:l1.sourceWorldId,sourceLayerId:l1.id,parent,plan,source,stages,context,status:'provisional-broad-survey-ready-for-local-crop',limits:['External L1 crossing flows are retained as unadopted provenance, not included in the local-only water budget','No claim of global hydraulic continuity; actual inlet/outlet reconciliation is required before adoption','Coarse climate projected, not regenerated; potential yield is not hydraulic discharge','Tangent-plane metric approximation; no whole-world fine terrain','Terrain prior is not scale-independent geological calibration','Local crop is a view only; new local detail needs its own bounded native source and explicit imported-flow ownership']};
 return {...body,id:hashJson(body)};
}
/** Preserves the source context and edge provenance; does not relabel a crop as
 * independently closed water. Further local generation must consume both. */
export function broadLocalCrop(bridge,{widthM=12000,heightM=12000,x0M=(bridge.plan.widthM-widthM)/2,y0M=(bridge.plan.heightM-heightM)/2,cellSizeM=Math.min(bridge.context.grid.cellSizeM,bridge.context.grid.cellSizeYM)}={}){
 const window=regionalWaterWindow(bridge.context,{x0M,y0M,widthM,heightM,cellSizeM});
 return {schema:'broad-local-crop-source@1',bridgeId:bridge.id,sourceContextId:bridge.context.id,sourceContext:bridge.context,window,externalCrossings:bridge.parent.crossings,status:'inherited-view-not-new-local-terrain'};
}

/** Save every stage, source and reconciled ledger together. Revisiting is read-only. */
export async function saveBroadLocalBridge(store,l1,options,entityId='broad-local-bridge'){
 if(options?.generateCandidate)throw Error('Persisted bridge requires the versioned accepted generator');
 const parent=createBroadBridgeParent(l1,options),plan=planBroadBridge(parent.context,options);
 return store.resolve({worldId:l1.sourceWorldId,entityId,conditions:{sourceLayerId:l1.id,parentContextId:parent.context.id,parentClimate:parent.climate,options:options??{},plan,version:BROAD_BRIDGE_VERSION,waterMethod:'provisional-boundary; joint-water-refinement-trial@1'},generator:BROAD_BRIDGE_VERSION,generate:()=>buildBroadLocalBridge(l1,options)});
}
