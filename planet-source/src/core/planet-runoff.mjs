import {mapSupportStorage,compileStorage} from './runoff-storage.mjs';
import { mapSupportFaceObstructions } from './runoff-obstacles.mjs';
import { mapCulvertRouting } from './culvert-routing.mjs';
import { restorePlanetWorld,snapshotPlanetWorld } from './planet-world.mjs';
import { createSphericalProjection } from './spherical.mjs';
import { runoffFromTerrain } from './runoff-dynamics.mjs';
/** Fixed simulation chart sampled from the complete saved world, including
 * the global river, road earthwork and building pads. Buildings/bridge piers
 * are centre-sampled impermeable solids; the deck leaves the river open below.
 * This is finite-volume reservoir routing, not a multi-layer Navier–Stokes model. */
export function createPlanetRunoffScenario(input,{settlementId,bounds={minXM:-150,maxXM:150,minYM:-150,maxYM:150},cellSizeM=5,initialWater='source',includeStructures=true,includeDrainage=true,subcellSupports=false,displacedStorage=false,boundaryConductanceM2PerSecond=1}={}){
 const world=input?.sampleAt&&input?.recipes?input:restorePlanetWorld(typeof input==='string'||input?.schema?input:snapshotPlanetWorld(input));
 const recipe=world.recipes.find(r=>r.id===settlementId)??(!settlementId?world.recipes[0]:null);
 if(!recipe)throw new RangeError('Unknown runoff settlement');
 if(![bounds.minXM,bounds.maxXM,bounds.minYM,bounds.maxYM].every(Number.isFinite)||bounds.minXM<recipe.bounds.minXM||bounds.maxXM>recipe.bounds.maxXM||bounds.minYM<recipe.bounds.minYM||bounds.maxYM>recipe.bounds.maxYM||bounds.minXM>=bounds.maxXM||bounds.minYM>=bounds.maxYM)throw new RangeError('Runoff domain must lie inside the settlement chart');
 if(!Number.isFinite(boundaryConductanceM2PerSecond)||boundaryConductanceM2PerSecond<0)throw new RangeError('Invalid boundary conductance');
 const projection=createSphericalProjection(recipe.projection),supports=includeStructures?(recipe.bridgeStructures??[]).flatMap(s=>s.boxes.filter(b=>b.id.includes('/support:'))):[],buildings=includeStructures?recipe.buildings??[]:[];
 const sample=(x,y)=>{
   const p=projection.toGeographic(x,y),s=(world.sampleSurfaceAt?world.sampleSurfaceAt(p.latDeg,p.lonDeg):world.sampleAt(p.latDeg,p.lonDeg));let ground=s.groundElevationM,solidId=null;
   for(const b of buildings)if(x>=b.bounds.minXM&&x<=b.bounds.maxXM&&y>=b.bounds.minYM&&y<=b.bounds.maxYM){const roof=b.baseElevationM+b.heightM+b.roofHeightM*(1-Math.abs(2*(x-b.bounds.minXM)/(b.bounds.maxXM-b.bounds.minXM)-1));if(roof>ground){ground=roof;solidId=b.id;}}
   for(const b of subcellSupports?[]:supports){const dx=x-b.center.xM,dy=y-b.center.yM,along=dx*b.direction.xM+dy*b.direction.yM,across=-dx*b.direction.yM+dy*b.direction.xM;
     if(Math.abs(along)<=b.lengthM/2&&Math.abs(across)<=b.widthM/2&&b.topElevationM>ground){ground=b.topElevationM;solidId=b.id;}}
   return{...s,groundElevationM:ground,waterDepthM:s.waterLevelElevationM==null?null:Math.max(0,s.waterLevelElevationM-ground),solidId};
 };
 const metric={worldId:world.worldId,regionId:recipe.id,bounds,frame:projection.contract,sampleAt:sample},state=runoffFromTerrain(metric,{bounds,cellSizeM,initialWater}),boundaries=[];
 const {columns:w,rows:h}=state;
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
   const i=y*w+x,px=bounds.minXM+(x+.5)*cellSizeM,py=bounds.minYM+(y+.5)*cellSizeM;
   for(const[edge,dx,dy,onEdge]of[['west',-1,0,x===0],['east',1,0,x===w-1],['north',0,-1,y===0],['south',0,1,y===h-1]])if(onEdge){
     const outside=sample(px+dx*cellSizeM,py+dy*cellSizeM),level=outside.waterDepthM>0?outside.waterLevelElevationM:outside.groundElevationM;
     boundaries.push({id:`${recipe.id}/${edge}/${i}`,cell:i,edge,levelElevationM:level,sillElevationM:Math.max(state.groundElevationM[i],outside.groundElevationM),conductanceM2PerSecond:boundaryConductanceM2PerSecond});
   }
 }
 const drainage=mapCulvertRouting(recipe.drainageRouting,state,{isSolid:i=>!!sample(bounds.minXM+(i%w+.5)*cellSizeM,bounds.minYM+(Math.floor(i/w)+.5)*cellSizeM).solidId});
 if(typeof displacedStorage!=='boolean')throw new TypeError('displacedStorage must be boolean');
 if(displacedStorage&&!subcellSupports)throw new RangeError('Displaced storage requires subcell support geometry');
 const displacement=displacedStorage?mapSupportStorage(state,supports):null;let displacedInitialM3=0;
 if(displacement){const storage=compileStorage(displacement.storage,state),area=cellSizeM**2,occupied=new Set(displacement.storage.map(e=>e.cell));state.waterVolumeM3=state.waterVolumeM3.map((v,i)=>{if(!occupied.has(i))return v;const next=storage.volumeAtLevel(i,state.groundElevationM[i]+v/area);displacedInitialM3+=v-next;return next;});}
 const obstruction=subcellSupports?mapSupportFaceObstructions(state,supports):null;
 const scenario={...state,...(displacement?{schema:'planet-reservoir-runoff@2',storageObstructions:displacement.storage}:{}),...(obstruction?{faceObstructions:obstruction.obstructions}:{}),boundaries,culverts:includeDrainage?drainage.links:[],projection:projection.contract,solidStructuresIncluded:includeStructures,
   scenarioDiagnostics:{source:'complete planet world sample; static global water provides boundary reservoirs',drainage:{enabled:includeDrainage,savedLinks:recipe.drainageRouting?.links.length??0,connectedLinks:includeDrainage?drainage.links.length:0,unresolved:drainage.unresolved,coefficientBasis:drainage.coefficientBasis,...(recipe.drainageRouting?.designInput?{designInput:recipe.drainageRouting.designInput,sizing:recipe.drainageRouting.links.map(c=>({id:c.id,...c.design}))}:{})},spatialResolutionM:cellSizeM,
     displacedStorage:displacement?{enabled:true,cells:displacement.storage.length,mappedSupportIds:displacement.mappedSupportIds,displacedInitialM3,scope:displacement.scope,rainfallBasis:'full horizontal cell area; rain on support tops joins the same reservoir'}:null,
     supportFaceObstructions:obstruction?{coupledSupportIds:obstruction.coupledSupportIds,unresolvedSupportIds:obstruction.unresolvedSupportIds,faces:obstruction.obstructions.length,scope:obstruction.scope}:null,
     unresolvedSubcellSupports:supports.filter(b=>Math.min(b.lengthM,b.widthM)<cellSizeM).map(b=>b.id),
     scope:displacedStorage?'fixed-grid reservoirs with exact clipped support storage and face obstruction; sampled flat cell floors; momentum, within-cell currents and erosion unresolved':subcellSupports?'fixed-grid reservoir model with exact vertical-support face obstruction; displaced storage, within-cell flow, deck runoff layers, momentum and erosion unresolved':'centre-sampled fixed-grid reservoir model; subcell barriers, deck runoff layers, momentum and erosion are not resolved'}};
 return {...scenario,diagnostics:scenario.scenarioDiagnostics};
}
