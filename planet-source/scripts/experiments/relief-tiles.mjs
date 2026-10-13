import { createTerrainAdapter, SMOOTH_TERRAIN_SCHEMA } from '../../src/core/index.mjs';

/** Crop one previously solved regional field, rather than eroding render tiles.
 * A two-node halo retains minmod derivatives for patches on both sides of
 * the ACTIVE border (including the finite-difference stencil), so adjacent
 * tiles use the same Hermite patches there. The support rim is not drawable area.
 * No new noise, erosion, outlets or water are generated during a tile request.
 */
export function reliefTile(parent, { cellX, cellY, cellWidth, cellHeight } = {}) {
  const s=parent?.toSnapshot?.(), r=s?.references?.reliefResearch;
  if(s?.schema!==SMOOTH_TERRAIN_SCHEMA || s.interpolation!=='bounded-hermite-c1@1' || !r ||
      s.hydrology!==null || s.fields.waterLevelElevationM!==null) {
    throw new TypeError('Expected a canonical dry research relief parent');
  }
  const {columns,rows,cellSizeM:step}=s.grid;
  if(columns<3||rows<3||columns>257||rows>257||s.derivativeStepM>step)throw new RangeError('Bounded source and one-cell derivative stencil required');
  if(![cellX,cellY,cellWidth,cellHeight].every(Number.isSafeInteger) ||
      cellX<0 || cellY<0 || cellWidth<1 || cellHeight<1 ||
      cellX+cellWidth>=columns || cellY+cellHeight>=rows) {
    throw new RangeError('Active tile must cover complete parent interpolation cells');
  }
  const x0=Math.max(0,cellX-2),y0=Math.max(0,cellY-2);
  const x1=Math.min(columns-1,cellX+cellWidth+2),y1=Math.min(rows-1,cellY+cellHeight+2);
  const ground=[];
  for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++)ground.push(s.fields.groundElevationM[y*columns+x]);
  const activeBounds={
    minXM:s.frame.originXM+(cellX+.5)*step,
    minYM:s.frame.originYM+(cellY+.5)*step,
    maxXM:s.frame.originXM+(cellX+cellWidth+.5)*step,
    maxYM:s.frame.originYM+(cellY+cellHeight+.5)*step,
  };
  const terrain=createTerrainAdapter({
    schema:SMOOTH_TERRAIN_SCHEMA,interpolation:s.interpolation,seed:s.seed,
    revision:'shared-relief-tile-research@1',
    frame:{...s.frame,originXM:s.frame.originXM+x0*step,originYM:s.frame.originYM+y0*step},
    grid:{columns:x1-x0+1,rows:y1-y0+1,cellSizeM:step},
    derivativeStepM:s.derivativeStepM,
    fields:{groundElevationM:ground},
    references:{reliefTile:{method:'canonical-node-window-with-two-node-halo@1',
      parentWorldId:s.worldId,cellX,cellY,cellWidth,cellHeight,activeBounds,
      sourceNodeWindow:{x0,y0,x1,y1},
      limitations:['Only activeBounds may be rendered as owned terrain',
        'A crop of one regional solution, not independent planetary watershed generation',
        'No new water, outlet or geological interpretation']}}
  });
  return {terrain,activeBounds,parentWorldId:s.worldId};
}
