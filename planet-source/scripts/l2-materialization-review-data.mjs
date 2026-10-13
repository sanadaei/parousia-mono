import fs from 'node:fs';
import path from 'node:path';
import {createL2SettlementSurface} from '../src/core/l2-settlement-surface.mjs';
import {createShapeFirstCandidateChannels} from '../src/core/shape-first-channels.mjs';
import {createSphericalProjection} from '../src/core/spherical.mjs';

export function readL2MaterializationReviewData(directory){
  const summary=JSON.parse(fs.readFileSync(path.join(directory,'summary.json'),'utf8'));
  return {schema:'l2-native-layout-review@1',platform:'PC',examples:summary.examples.map(item=>{
    const {label,handoff,detail,result}=JSON.parse(fs.readFileSync(path.join(directory,item.file),'utf8'));
    const surface=createL2SettlementSurface(detail,handoff),g=detail.candidate.grid;
    const elevationM=[],waterDepthM=[];
    for(let row=0;row<g.rows;row++)for(let col=0;col<g.columns;col++){
      const geo=surface.projection.toGeographic(col*g.cellSizeM-surface.extent.widthM/2,surface.extent.heightM/2-row*g.cellSizeYM);
      const q=surface.sampleSurfaceAt(geo.latDeg,geo.lonDeg);
      if(!Number.isFinite(q.groundElevationM)||!Number.isFinite(q.waterDepthM))throw Error('Unknown display node in native domain');
      elevationM.push(q.groundElevationM);waterDepthM.push(q.waterDepthM);
    }
    const channels=createShapeFirstCandidateChannels(detail.candidate,detail.water);
    const rivers=channels.rivers.map(r=>({id:r.id,widthM:r.widthM,points:r.points.map(p=>({xM:p.xM-surface.extent.widthM/2,yM:surface.extent.heightM/2-p.yM}))}));
    let accessPolyline=[];
    if(result.access.recipe?.roadCenterlineProfiles.length){
      const projection=createSphericalProjection(result.access.recipe.projection);
      accessPolyline=result.access.recipe.roadCenterlineProfiles.map(road=>({halfWidthM:road.halfWidthM,points:road.samples.map(p=>{
        const geo=projection.toGeographic(p.xM,p.yM);return surface.projection.toLocal(geo.latDeg,geo.lonDeg);
      })}));
    }
    return {label,cellIndex:handoff.cellIndex,candidate:{id:result.candidateId,kind:result.kind,population:result.housing.totalPopulation,...result.origin},
      surface:{id:detail.id,grid:g,widthM:surface.extent.widthM,heightM:surface.extent.heightM,elevationM,waterDepthM,rivers,
        nativeSpacingM:surface.nativeSpacingM,provenance:detail.provenance},result,accessPolyline};
  })};
}
