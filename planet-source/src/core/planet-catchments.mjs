import {restorePlanetWorld} from './planet-world.mjs';
import {createSphericalProjection} from './spherical.mjs';
import {assessCatchmentCulverts,validateCatchmentAssumptions} from './catchment-flow.mjs';
/** Sample the canonical pre-construction ground, never camera meshes. */
export function inspectPlanetCatchments(input,{settlementId,cellSizeM=5,collectorWidthM=0,storm,design}={}){
 validateCatchmentAssumptions(storm,design);
 if(!Number.isFinite(collectorWidthM)||collectorWidthM<0||collectorWidthM>200)throw new RangeError('Collector width must be 0..200m');
 const world=input?.sampleAt&&input?.recipes?input:restorePlanetWorld(input),recipe=world.recipes.find(r=>r.id===settlementId)??(!settlementId?world.recipes[0]:null);
 if(!recipe)throw new RangeError('Unknown catchment settlement');
 if(!Number.isFinite(cellSizeM)||cellSizeM<2||cellSizeM>50)throw new RangeError('Catchment cell size must be 2..50m');
 const b=recipe.bounds,columns=(b.maxXM-b.minXM)/cellSizeM,rows=(b.maxYM-b.minYM)/cellSizeM;
 if(!Number.isSafeInteger(columns)||!Number.isSafeInteger(rows)||columns*rows>65536)throw new RangeError('Catchment grid must fit bounds and 65536-cell budget');
 const projection=createSphericalProjection(recipe.projection);
 const culverts=(recipe.drainageRouting?.links??[]).map(c=>{
  if(!collectorWidthM)return c;
  const dx=c.downstream.xM-c.upstream.xM,dy=c.downstream.yM-c.upstream.yM,length=Math.hypot(dx,dy),nx=-dy/length,ny=dx/length;
  return{...c,capturePolyline:[-1,1].map(sign=>({xM:c.upstream.xM+sign*nx*collectorWidthM/2,yM:c.upstream.yM+sign*ny*collectorWidthM/2}))};
 });
 const assess=step=>{const columns=(b.maxXM-b.minXM)/step,rows=(b.maxYM-b.minYM)/step;
  if(!Number.isSafeInteger(columns)||!Number.isSafeInteger(rows))return null;
  const groundElevationM=Array.from({length:columns*rows},(_,i)=>{
   const p=projection.toGeographic(b.minXM+(i%columns+.5)*step,b.minYM+(Math.floor(i/columns)+.5)*step);return world.base.groundElevationAt(p.latDeg,p.lonDeg);
  });
  return assessCatchmentCulverts({columns,rows,cellSizeM:step,originXM:b.minXM,originYM:b.minYM,groundElevationM},culverts,storm,design);
 };
 const report=assess(cellSizeM),coarse=assess(cellSizeM*2);
 // A pipe mouth occupying one sampled cell can drastically change watershed
 // area with grid spacing. Expose both results, and never endorse such a size.
 for(const a of report.assessments){const c=coarse?.assessments.find(c=>c.id===a.id),relativeDifference=c?Math.abs(c.catchment.areaM2-a.catchment.areaM2)/Math.max(c.catchment.areaM2,a.catchment.areaM2):null;
  a.samplingCheck={coarseCellSizeM:cellSizeM*2,coarseAreaM2:c?.catchment.areaM2??null,coarseCatchmentStatus:c?.catchment.status??null,relativeAreaDifference:relativeDifference,tolerance:.25,
   agrees:!!c&&c.catchment.status==='delineated-within-grid'&&a.catchment.status==='delineated-within-grid'&&relativeDifference<=.25};
  if(!a.samplingCheck.agrees){a.singleGridSizing=a.sizing;a.sizing=null;a.status='sampling-not-converged';}
 }

 return{...report,collector:{widthM:collectorWidthM,mode:collectorWidthM?'ideal transverse collection line; hypothetical, not a saved ditch':'legacy mouth cell'},sourceWorldId:world.worldId,settlementId:recipe.id,groundBasis:'canonical pre-construction global ground including global river incision; no roads or pads',
   scope:'Read-only pipe sizing assessment; saved diameters and the running rain simulation are unchanged. Mouth cells and drainage divides are resolution dependent. Boundary/flat cases do not receive a selected diameter.'};
}
