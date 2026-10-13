import {generateSeededRiverRegion} from '../core/seeded-river-region.mjs';
import {buildShapeFirstPyramid} from '../core/shape-first-pyramid.mjs';
import {fitRiverWater} from '../core/shape-first-water.mjs';
import {prepareShapeFirstModel,sha256Text} from './shape-first-model.mjs';

export function seededNativeTerrain(candidate) {
  const g=candidate.grid,heightM=(g.rows-1)*g.cellSizeYM,widthM=(g.columns-1)*g.cellSizeM;
  return {schema:'seeded-shape-first-native@1',seed:candidate.seed,status:'fictional generated shape; not physical validation',grid:{columns:g.columns,rows:g.rows,widthM,heightM,rowOrder:'south_to_north'},
    elevationM:Array.from({length:g.rows},(_,r)=>candidate.elevation.slice((g.rows-1-r)*g.columns,(g.rows-r)*g.columns)),
    rivers:candidate.rivers.map((points,i)=>({id:candidate.riverDesign.rivers[i].id,parent:candidate.riverDesign.rivers[i].parentId,direction:'downstream_to_upstream',pointsM:points.map(p=>[p.xM,heightM-p.yM])}))};
}

/** Source generation, then derived hierarchy and hypothetical supply explanation. */
export function generateShapeFirstBundle(seed) {
  if(typeof seed!=='string'||!seed.trim()||seed.length>128)throw new TypeError('Seed must contain 1..128 characters');
  const candidate=generateSeededRiverRegion({seed,widthM:8847.575822166944,heightM:9772.99159961942,columns:161,rows:129});
  const terrain=seededNativeTerrain(candidate);
  const candidateText=JSON.stringify(candidate),pyramid=buildShapeFirstPyramid(candidateText);
  const water=fitRiverWater(candidate,terrain,{kind:'synthetic-demonstration',name:'Illustrative uniform net runoff, no external supply',runoffMmPerYear:400,externalInputs:[]});
  return {candidateText,pyramid,water};
}
export async function prepareGeneratedShapeFirstModel(bundle,seed) {
  const model=await prepareShapeFirstModel(bundle);
  const native=seededNativeTerrain(model.candidate);
  if(await sha256Text(JSON.stringify(native))!==model.water.preservation.before.terrain||model.water.preservation.before.terrain!==model.water.preservation.after.terrain)throw new Error('Generated native river metadata does not match annotation');
  const nativeTerrain={...native,rivers:native.rivers.map((r,i)=>({...r,order:model.candidate.riverDesign.rivers[i].order,designBedElevationM:[...model.candidate.riverDesign.rivers[i].designBedElevationM]}))};
  return {...model,nativeTerrain,sourceLabel:`生成形状 seed: ${seed}`,pointOrder:'downstream_to_upstream'};
}
