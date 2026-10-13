import {copyJson, hashJson} from './json-contract.mjs';

/** A coarse, explicitly identified L1 screening surface. Bilinear heights and
 * saved cell water masks support candidate screening; they are not new local
 * terrain, flood levels, soil evidence or a certificate for a building site. */
export function createL1SettlementSurveySurface(l1) {
  const s=l1?.snapshot, {columns:w,rows:h}=s?.grid??{}, n=w*h;
  if(l1?.schema!=='l1-broad-region@1'||s?.layer!=='L1'||l1.id!==s.layerId
    ||l1.sourceWorldId!==s.worldId||!Number.isSafeInteger(w)||!Number.isSafeInteger(h)
    ||w<2||h<2||n>131072||!Number.isFinite(s.frame?.radiusM)||s.frame.radiusM<=0)
    throw new RangeError('A bounded identified L1 surface is required');
  const fields=s.fields;
  for(const k of ['groundElevationM','landMask','lakeFillDepthM'])
    if(!Array.isArray(fields?.[k])||fields[k].length!==n)
      throw new RangeError('Complete L1 screening fields are required');
  const z=[...fields.groundElevationM],land=[...fields.landMask],lake=[...fields.lakeFillDepthM];
  if(!z.every(Number.isFinite)||!land.every(v=>v===0||v===1)
    ||!lake.every(v=>Number.isFinite(v)&&v>=0))throw new RangeError('Invalid L1 screening fields');
  const sea=s.references?.sea?.levelElevationM??0;
  if(!Number.isFinite(sea))throw new RangeError('Invalid L1 sea level');
  const provenance={method:'l1-bilinear-ground-cell-water-mask@1',sourceWorldId:s.worldId,
    sourceLayerId:l1.id,grid:{columns:w,rows:h},frame:s.frame,groundElevationM:z,landMask:land,lakeFillDepthM:lake,seaLevelM:sea};
  const surfaceId=hashJson(copyJson(provenance));
  const coords=(lat,lon)=>{
    if(!Number.isFinite(lat)||!Number.isFinite(lon)||lat< -90||lat>90)throw new RangeError('Invalid screening coordinates');
    const longitude=((lon%360)+360)%360;
    return {x:longitude/360*w-.5,y:Math.max(0,Math.min(h-1,(90-lat)/180*h-.5)),
      cell:Math.min(h-1,Math.floor((90-lat)/180*h))*w+Math.floor(longitude/360*w)};
  };
  const groundElevationAt=(lat,lon)=>{
    const {x,y}=coords(lat,lon),ix=Math.floor(x),iy=Math.floor(y),u=x-ix,v=y-iy;
    const at=(dx,dy)=>z[Math.min(h-1,iy+dy)*w+((ix+dx)%w+w)%w];
    return at(0,0)*(1-u)*(1-v)+at(1,0)*u*(1-v)+at(0,1)*(1-u)*v+at(1,1)*u*v;
  };
  const sampleSurfaceAt=(lat,lon)=>{
    const {cell}=coords(lat,lon),ground=groundElevationAt(lat,lon),wet=!land[cell]||lake[cell]>0;
    const waterLevel=!land[cell]?sea:lake[cell]>0?z[cell]+lake[cell]:sea;
    return {groundElevationM:ground,waterLevelElevationM:waterLevel,
      waterDepthM:wet?Math.max(0,waterLevel-ground):0,sitingWet:wet,sourceCellIndex:cell,
      sourceLayerId:l1.id,surfaceId};
  };
  return Object.freeze({worldId:s.worldId,sourceLayerId:l1.id,surfaceId,method:provenance.method,
    frame:Object.freeze({...s.frame}),groundElevationAt,sampleSurfaceAt,
    limitations:Object.freeze(['Coarse bilinear L1 heights and cell water masks only',
      'Local relief, flood safety, drinking water and parcel suitability remain unresolved'])});
}
