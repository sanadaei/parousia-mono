import {generateSharedDetailSource,anchoredGeneratedSurface,SURFACE_VERSION} from './anchored-regional-surface.mjs';
import {saveRegionalWaterWindow} from '../../src/core/regional-water-context.mjs';
export const HANDOFF_VERSION='generated-layer-handoff@1';
export function planRefinementStages(parent,{factors=[2,2],nativeCellSizeM=120,nativeCellSizeYM=nativeCellSizeM}={}){
 if(!Array.isArray(factors)||!factors.length||factors.length>8||factors.some(f=>![2,4].includes(f)))throw Error('Explicit bounded sequence of factor 2 or 4 stages required');
 let g={...parent.grid,cellSizeYM:parent.grid.cellSizeYM??parent.grid.cellSizeM};
 return factors.map(factor=>{g={columns:(g.columns-1)*factor+1,rows:(g.rows-1)*factor+1,cellSizeM:g.cellSizeM/factor,cellSizeYM:g.cellSizeYM/factor};if(g.columns*g.rows>65536)throw Error('Stage exceeds shared context budget');if(g.cellSizeM<nativeCellSizeM-1e-9||g.cellSizeYM<nativeCellSizeYM-1e-9)throw Error('Stage exceeds native detail evidence');return {factor,grid:{...g}};});
}
export async function buildSavedLayerHandoff(store,parent,{entityId='shared-L2',factors=[2,2],sourceOptions={},detailSource=null,envelope={},windows=[],refineWater=null,waterMethod=null,waterOptions={}}={}){
 if(typeof refineWater!=='function'||typeof waterMethod!=='string'||!waterMethod)throw Error('Explicit water refinement function and version required');
 if(!parent.sourceWorldId)throw Error('Saved shared context requires world identity');
 const plan=planRefinementStages(parent,{factors,nativeCellSizeM:detailSource?.grid.cellSizeM??sourceOptions.nativeCellSizeM??120,nativeCellSizeYM:detailSource?(detailSource.grid.cellSizeYM??detailSource.grid.cellSizeM):(sourceOptions.nativeCellSizeM??120)});
 // The full recipe, including algorithm versions, is part of the immutable
 // conditions. A changed generator must never silently reuse the same entity.
 const conditions={parentId:parent.id,plan,sourceOptions,detailSourceId:detailSource?.id??null,envelope,waterMethod,waterOptions,surfaceVersion:SURFACE_VERSION,handoffVersion:HANDOFF_VERSION};
 const committed=await store.resolve({worldId:parent.sourceWorldId,entityId,conditions,generator:HANDOFF_VERSION,generate:()=>{
  const source=detailSource??generateSharedDetailSource(parent,sourceOptions),stages=[];let context=parent;
  for(const {factor} of plan){const surface=anchoredGeneratedSurface(context,source,{factor,...envelope}),water=refineWater(context,{...waterOptions,factor,elevation:surface.elevation});if(JSON.stringify(water.context.elevation)!==JSON.stringify(surface.elevation))throw Error('Water method changed adopted surface heights');stages.push({surface,water});context=water.context;}
  return {schema:HANDOFF_VERSION,parentId:parent.id,source,stages,context};
 }});
 const views=[];for(let i=0;i<windows.length;i++)views.push(await saveRegionalWaterWindow(store,committed.context,windows[i],`${entityId}/view/${i}`));
 return {...committed,windows:views};
}
